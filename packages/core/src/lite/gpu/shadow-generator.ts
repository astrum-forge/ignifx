import {
  createCsmDirectionalShadowGenerator,
  createEsmDirectionalShadowGenerator,
  createPcfDirectionalShadowGenerator,
  createPcfSpotlightShadowGenerator,
  enableSkeletonShadows,
} from "@babylonjs/lite";
import { assertNever } from "../../errors/ignifx-error.js";
import { ShadowCasterShapes } from "../shadow-caster-shapes.js";
import { toCsmConfig, toEsmConfig, toPcfConfig, toSpotConfig } from "../shadow.js";
import type { ShadowSettings, ShadowTechnique } from "../shadow.js";
import type { DirectionalLight, EngineContext, Mesh, SceneContext, ShadowGenerator, SpotLight } from "@babylonjs/lite";

/**
 * The four shadow-generator factories (`docs/architecture/07-rendering.md` §2.2). Each allocates a
 * depth texture and a comparison sampler through `engine._device`
 * (`lib/shadow/pcf-directional-shadow-generator.js`), so they are GPU-only. Everything a generator
 * needs afterwards — caster lists, attachment, disposal — is in `../shadow.ts`.
 *
 * Everything here is `@internal`.
 *
 * ## Which techniques exist (verified against `@babylonjs/lite@1.27.0`)
 *
 * Directional lights get ESM (`index.d.ts` 2482), PCF (2846) or CSM (2329); spot lights get PCF
 * only (2856). There is no point-light generator and no area light, which is why `../shadow.ts`
 * rejects those with `IGX-0703`. The `technique` a spot light declares is therefore ignored, not an
 * error: PCF is the only thing Lite can do for it.
 *
 * ## The shadow-task state Lite forgets to record
 *
 * Every generator keeps a "shadow task state" — a render task over its casters — that
 * `sg._ensureShadowTaskState` hands out and replaces when it is stale. PCF and CSM replace it when
 * a caster's material changed, which they detect through the material's `_csmGen` counter
 * (`lib/shadow/pcf-shadow-task-hooks.js` 54-70, `lib/shadow/csm-shadow-task-hooks.js` 31-49). The
 * shadow task, however, only records a state when the *caster array* or the scene's renderable
 * version moved (`lib/frame-graph/shadow-task.js` 43-48). `rebuildSceneGroups` bumps `_csmGen` the
 * moment one group commits but bumps the renderable version only in its `finally`, after every
 * other group (`lib/scene/scene-rebuild.js` 219-221, 49-56). A frame that lands in between swaps in
 * a state that was never recorded, and its depth-only pass keeps the colour attachment it was
 * built with — `{ loadOp, storeOp }`, no `view` (`lib/frame-graph/render-task.js` 31, 212):
 * `beginRenderPass … colorAttachments[0].view … Required member is undefined`. A rebuild spans a
 * frame only when a later group waits on something real, such as a thin-instanced material swap,
 * so it showed up on slow CI runners and almost never locally.
 * `recordReplacedShadowTaskStates` records the replacement before it can draw.
 *
 * ## A generator with no casters draws the whole scene
 *
 * Lite builds each state's render task without `autoMirror: false`, and a render task that was
 * given no mesh mirrors *every* scene renderable (`lib/frame-graph/render-task.js` 76, 233). With an
 * empty caster list the shadow pass therefore draws the receivers with their full materials, which
 * sample the very shadow map the pass writes, and Dawn rejects the whole frame ("includes writable
 * usage and another usage in the same synchronization scope"). `stopMirroringEmptyStates` keeps
 * such a task empty, so the pass only clears the map and nothing is in shadow.
 *
 * ## Casters that change shape without moving
 *
 * Every pass skips drawing unless a caster's world matrix, the light or the camera moved (see
 * `../shadow.ts`). A skinned mesh posed by its skeleton, or a shader material moving vertices by a
 * uniform, never moves its world matrix, so its shadow froze in the first pose drawn. Two layers fix
 * that:
 *
 * - Lite's `enableSkeletonShadows` (`index.d.ts` 4569, `lib/shadow/enable-skeleton-shadows.js`)
 *   swaps each skinned caster for a stand-in whose bounds follow the pose, so the directional and
 *   cascade fits cover a raised arm instead of the bind pose's box (without it, the browser test's
 *   raised arm is missing from a CSM map). It also redraws when those bounds change.
 * - `redrawChangedCasterShapes` redraws whenever a bone pose or a shader material's uniforms
 *   changed at all, which catches a pose that stays inside the same box
 *   (`../shadow-caster-shapes.ts`).
 *
 * **Order.** Lite's skeleton layer is installed first, directly on the factory's hooks, and the
 * engine's two wrappers go around it. Lite reads the hooks when it is enabled
 * (`lib/shadow/deformable-shadow-casters.js` 78-80) and, after each call, puts the *source* caster
 * array back on the state (`restoreSourceCasters`, 65-67, 102, 120). So the engine's wrappers see the
 * array the shadow task passes and the same array on the state, and the caster-identity check in
 * `recordReplacedShadowTaskStates` means what it says. Enabling the skeleton layer later instead
 * would hand the inner hooks a new proxy array mid-life, replacing the state without the shadow task
 * noticing that it needs recording.
 */

