import { rebuildSceneRenderables, removeFromScene, setShadowTaskCasterMeshes } from "@babylonjs/lite";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type {
  CsmDirectionalShadowGeneratorConfig,
  EngineContext,
  EsmDirectionalShadowGeneratorConfig,
  LightBase,
  Mesh,
  PcfDirectionalShadowGeneratorConfig,
  PcfSpotlightShadowGeneratorConfig,
  SceneContext,
  ShadowGenerator,
} from "@babylonjs/lite";

/**
 * Shadow half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §2.2): everything
 * about shadow generators that does **not** need a GPU device. Creating a generator allocates a
 * depth texture and a sampler, so the four factories live in `./gpu/shadow-generator.ts`.
 *
 * Everything here is `@internal`.
 *
 * ## How Lite renders shadows (verified against `@babylonjs/lite@1.34.0`)
 *
 * - A scene grows a shadow pass only through `registerSceneWithShadowSupport`
 *   (`index.d.ts` 11275), which unshifts a task named `"shadow"` at the front of the frame graph
 *   (`lib/scene/scene-core.js`, `ensureShadowTask`). `registerScene` never adds one, and there is
 *   no public call that adds it later — so the decision is made once, at start, from whether any
 *   shadow-casting light exists (`docs/architecture/07-rendering.md` §1).
 * - The shadow task finds its work by walking `scene.lights` and reading `light.shadowGenerator`
 *   (`lib/frame-graph/shadow-task.js`). Assigning that property is what turns shadows on for a
 *   light; Lite never adds to `scene.shadowGenerators` — it only reads it during device-loss
 *   recovery and splices from it on removal — so the adapter does not maintain it either.
 * - The caster list is a side table keyed by generator (`setShadowTaskCasterMeshes`,
 *   `index.d.ts` 12986, `lib/frame-graph/shadow-inputs.js`). Passing a new array parks the
 *   generator until an async preload of the shadow pipeline finishes, so the list is replaced as
 *   rarely as possible: once per frame in which the caster set actually changed.
 * - A pass redraws its map only when something it tracks moved: the sum of every caster's
 *   `worldMatrixVersion` plus its thin-instance version (`casterVersionSum`,
 *   `lib/shadow/shadow-base.js` 186), the light's `_lightVersion` (see `./light.ts`), and the
 *   floating-origin camera (CSM: the camera and its aspect). Otherwise the previous map is reused
 *   (`lib/shadow/pcf-shadow-task-hooks.js` 120, `_chunks/esm-directional-shadow-generator-*.js`
 *   173, `lib/shadow/csm-shadow-task-hooks.js` 303). A caster that changes shape in place — a
 *   skinned mesh, a shader material moving vertices by a uniform — moves none of those, so
 *   `./gpu/shadow-generator.ts` adds Lite's skeleton layer and a shape check of its own to every
 *   generator.
 * - `computeDirectionalLightMatrix` (`lib/shadow/shadow-base.js` 76-79) fits the shadow frustum
 *   from the light's `direction` rotated by its world matrix and from the world matrix's
 *   translation, the same pose the lights uniform buffer is written from. `./light.ts` keeps every
 *   light unparented and unrotated and writes the world pose into its own vectors, so a posed light
 *   casts where it shades and nothing extra is needed here.
 */

/**
 * The Babylon Lite shadow generator a `Light` owns, re-exported under an ignifx name
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteShadowGenerator = ShadowGenerator;

/**
 * The shadow techniques Lite offers, in the order `docs/architecture/07-rendering.md` §2.2 lists them.
 *
 * @public
 */
export const SHADOW_TECHNIQUES = ["esm", "pcf", "csm"] as const;

/**
 * The union of the shadow techniques a directional light can use.
 *
 * @internal
 */
export type ShadowTechnique = (typeof SHADOW_TECHNIQUES)[number];

/**
 * The technique-independent shadow settings a `Light` component declares. Every field is optional;
 * Lite's own defaults apply when one is omitted.
 *
 * @internal
 */
