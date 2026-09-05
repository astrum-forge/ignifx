import { rebuildSceneRenderables, removeFromScene, setShadowTaskCasterMeshes } from "@babylonjs/lite";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type {
  CsmDirectionalShadowGeneratorConfig,
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
 * ## How Lite renders shadows (verified against `@babylonjs/lite@1.27.0`)
 *
 * - A scene grows a shadow pass only through `registerSceneWithShadowSupport`
 *   (`index.d.ts` 9542), which unshifts a task named `"shadow"` at the front of the frame graph
 *   (`lib/scene/scene-core.js`, `ensureShadowTask`). `registerScene` never adds one, and there is
 *   no public call that adds it later — so the decision is made once, at start, from whether any
 *   shadow-casting light exists (`docs/architecture/07-rendering.md` §1).
 * - The shadow task finds its work by walking `scene.lights` and reading `light.shadowGenerator`
 *   (`lib/frame-graph/shadow-task.js`). Assigning that property is what turns shadows on for a
 *   light; `scene.shadowGenerators` is **never written** by Lite in 1.27.0 — only read by
 *   device-loss recovery — so the adapter does not maintain it either.
 * - The caster list is a side table keyed by generator (`setShadowTaskCasterMeshes`,
 *   `index.d.ts` 10981, `lib/frame-graph/shadow-inputs.js`). Passing a new array parks the
 *   generator until an async preload of the shadow pipeline finishes, so the list is replaced as
 *   rarely as possible: once per frame in which the caster set actually changed.
 * - `computeDirectionalLightMatrix` (`lib/shadow/shadow-base.js` 54-55) fits the shadow frustum
 *   from the light's **own** `direction` and `position`, not from its world matrix, while the
 *   shader reads the world matrix. The two only agree when the light has no parent and its own
 *   vectors hold the world pose, which is what `syncLightWorldPose` in `./light.ts` writes and why
 *   this adapter parents no light. Nothing extra is needed here: a posed light casts where it
 *   shades.
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
 * @internal
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
 * Rebuilds every material group of a registered scene so renderables pick up the current light and
 * shadow topology.
 *
 * @remarks
 * Renderables bake the per-mesh light index list, the single- versus multi-light shader
 * permutation, and each generator's shadow bind group at build time; none of that follows a light
 * being added, removed, or given a generator (`index.d.ts` 9465). The call is a no-op before the
 * scene's first build, and it is expensive, so the component layer coalesces every topology change
 * in a frame into one call.
 *
 * @param scene - The scene to rebuild.
 * @returns A promise that resolves when the rebuild has finished.
 *
 * @internal
 */
export function rebuildRenderables(scene: SceneContext): Promise<void> {
  return rebuildSceneRenderables(scene);
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