/** The fields of a Lite render task the empty-caster fix touches. Absent from `index.d.ts`. */
interface MirroringRenderTask {
  /** Records the task; a task with no mesh copies the scene's renderables here. */
  record(): void;
  /** Whether the task re-copies the scene's renderables when they change. */
  _af?: boolean;
}

/** The scene field a mirroring render task copies from. Absent from `index.d.ts`. */
interface SceneRenderables {
  /** Every renderable the scene draws. */
  _renderables: unknown[];
}

/** A shadow task state, as every Lite 1.27.0 generator's hooks hand it out. Absent from `index.d.ts`. */
interface ShadowTaskState {
  /** The render task (a composite of one per cascade for CSM) that draws the casters. */
  readonly _task: MirroringRenderTask;
  /** CSM's one render task per cascade; absent for the single-map generators. */
  readonly _tasks?: readonly MirroringRenderTask[];
  /** The caster array the state was built for. */
  readonly _casterMeshes: readonly Mesh[];
  /** The caster version the map was last drawn at; `-1` until the first draw. */
  _lastCasterVersion: number;
}

/** The fields of a Lite generator that build and keep its shadow task state. Absent from `index.d.ts`. */
interface ShadowTaskHooks {
  /** The state the generator currently draws with. */
  _shadowTaskState?: ShadowTaskState;
  /** Returns the current state, building a new one when the casters or their materials changed. */
  _ensureShadowTaskState?: (
    engine: EngineContext,
    scene: SceneContext,
    casterMeshes: readonly Mesh[],
  ) => ShadowTaskState;
  /** Draws the map unless nothing it tracks moved since the last draw; returns the draw count. */
  _renderShadowMap?: (engine: EngineContext, state: ShadowTaskState) => number;
}

/** What Lite's caster gate reads as "never drawn" (`lib/shadow/pcf-shadow-task-hooks.js` 90). */
const NEVER_DRAWN = -1;

/**
 * Builds the shadow generator a light's declared settings ask for.
 *
 * @param engine - The engine that owns the shadow map.
 * @param light - The directional or spot light that will cast.
 * @param settings - The declared technique and its tuning.
 * @returns The generator. Attach it with `attachShadowGenerator` and give it casters with
 * `setShadowCasters`, both from `../shadow.ts`.
 *
 * @example
 * ```ts
 * const generator = createShadowGeneratorForLight(engine, sun, { technique: "pcf", mapSize: 2048 });
 * attachShadowGenerator(sun, generator);
 * setShadowCasters(generator, casters);
 * ```
 *
 * @internal
 */
export function createShadowGeneratorForLight(
  engine: EngineContext,
  light: DirectionalLight | SpotLight,
  settings: ShadowSettings,
): ShadowGenerator {
  const generator =
    light.lightType === "spot"
      ? createPcfSpotlightShadowGenerator(engine, light, toSpotConfig(settings))
      : createDirectionalGenerator(engine, light, settings);
  // Lite's skeleton layer first, then the engine's wrappers around it; the module header says why.
  enableSkeletonShadows(generator);
  recordReplacedShadowTaskStates(generator);
  redrawChangedCasterShapes(generator);
  return generator;
}

/**
 * Makes a generator record a shadow task state it replaced for the same casters before that state
 * can draw (see the module header for the frame this prevents).
 *
 * @remarks
 * Lite's own `enableDeformableShadowBounds` wraps the same hook the same way
 * (`lib/shadow/deformable-shadow-casters.js` 98-104). A state built for a *new* caster array is
 * left alone, because the shadow task records that one itself.
 *
 * @param generator - A generator from one of Lite's four factories.
 */