export interface ShadowSettings {
  /** The technique to use. Spot lights ignore it and always use PCF, the only one Lite offers them. */
  readonly technique: ShadowTechnique;
  /** The shadow map resolution, in texels per side. Lite defaults to 1024. */
  readonly mapSize?: number;
  /** Depth bias applied while sampling, in Lite's units. */
  readonly bias?: number;
  /** Offset along the surface normal, PCF only. */
  readonly normalBias?: number;
  /** How dark a fully shadowed texel is: `0` is black, `1` is unshadowed. */
  readonly darkness?: number;
  /** Cascade count, CSM only; Lite clamps it to four. */
  readonly cascades?: number;
  /** The distance beyond which nothing is shadowed, CSM only, in metres. */
  readonly maxDistance?: number;
}

/**
 * Refuses to build a shadow generator for a light kind Lite cannot shadow.
 *
 * @remarks
 * Lite has no point-light (cube) shadow generator and no area lights
 * (`docs/architecture/07-rendering.md` §8). Hemispheric lights have no position or frustum at all.
 *
 * @param lightType - The Lite `lightType` discriminant of the light.
 * @throws IgnifxError with code `IGX-0703` for any light kind other than `directional` or `spot`.
 *
 * @example
 * ```ts
 * assertShadowsSupported(light.lightType); // throws IGX-0703 for "point"
 * ```
 *
 * @internal
 */
export function assertShadowsSupported(lightType: string): void {
  if (lightType === "directional" || lightType === "spot") {
    return;
  }
  throw new IgnifxError(
    CoreErrorCode.shadowsUnsupportedForLight,
    `Babylon Lite has no shadow generator for a ${lightType} light.`,
    {
      context: { lightType },
      hint: "Cast shadows from a directional or spot light instead.",
    },
  );
}

/**
 * Turns shadows on for a light by attaching its generator.
 *
 * @param light - The light that should cast shadows.
 * @param generator - A generator built for that light by `./gpu/shadow-generator.ts`.
 *
 * @internal
 */
export function attachShadowGenerator(light: LightBase, generator: ShadowGenerator): void {
  light.shadowGenerator = generator;
}

/**
 * Turns shadows off for a light.
 *
 * @remarks
 * This only breaks the link. The generator's GPU resources are released when the scene disposes it
 * through {@link disposeShadowGenerator}.
 *
 * @param light - The light that should stop casting shadows.
 *
 * @internal
 */
export function detachShadowGenerator(light: LightBase): void {
  delete light.shadowGenerator;
}

/**
 * Replaces the list of meshes a generator renders into its shadow map.
 *
 * @remarks
 * Lite keys the list by array identity and re-preloads the shadow pipeline every time a **new**
 * array arrives, skipping the generator until that finishes. Callers therefore build the list once
 * per change, never per frame.
 *
 * @param generator - The shadow generator.
 * @param casters - The meshes that cast into it.
 *
 * @internal
 */
export function setShadowCasters(generator: ShadowGenerator, casters: readonly Mesh[]): void {
  setShadowTaskCasterMeshes(generator, casters);
}

/**
 * Lite's process-wide pipeline-cache resets that one scene has been seen to register, so the
 * adapter can call them before a rebuild that needs fresh bind-group layouts.
 *
 * @remarks
 * Babylon Lite 1.31 removed the per-engine cache resets (`engine._pbrCleanup`,
 * `engine._standardCleanup`) that 1.27 parked on the engine. The only remaining handle on the PBR
 * and Standard bindings caches is the reset each material-group builder pushes onto
 * `scene._disposables` at the end of every build (`buildPbrRenderables`,
 * `lib/material/pbr/pbr-renderable.js` 306; `buildStandardMeshRenderables`,
 * `lib/material/standard/standard-renderable.js` 178). A reset is a module-level function, so a
 * group rebuild pushes the **same** function again, and Lite drops the duplicate
 * (`dedupeGroupCleanup`, `lib/scene/scene-rebuild.js`). That re-push is how the adapter tells a
 * cache reset from a scene's own disposers without relying on function names, which an app's
 * minifier rewrites.
 *
 * {@link trackMaterialCacheResets} watches every push: a function already in the list is a reset
 * and goes into `found`, and a function never seen before raises `unconfirmed`. A rebuild that
 * raised it rebuilds once more at once, and a family Lite built on its own (a runtime build of the
 * first mesh of a family, after start) is confirmed by the next rebuild the render sync system
 * schedules for it. Each function raises `unconfirmed` once, so a scene's one-off disposers cost
 * one extra rebuild in total, never a loop.
 *
 * @internal
 */
