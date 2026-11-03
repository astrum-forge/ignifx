import { createScreenSpaceGlobalIlluminationPostProcessTask, getPbrUnlit, isPbrMaterial } from "@babylonjs/lite";
import { rebuildMaterialPipelines } from "../material.js";
import type { SceneColorPass } from "./scene-color-passes.js";
import type {
  Camera,
  EngineContext,
  MaterialPlugin,
  RenderTarget,
  SceneContext,
  ScreenSpaceGlobalIlluminationPostProcessTask,
} from "@babylonjs/lite";

/**
 * Screen-space global illumination (GI plan step G11): Lite's `@beta`
 * `createScreenSpaceGlobalIlluminationPostProcessTask` (`index.d.ts` 3681), fed the shared
 * scene-input depth and run as a scene-colour pass (`./scene-color-passes.ts`), plus a material
 * plugin that turns the environment's diffuse light down while it runs. Its own chunk, loaded only
 * while a `PostProcessStack` enables `ssgi` (`CONSTITUTION.md` §2.5).
 *
 * **Why the plugin.** Lite's additive composite adds one bounce of the lit scene colour on top of
 * the frame, and the environment's irradiance (`finalIrradiance`, `lib/material/pbr/fragments/
 * ibl-fragment.js` line 6) already stands in for that bounce, so with both the indirect light is
 * counted twice. The plugin subtracts `(1 - environmentDiffuse)` of `finalIrradiance` from the
 * colour; specular reflections are left alone.
 *
 * **How it compiles everywhere.** `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION` is injected at both
 * the `AI` and the `NI` slot, which follow each other, and `finalIrradiance` exists only when the
 * material has an environment. The plugin declares a module-scope `finalIrradiance` of zero, which
 * the IBL code's own `let` shadows where it exists, and subtracts only what changed since its last
 * run, so the two injections together subtract once whichever side of the IBL code they land on,
 * and a material without an environment subtracts nothing. Priority -1 puts it ahead of the HDR
 * linear-output save (priority 0), which then keeps the adjusted colour.
 *
 * Plugins need Lite's bridges, which `rendering.hdr` and the `materialPlugins` feature install, so
 * without either the plugin is not attached and the environment is left as it is.
 */

/**
 * The tuning a recorded pass follows live.
 *
 * @internal
 */
export interface SsgiTuning {
  /** How strongly the bounce is added, 0 to 4. */
  readonly intensity: number;
  /** How far each ray marches, in world units. */
  readonly radius: number;
  /** March steps per ray, 1 to 64. */
  readonly samples: number;
  /** How much of the environment's diffuse light remains, 0 to 1. */
  readonly environmentDiffuse: number;
}

/**
 * An SSGI pass: its task once created, its per-frame update, and the plugin it owns.
 *
 * @internal
 */
export interface SsgiPass extends SceneColorPass {
  /**
   * Writes the tuning onto the task and, when plugins are available, keeps every lit PBR material's
   * environment plugin in step.
   *
   * @param tuning - The stack's `ssgi` record.
   * @param isSceneRegistered - Whether a patched material's pipelines must be rebuilt.
   */
  update(tuning: SsgiTuning, isSceneRegistered: boolean): void;
  /**
   * Takes the plugin off every material again. The task itself is disposed by the installer.
   *
   * @param isSceneRegistered - Whether a patched material's pipelines must be rebuilt.
   */
  dispose(isSceneRegistered: boolean): void;
}

/** The pass's frame-graph task name. */
const TASK_NAME = "ignifx:ssgi";

/**
 * The environment plugin's name.
 *
 * @internal
 */
export const SSGI_ENVIRONMENT_PLUGIN_NAME = "ignifx-ssgi-environment";

/**
 * Creates an SSGI pass.
 *
 * @param engine - The engine.
 * @param scene - The scene, whose materials get the plugin.
 * @param depth - The scene-input depth target.
 * @param camera - The camera the depth was drawn from.
 * @param options - The initial tuning and the creation-time choices.
 * @param options.tuning - The initial tuning.
 * @param options.halfResolution - Whether the rays are traced at half resolution.
 * @param options.usePlugin - Whether Lite's plugin bridges are installed, so the plugin can be used.
 * @returns The pass.
 *
 * @internal
 */
