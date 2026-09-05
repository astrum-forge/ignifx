import {
  enableAsyncShaderPipelineCompilation,
  enableBoneControl,
  enableGltfCameras,
  enableMaterialPlugins,
  enableMaterialStencil,
  enablePbrLightmap,
  enableStandardSkeleton,
  registerScene,
  registerSceneWithShadowSupport,
  unregisterScene,
} from "@babylonjs/lite";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { EngineContext, SceneContext } from "@babylonjs/lite";

/**
 * Feature opt-ins and scene registration (`docs/architecture/07-rendering.md` §1.1). Lite compiles
 * its shader permutations and builds its frame graph at `registerScene`, so every feature that
 * changes what gets compiled has to be switched on **before** that call. ignifx therefore declares
 * the whole set up front, applies it here during `app.start()`, and rejects late toggles.
 *
 * Everything here is `@internal`.
 *
 * ## What each opt-in actually does (verified against `@babylonjs/lite@1.27.0`)
 *
 * | Call | What it installs | Device needed |
 * | --- | --- | --- |
 * | `enableStandardSkeleton()` | a Standard-pipeline skinning fragment, preloaded (`lib/material/standard/enable-standard-mesh-features.js`) | no |
 * | `enableBoneControl()` | the skeleton builder the glTF loader calls (`lib/skeleton/bone-control.js`) | no |
 * | `enableMaterialStencil()` | stencil resolvers on the PBR, Standard and Shader pipelines (`lib/material/enable-material-stencil.js`) | no |
 * | `enablePbrLightmap()` | a PBR fragment extension, loaded lazily — **async** (`lib/material/pbr/enable-pbr-lightmap.js`) | no |
 * | `enableMaterialPlugins(scene)` | plugin bridges plus one scene before-render hook (`lib/material/plugin/enable-material-plugins.js`) | no |
 * | `enableAsyncShaderPipelineCompilation(engine)` | a per-engine recipe table plus a `registerScene` hook (`lib/material/shader/enable-async-shader-pipeline-compilation.js`) | no |
 * | `enableGltfCameras()` | a glTF loader feature (`lib/loader-gltf/gltf-feature-camera.js`) | no |
 * | `postProcessing` | nothing here: it picks the scene's render path at `createSceneContext` (`./scene.ts`) | **yes** |
 * | `enableDeviceLostSceneRecovery(engine)` | reads `engine._device.features` immediately | **yes** — `./gpu/device-loss.ts` |
 *
 * Every one of them except the last is idempotent, process-global (not per engine, apart from the
 * async-pipeline table), and safe under the null engine. None of them **throws** when called late:
 * `enableMaterialStencil` simply installs its resolver, and pipelines already compiled keep the
 * behaviour they were compiled with. Lite gives no signal at all, which is exactly why ignifx has
 * to police the ordering itself with {@link assertRenderingFeatureAvailable} (`IGX-0704`).
 */

/**
 * The rendering features `ignifx.config.ts` can switch on, in the order they are applied.
 *
 * @internal
 */
export const RENDERING_FEATURE_NAMES = [
  "shadows",
  "postProcessing",
  "skeletons",
  "boneControl",
  "stencil",
  "lightmaps",
  "materialPlugins",
  "asyncPipelines",
  "deviceLostRecovery",
] as const;

/**
 * The union of the rendering feature names.
 *
 * @internal
 */
export type RenderingFeatureName = (typeof RENDERING_FEATURE_NAMES)[number];

/**
 * The rendering feature block of `createApp`/`ignifx.config.ts`
 * (`docs/architecture/07-rendering.md` §1.1).
 *
 * @internal
 */
export type RenderingFeatures = {
  readonly [Name in RenderingFeatureName]: boolean;
};

/**
 * Every feature off — the state an app that declares no `rendering.features` block starts from.
 *
 * @internal
 */
export const NO_RENDERING_FEATURES: RenderingFeatures = {
  shadows: false,
  postProcessing: false,
  skeletons: false,
  boneControl: false,
  stencil: false,
  lightmaps: false,
  materialPlugins: false,
  asyncPipelines: false,
  deviceLostRecovery: false,
};