export interface MaterialCacheResets {
  /** The resets identified so far. */
  readonly found: Set<() => void>;
  /** Every function seen pushed, so each one asks for at most one confirming rebuild. */
  readonly seen: WeakSet<() => void>;
  /** `true` when a function nobody had seen was pushed since the last rebuild started. */
  unconfirmed: boolean;
  /** How many rebuilds started over because a material swap landed in them; for diagnostics. */
  retries: number;
}

/** The scene's disposer list, which Lite runs when the scene is disposed. Absent from `index.d.ts`. */
interface SceneDisposables {
  /** Callbacks `disposeScene` runs; material-group builders add their cache resets here. */
  _disposables?: (() => void)[];
}

/**
 * Creates an empty record of a scene's material cache resets.
 *
 * @returns The record; install it with {@link trackMaterialCacheResets}.
 *
 * @internal
 */
export function createMaterialCacheResets(): MaterialCacheResets {
  return { found: new Set(), seen: new WeakSet(), unconfirmed: false, retries: 0 };
}

/**
 * Starts recording what the scene's disposer list is handed, for the scene's lifetime.
 *
 * @remarks
 * Call it before the scene is registered, so the builds `registerScene` runs are seen too. It is
 * idempotent. An own `push` shadows `Array.prototype.push` on that one array; Lite only ever appends
 * to it with `push`.
 *
 * @param scene - The scene.
 * @param resets - Where to record.
 *
 * @internal
 */
export function trackMaterialCacheResets(scene: SceneContext, resets: MaterialCacheResets): void {
  // Boundary assertion (coding standards §5.2): every Lite 1.34.0 scene carries the list.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const listed = scene as SceneContext & SceneDisposables;
  // oxlint-disable-next-line no-underscore-dangle
  const disposables = listed._disposables;
  if (disposables === undefined || Object.hasOwn(disposables, "push")) {
    return;
  }
  Object.defineProperty(disposables, "push", {
    configurable: true,
    writable: true,
    value: (...items: (() => void)[]): number => {
      for (const item of items) {
        if (disposables.includes(item)) {
          resets.found.add(item);
        } else if (!resets.seen.has(item)) {
          resets.seen.add(item);
          resets.unconfirmed = true;
        }
      }
      return Array.prototype.push.apply(disposables, items);
    },
  });
}

/**
 * Rebuilds every material group of a registered scene so renderables pick up the current light and
 * shadow topology.
 *
 * @remarks
 * Renderables bake the per-mesh light index list, the single- versus multi-light shader
 * permutation, and each generator's shadow bind group at build time; none of that follows a light
 * being added, removed, or given a generator (`rebuildSceneRenderables`, `index.d.ts` 11165). The
 * call is a no-op before the scene's first build, and it is expensive, so the component layer
 * coalesces every topology change in a frame into one call.
 *
 * With `resets`, a rebuild that built a material family for the first time rebuilds once more
 * straight away, so the family's cache reset is known before anything needs it; see
 * {@link MaterialCacheResets}.
 *
 * The engine frees nothing the rebuild retires until the rebuild has finished; see
 * `holdGpuRetirements`.
 *
 * @param scene - The scene to rebuild.
 * @param resets - The scene's record of cache resets.
 * @returns A promise that resolves when the rebuild has finished.
 *
 * @internal
 */
export async function rebuildRenderables(scene: SceneContext, resets?: MaterialCacheResets): Promise<void> {
  const release = holdGpuRetirements(scene.surface.engine);
  try {
    if (resets === undefined) {
      await rebuildAcrossMaterialSwaps(scene);
      return;
    }
    trackMaterialCacheResets(scene, resets);
    takeUnconfirmed(resets);
    await rebuildAcrossMaterialSwaps(scene, resets);
    if (takeUnconfirmed(resets)) {
      // A family was built for the first time just now: build once more so it pushes its reset again.
      // Whatever this one sees for the first time stays flagged for the render sync system.
      await rebuildAcrossMaterialSwaps(scene, resets);
    }
  } finally {
    release();
  }
}

/** How many times {@link rebuildAcrossMaterialSwaps} starts over after a swap broke a rebuild. */
const MAX_SWAP_RETRIES = 2;