function recordReplacedShadowTaskStates(generator: ShadowGenerator): void {
  // Boundary assertion (coding standards §5.2): `ShadowGenerator` is declared as `{}`, and every
  // factory above returns a plain object that carries these two fields.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const hooks = generator as ShadowGenerator & ShadowTaskHooks;
  // The underscores are Lite's (coding standards §5.1).
  // oxlint-disable-next-line no-underscore-dangle
  const ensure = hooks._ensureShadowTaskState;
  if (ensure === undefined) {
    return;
  }
  // oxlint-disable-next-line no-underscore-dangle
  hooks._ensureShadowTaskState = (engine, scene, casterMeshes): ShadowTaskState => {
    // oxlint-disable-next-line no-underscore-dangle
    const previous = hooks._shadowTaskState;
    // Read before `ensure`: Lite's skeleton layer points the previous state at its proxy array while
    // it runs, and a state it then replaces keeps that array.
    // oxlint-disable-next-line no-underscore-dangle
    const previousCasters = previous?._casterMeshes;
    const state = ensure(engine, scene, casterMeshes);
    if (state !== previous && casterMeshes.length === 0) {
      stopMirroringEmptyStates(scene, state);
    }
    // oxlint-disable-next-line no-underscore-dangle
    if (previous !== undefined && state !== previous && state._casterMeshes === previousCasters) {
      // oxlint-disable-next-line no-underscore-dangle
      state._task.record();
    }
    return state;
  };
}

/**
 * Makes a generator redraw its map in any frame where a caster changed shape without moving: a new
 * bone pose, or a shader material whose uniforms changed (see the module header).
 *
 * @remarks
 * It forgets the caster version the map was drawn at, which is what Lite's own gate compares
 * against, so the pass draws as if it never had. A pose change is found by comparing bone matrices,
 * not by asking whether an animator ran: a paused animator, or a skinned model with no animator at
 * all, costs no redraw, while bone control and every other writer is still caught.
 *
 * @param generator - A generator from one of Lite's four factories.
 */
function redrawChangedCasterShapes(generator: ShadowGenerator): void {
  // Boundary assertion (coding standards §5.2): as in `recordReplacedShadowTaskStates`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const hooks = generator as ShadowGenerator & ShadowTaskHooks;
  // oxlint-disable-next-line no-underscore-dangle
  const render = hooks._renderShadowMap;
  if (render === undefined) {
    return;
  }
  const shapes = new ShadowCasterShapes();
  let watched: ShadowTaskState | null = null;
  // oxlint-disable-next-line no-underscore-dangle
  hooks._renderShadowMap = (engine, state): number => {
    if (state !== watched) {
      watched = state;
      // oxlint-disable-next-line no-underscore-dangle
      shapes.watch(state._casterMeshes);
    } else if (shapes.hasChanged()) {
      // oxlint-disable-next-line no-underscore-dangle
      state._lastCasterVersion = NEVER_DRAWN;
    }
    return render(engine, state);
  };
}

/**
 * Keeps a shadow task state built for no casters from drawing the scene's renderables.
 *
 * @remarks
 * Each render task records against an empty renderable list, and its mirroring flag is cleared
 * afterwards so a later change to the scene's renderables does not copy them in either. The pass
 * then only clears the map. See the module header.
 *
 * @param scene - The scene the state belongs to.
 * @param state - A state whose caster list is empty.
 */
function stopMirroringEmptyStates(scene: SceneContext, state: ShadowTaskState): void {
  // Boundary assertion (coding standards §5.2): every Lite 1.27.0 scene carries `_renderables`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const renderables = scene as SceneContext & SceneRenderables;
  // oxlint-disable-next-line no-underscore-dangle
  const tasks = state._tasks ?? [state._task];
  for (const task of tasks) {
    const record = task.record.bind(task);
    task.record = (): void => {
      // oxlint-disable-next-line no-underscore-dangle
      const all = renderables._renderables;
      // oxlint-disable-next-line no-underscore-dangle
      renderables._renderables = [];
      try {
        record();
      } finally {
        // oxlint-disable-next-line no-underscore-dangle
        renderables._renderables = all;
      }
      // oxlint-disable-next-line no-underscore-dangle
      task._af = false;
    };
  }
}

/**
 * Builds the directional generator for a technique.
 *
 * @param engine - The engine that owns the shadow map.
 * @param light - The directional light.
 * @param settings - The declared technique and its tuning.
 * @returns The generator.
 */
function createDirectionalGenerator(
  engine: EngineContext,
  light: DirectionalLight,
  settings: ShadowSettings,
): ShadowGenerator {
  const technique: ShadowTechnique = settings.technique;
  switch (technique) {
    case "esm":
      return createEsmDirectionalShadowGenerator(engine, light, toEsmConfig(settings));
    case "pcf":
      return createPcfDirectionalShadowGenerator(engine, light, toPcfConfig(settings));
    case "csm":
      return createCsmDirectionalShadowGenerator(engine, light, toCsmConfig(settings));
    default:
      return assertNever(technique, "shadow technique");
  }
}