export function createSsgiPass(
  engine: EngineContext,
  scene: SceneContext,
  depth: RenderTarget,
  camera: Camera,
  options: { readonly tuning: SsgiTuning; readonly halfResolution: boolean; readonly usePlugin: boolean },
): SsgiPass {
  let task: ScreenSpaceGlobalIlluminationPostProcessTask | null = null;
  let plugin: MaterialPlugin | null = null;
  let pluginValue = Number.NaN;
  return {
    create(source: RenderTarget, target: RenderTarget): ScreenSpaceGlobalIlluminationPostProcessTask {
      const tuning = options.tuning;
      task = createScreenSpaceGlobalIlluminationPostProcessTask(
        {
          name: TASK_NAME,
          sourceTexture: source,
          depthTexture: depth,
          targetTexture: target,
          camera,
          resolutionScale: options.halfResolution ? 0.5 : 1,
          intensity: tuning.intensity,
          rayLength: tuning.radius,
          stepCount: tuning.samples,
          composition: "additive",
        },
        engine,
        scene,
      );
      return task;
    },
    update(tuning: SsgiTuning, isSceneRegistered: boolean): void {
      if (task === null) {
        return;
      }
      task.intensity = tuning.intensity;
      task.rayLength = tuning.radius;
      task.stepCount = tuning.samples;
      if (!options.usePlugin) {
        return;
      }
      const value = Math.min(1, Math.max(0, tuning.environmentDiffuse));
      if (plugin === null || value !== pluginValue) {
        pluginValue = value;
        plugin = createSsgiEnvironmentPlugin(value);
      }
      attachPlugin(scene, plugin, isSceneRegistered);
    },
    dispose(isSceneRegistered: boolean): void {
      if (plugin !== null) {
        attachPlugin(scene, null, isSceneRegistered);
        plugin = null;
      }
    },
  };
}

/**
 * Builds the plugin that leaves `environmentDiffuse` of the environment's diffuse light.
 *
 * @param environmentDiffuse - What remains, 0 to 1. Baked into the WGSL, so a change compiles anew.
 * @returns The plugin.
 *
 * @internal
 */
export function createSsgiEnvironmentPlugin(environmentDiffuse: number): MaterialPlugin {
  const removed = (1 - environmentDiffuse).toFixed(4);
  const fragment = {
    CUSTOM_FRAGMENT_DEFINITIONS: "var<private> finalIrradiance: vec3<f32>;var<private> ignifxSsgiRemoved: vec3<f32>;",
    CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `color-=(finalIrradiance-ignifxSsgiRemoved)*${removed};ignifxSsgiRemoved=finalIrradiance;`,
  };
  return {
    name: SSGI_ENVIRONMENT_PLUGIN_NAME,
    priority: -1,
    getCustomCode: (stage) => (stage === "fragment" ? fragment : null),
  };
}

/**
 * Puts a plugin on every lit PBR material in the scene, replacing an older one of the same name,
 * or takes it off every material when `plugin` is `null`.
 *
 * @param scene - The scene.
 * @param plugin - The current plugin, or `null` to remove.
 * @param isSceneRegistered - Whether a changed material's pipelines must be rebuilt.
 */
function attachPlugin(scene: SceneContext, plugin: MaterialPlugin | null, isSceneRegistered: boolean): void {
  const meshes = scene.meshes;
  for (let index = 0; index < meshes.length; index += 1) {
    const material = meshes[index]?.material;
    // Declared non-null, but Lite's mesh factories create meshes with `material: null`.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (material === undefined || material === null || !isPbrMaterial(material)) {
      continue;
    }
    const current = material.plugins ?? [];
    const wanted = plugin !== null && getPbrUnlit(material) === undefined;
    if (wanted && current.includes(plugin)) {
      continue;
    }
    const kept = current.filter((other) => other.name !== SSGI_ENVIRONMENT_PLUGIN_NAME);
    if (!wanted && kept.length === current.length) {
      continue;
    }
    material.plugins = wanted ? [...kept, plugin] : kept;
    if (isSceneRegistered) {
      rebuildMaterialPipelines(scene, material);
    }
  }
}