/**
 * Runs `rebuildSceneRenderables`, and runs it again when a material swap landed during it and made
 * it throw.
 *
 * @remarks
 * A group builder awaits its shader modules (`import()`) before it reads each mesh's material, and
 * on a loaded machine that await spans frames. A mesh given a material of another family meanwhile
 * reaches the old family's builder: the Standard one reads `diffuseColor[0]` off a PBR material and
 * throws `Cannot read properties of undefined (reading '0')` (`buildStandardMeshRenderables`,
 * `writeStdMaterialData`, `lib/material/standard/standard-pipeline.js` 278). Lite expects swaps to
 * land mid-build — it puts the group's old renderables back on a throw, and a rebuild that does not
 * throw re-sorts the groups and goes round again (`membershipDrifted`, `lib/scene/scene-rebuild.js`)
 * — but it rethrows, so the rest of the rebuild is skipped. Starting over sorts the groups from the
 * current materials. A throw with every material unchanged is not this race, and is rethrown.
 *
 * @param scene - The scene to rebuild.
 * @param resets - The scene's record, which counts the restarts.
 * @param retries - How many more times to start over.
 * @returns A promise that resolves when a rebuild has finished.
 */
async function rebuildAcrossMaterialSwaps(
  scene: SceneContext,
  resets?: MaterialCacheResets,
  retries = MAX_SWAP_RETRIES,
): Promise<void> {
  const meshes = scene.meshes;
  const materials = meshes.map((mesh) => mesh.material);
  try {
    await rebuildSceneRenderables(scene);
  } catch (error: unknown) {
    const swapped = scene.meshes !== meshes || meshes.some((mesh, index) => mesh.material !== materials[index]);
    if (!swapped || retries <= 0) {
      throw error;
    }
    if (resets !== undefined) {
      resets.retries += 1;
    }
    await rebuildAcrossMaterialSwaps(scene, resets, retries - 1);
  }
}

/** The hook `renderFrame` calls after each submit to release retired GPU resources. Absent from `index.d.ts`. */
interface RetirementFlush {
  /** Fences the resources retired so far behind the frame just submitted, then frees them. */
  _flushGpuRetirements?: (engine: EngineContext) => void;
  /** The adapter's hold on that hook while a rebuild runs; see `holdGpuRetirements`. */
  _igxRetirementHold?: RetirementHold;
}

/** One engine's held releases: how many rebuilds hold them, and Lite's own flush. */
interface RetirementHold {
  count: number;
  flush: RetirementFlush["_flushGpuRetirements"];
}

/**
 * Keeps an engine from freeing retired GPU resources until the returned function is called.
 *
 * @remarks
 * `rebuildSceneRenderables` rebuilds one material group at a time and retires each group's old
 * uniform buffers and bind groups as soon as that group is done, but it only bumps
 * `_renderableVersion` and re-records the frame graph after the **last** group
 * (`rebuildSceneGroups`, `lib/scene/scene-rebuild.js`). Until then every frame still draws the old
 * renderables. Lite frees a retired resource once the next submitted frame has finished
 * (`flushGpuResourceRetirements`, `lib/engine/gpu-resource-retirement.js`), so when a later group
 * takes two frames or more to build — a slow machine, or a pipeline to compile — the following
 * frames submit buffers that are already destroyed, and WebGPU rejects them ("[Buffer] used in
 * submit while destroyed"). Holding the releases until the whole rebuild has finished means they
 * are fenced behind the first frame that draws the new renderables.
 *
 * While a hold is active, `_flushGpuRetirements` reads as absent, so `renderFrame` skips it and
 * the retired resources wait in the engine's list. Lite installs the flush with `??=`, so an
 * assignment it makes meanwhile is kept only when it had none before. Holds nest.
 *
 * @param engine - The engine that renders the scene being rebuilt.
 * @returns A function that ends this hold. Call it once.
 */