/**
 * Applies the process- and scene-global feature opt-ins a world declared, before its scene is
 * registered.
 *
 * @remarks
 * Three features are deliberately **not** applied here. `shadows` chooses between `registerScene`
 * and `registerSceneWithShadowSupport` in {@link registerRenderScene}. `postProcessing` is decided
 * even earlier — at `createSceneContext`, which is where `defaultRenderTask: false` has to be said
 * (`./scene.ts`), because Lite exposes no way to retarget the default render task afterwards.
 * `deviceLostRecovery` needs a real device, so `app.start()` calls `enableSceneDeviceLossRecovery`
 * from `./gpu/device-loss.ts` before it creates any resource.
 *
 * @param engine - The engine the world renders on.
 * @param scene - The world's render scene.
 * @param features - The declared feature block.
 * @returns A promise that resolves when every opt-in — including the lazily loaded lightmap
 * extension — is installed.
 *
 * @example
 * ```ts
 * await applyRenderingFeatures(engine, scene, { ...NO_RENDERING_FEATURES, shadows: true, skeletons: true });
 * await registerRenderScene(scene, { shadows: true });
 * ```
 *
 * @internal
 */
export async function applyRenderingFeatures(
  engine: EngineContext,
  scene: SceneContext,
  features: RenderingFeatures,
): Promise<void> {
  if (features.skeletons) {
    enableStandardSkeleton();
  }
  if (features.boneControl) {
    enableBoneControl();
  }
  if (features.stencil) {
    enableMaterialStencil();
  }
  if (features.materialPlugins) {
    enableMaterialPlugins(scene);
  }
  if (features.asyncPipelines) {
    enableAsyncShaderPipelineCompilation(engine);
  }
  if (features.lightmaps) {
    await enablePbrLightmap();
  }
}

/**
 * Enables glTF camera import. Must run before the first `loadGltf`.
 *
 * @remarks
 * Separate from {@link applyRenderingFeatures} because it is an **asset** opt-in, driven by an
 * asset's `.meta.json` rather than by the renderer block
 * (`docs/architecture/07-rendering.md` §2.4).
 *
 * @internal
 */
export function enableGltfCameraImport(): void {
  enableGltfCameras();
}

/**
 * Registers a world's render scene with Lite, picking the shadow-capable entry point when the
 * world declared shadows.
 *
 * @remarks
 * `registerSceneWithShadowSupport` unshifts a task named `"shadow"` at the front of the frame graph
 * (`lib/scene/scene-core.js`, `ensureShadowTask`); `registerScene` never does, and nothing public
 * adds one afterwards. Registering the same scene twice is a no-op — Lite checks whether the scene
 * is already a rendering context of its surface.
 *
 * @param scene - The scene to register.
 * @param options - Registration options.
 * @param options.shadows - Whether any shadow-casting light exists at start.
 * @returns A promise that resolves when the scene's material groups are built, its pipelines are
 * compiled, and its frame graph is recorded.
 *
 * @internal
 */
export function registerRenderScene(scene: SceneContext, options: { readonly shadows: boolean }): Promise<void> {
  return options.shadows ? registerSceneWithShadowSupport(scene) : registerScene(scene);
}

/**
 * Detaches a scene from its surface so the engine stops rendering it, without disposing it.
 *
 * @remarks
 * This is the first half of Lite's documented "change the light topology" flow:
 * `unregisterRenderScene` → mutate lights → {@link registerRenderScene} again, which re-runs the
 * group builders (`index.d.ts` 9465).
 *
 * @param scene - The scene to detach.
 *
 * @internal
 */
export function unregisterRenderScene(scene: SceneContext): void {
  unregisterScene(scene);
}

/**
 * Refuses a rendering feature toggle that arrives after the scene was registered.
 *
 * @param feature - The feature being toggled.
 * @param isSceneRegistered - Whether `app.start()` has already registered the render scene.
 * @throws IgnifxError with code `IGX-0704` when the scene is already registered.
 *
 * @example
 * ```ts
 * assertRenderingFeatureAvailable("stencil", app.isStarted); // throws IGX-0704 after start
 * ```
 *
 * @internal
 */
export function assertRenderingFeatureAvailable(feature: RenderingFeatureName, isSceneRegistered: boolean): void {
  if (!isSceneRegistered) {
    return;
  }
  throw new IgnifxError(
    CoreErrorCode.renderingFeatureTooLate,
    `The rendering feature ${feature} must be enabled before the scene is registered.`,
    {
      context: { feature },
      hint: "Declare it in the rendering.features block of createApp() or ignifx.config.ts.",
    },
  );
}
