import {
  createCsmDirectionalShadowGenerator,
  createEsmDirectionalShadowGenerator,
  createPcfDirectionalShadowGenerator,
  createPcfSpotlightShadowGenerator,
} from "@babylonjs/lite";
import { assertNever } from "../../errors/ignifx-error.js";
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
 */

/** A shadow task state, as every Lite 1.27.0 generator's hooks hand it out. Absent from `index.d.ts`. */
interface ShadowTaskState {
  /** The render task (a composite of one per cascade for CSM) that draws the casters. */
  readonly _task: { record(): void };
  /** The caster array the state was built for. */
  readonly _casterMeshes: readonly Mesh[];
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
}

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
  recordReplacedShadowTaskStates(generator);
  return generator;
}

/**
 * Makes a generator record a shadow task state it replaced for the same casters before that state
 * can draw (see the module header for the frame this prevents).
 *
 * @remarks
 * Lite's own `enableDeformableShadowCasters` wraps the same hook the same way
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
    const state = ensure(engine, scene, casterMeshes);
    // oxlint-disable-next-line no-underscore-dangle
    if (previous !== undefined && state !== previous && state._casterMeshes === previous._casterMeshes) {
      // oxlint-disable-next-line no-underscore-dangle
      state._task.record();
    }
    return state;
  };
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