function holdGpuRetirements(engine: EngineContext): () => void {
  // Boundary assertion (coding standards §5.2): every Lite 1.34.0 engine may carry the hook.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const target = engine as EngineContext & RetirementFlush;
  // oxlint-disable-next-line no-underscore-dangle
  let hold = target._igxRetirementHold;
  if (hold === undefined) {
    // oxlint-disable-next-line no-underscore-dangle
    const state: RetirementHold = { count: 0, flush: target._flushGpuRetirements };
    Object.defineProperty(target, "_flushGpuRetirements", {
      configurable: true,
      enumerable: true,
      get: (): RetirementFlush["_flushGpuRetirements"] => (state.count > 0 ? undefined : state.flush),
      // Lite only ever assigns it with `??=`, so keep the one it installed before the hold.
      set: (flush: RetirementFlush["_flushGpuRetirements"]): void => {
        state.flush ??= flush;
      },
    });
    Object.defineProperty(target, "_igxRetirementHold", { configurable: true, value: state });
    hold = state;
  }
  const held = hold;
  held.count += 1;
  return (): void => {
    held.count -= 1;
    if (held.count === 0) {
      Object.defineProperty(target, "_flushGpuRetirements", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: held.flush,
      });
      // oxlint-disable-next-line no-underscore-dangle
      delete target._igxRetirementHold;
    }
  };
}

/**
 * Reads and clears {@link MaterialCacheResets.unconfirmed}.
 *
 * @param resets - The record.
 * @returns Whether a never-seen function was pushed since the flag was last cleared.
 */
function takeUnconfirmed(resets: MaterialCacheResets): boolean {
  const unconfirmed = resets.unconfirmed;
  resets.unconfirmed = false;
  return unconfirmed;
}

/**
 * Rebuilds a freshly registered scene once when its registration built anything, so Lite pushes
 * its cache resets again and {@link forgetMaterialBindingLayouts} can call them from the first
 * frame on.
 *
 * @remarks
 * Nothing has changed since registration, so every pipeline and layout comes from Lite's caches and
 * the rebuild only re-creates uniform buffers and bind groups.
 *
 * @param scene - The registered scene.
 * @param resets - The scene's record, installed with {@link trackMaterialCacheResets} before
 * registration.
 * @returns A promise that resolves when the rebuild has finished.
 *
 * @internal
 */
export async function learnMaterialCacheResets(scene: SceneContext, resets: MaterialCacheResets): Promise<void> {
  if (resets.unconfirmed) {
    await rebuildRenderables(scene, resets);
  }
}

/** The scene counter Lite bumps whenever a material's renderables are rebuilt. Absent from `index.d.ts`. */
interface SceneMaterialEpoch {
  /** Bumped by `rebuildMaterial`, a material swap, and every renderable rebuild. */
  _materialEpoch?: number;
}

/**
 * How many times the scene's materials have been rebuilt.
 *
 * @remarks
 * An ESM generator keeps the caster views it built for a caster array until it is handed a
 * different array, whatever happens to the materials (`ensureEsmShadowTaskState`,
 * `lib/shadow/esm-directional-shadow-generator.js` 121-126; PCF and CSM compare each material's
 * `_csmGen` instead). So a surface shader switched on or off went on drawing the old shape into an
 * ESM map. The render sync system re-supplies the caster lists whenever this moves.
 *
 * @param scene - The scene.
 * @returns The counter; `0` before anything was built.
 *
 * @internal
 */
export function readMaterialEpoch(scene: SceneContext): number {
  // Boundary assertion (coding standards §5.2): every Lite 1.34.0 scene carries the counter.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const counted = scene as SceneContext & SceneMaterialEpoch;
  // oxlint-disable-next-line no-underscore-dangle
  return counted._materialEpoch ?? 0;
}

/**
 * Makes the next renderable rebuild create fresh bind-group layouts for every material.
 *
 * @remarks
 * Call it before {@link rebuildRenderables} whenever a light gained or lost a shadow generator,
 * and when the scene gained its first skinned or morphed PBR mesh (`./pbr-deformers.ts`).
 * Lite caches a PBR material's bindings, shadow bind-group layout included, under a key that does
 * not name the shadow maps (`getOrCreatePbrBindings`, `lib/material/pbr/pbr-pipeline.js` 59-63).
 * So after the number of shadow-casting lights changes, a rebuild reuses a layout sized for the old
 * number and builds a bind group for the new one, and WebGPU rejects every frame ("Number of
 * entries (3) did not match the expected number of entries (6)"). Clearing the caches costs one
 * pipeline rebuild per material, only on a frame whose shadow casters changed.
 *
 * @param resets - The resets the scene's rebuilds identified; see {@link MaterialCacheResets}.
 *
 * @internal
 */
export function forgetMaterialBindingLayouts(resets: MaterialCacheResets): void {
  for (const reset of resets.found) {
    reset();
  }
}

/**
 * Releases a shadow generator's GPU resources and unlinks it from its light.
 *
 * @remarks
 * `removeFromScene` recognises a shadow generator by its private `_shadowType`/`_light` fields
 * (`lib/scene/scene-remove.js`), clears `light.shadowGenerator`, marks the scene's light topology
 * dirty, and queues the generator's task for disposal after the GPU has drained.
 *
 * @param scene - The scene the generator was rendering into.
 * @param generator - The generator to release.
 *
 * @internal
 */
export function disposeShadowGenerator(scene: SceneContext, generator: ShadowGenerator): void {
  removeFromScene(scene, generator);
}

/**
 * Maps the shared settings onto an exponential shadow map's configuration.
 *
 * @param settings - The declared settings.
 * @returns Lite's configuration, with every field the caller left out omitted.
 *
 * @internal
 */
export function toEsmConfig(settings: ShadowSettings): EsmDirectionalShadowGeneratorConfig {
  const config: { mapSize?: number; bias?: number; darkness?: number } = {};
  if (settings.mapSize !== undefined) {
    config.mapSize = settings.mapSize;
  }
  if (settings.bias !== undefined) {
    config.bias = settings.bias;
  }
  if (settings.darkness !== undefined) {
    config.darkness = settings.darkness;
  }
  return config;
}

/**
 * Maps the shared settings onto a percentage-closer-filtered directional shadow map's configuration.
 *
 * @param settings - The declared settings.
 * @returns Lite's configuration.
 *
 * @internal
 */
export function toPcfConfig(settings: ShadowSettings): PcfDirectionalShadowGeneratorConfig {
  const config: { mapSize?: number; bias?: number; normalBias?: number; darkness?: number } = {};
  if (settings.mapSize !== undefined) {
    config.mapSize = settings.mapSize;
  }
  if (settings.bias !== undefined) {
    config.bias = settings.bias;
  }
  if (settings.normalBias !== undefined) {
    config.normalBias = settings.normalBias;
  }
  if (settings.darkness !== undefined) {
    config.darkness = settings.darkness;
  }
  return config;
}

/**
 * Maps the shared settings onto a cascaded shadow map's configuration.
 *
 * @remarks
 * `cascades` becomes `numCascades` and `maxDistance` becomes `shadowMaxZ`; Lite clamps the cascade
 * count to four (`index.d.ts` 3515).
 *
 * @param settings - The declared settings.
 * @returns Lite's configuration.
 *
 * @internal
 */
export function toCsmConfig(settings: ShadowSettings): CsmDirectionalShadowGeneratorConfig {
  const config: {
    mapSize?: number;
    bias?: number;
    darkness?: number;
    numCascades?: number;
    shadowMaxZ?: number;
  } = {};
  if (settings.mapSize !== undefined) {
    config.mapSize = settings.mapSize;
  }
  if (settings.bias !== undefined) {
    config.bias = settings.bias;
  }
  if (settings.darkness !== undefined) {
    config.darkness = settings.darkness;
  }
  if (settings.cascades !== undefined) {
    config.numCascades = settings.cascades;
  }
  if (settings.maxDistance !== undefined) {
    config.shadowMaxZ = settings.maxDistance;
  }
  return config;
}

/**
 * Maps the shared settings onto a spot light's shadow configuration.
 *
 * @param settings - The declared settings.
 * @returns Lite's configuration.
 *
 * @internal
 */
export function toSpotConfig(settings: ShadowSettings): PcfSpotlightShadowGeneratorConfig {
  const config: { mapSize?: number; bias?: number; normalBias?: number; darkness?: number; far?: number } = {};
  if (settings.mapSize !== undefined) {
    config.mapSize = settings.mapSize;
  }
  if (settings.bias !== undefined) {
    config.bias = settings.bias;
  }
  if (settings.normalBias !== undefined) {
    config.normalBias = settings.normalBias;
  }
  if (settings.darkness !== undefined) {
    config.darkness = settings.darkness;
  }
  if (settings.maxDistance !== undefined) {
    config.far = settings.maxDistance;
  }
  return config;
}
