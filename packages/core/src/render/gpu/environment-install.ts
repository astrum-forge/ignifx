import {
  installSceneEnvironment,
  readSceneEnvironment,
  setSceneEnvironmentBlur,
  setSceneEnvironmentRotation,
  setSceneImageProcessingOptions,
} from "../../lite/gpu/environment.js";
import type { LiteEnvironmentTextures, ToneMappingName } from "../../lite/gpu/environment.js";
import type { LiteScene } from "../../lite/scene.js";

/**
 * The device-only half of the `Environment` component
 * (`docs/architecture/07-rendering.md` §2.5).
 *
 * Rotating or blurring an environment writes into the prefiltered cube map's sampling state, and
 * tone mapping is compiled into the PBR shaders — neither exists without a device, which is why
 * both live under `src/render/gpu/` and are measured by the browser project rather than the Node
 * coverage floor. Fog, the clear colour, and the "which asset is installed" bookkeeping are plain
 * scene state and stay on the component, where Node tests reach them.
 *
 * {@link installLoadedEnvironment} is the runtime swap: it moves the scene onto an already-loaded
 * asset's cube map with no fetch, no decode, and no upload. It lives here because the textures it
 * installs only exist with a device, but the write itself is a plain field assignment, so a headless
 * test that hands it a fabricated handle still exercises it.
 */

/**
 * Applies an environment's rotation and blur to the scene.
 *
 * @param scene - The render scene.
 * @param rotationDegrees - The rotation around world Y, in degrees.
 * @param blur - How blurred the specular reflection is, 0 to 1.
 *
 * @internal
 */
export function applyEnvironmentOrientation(scene: LiteScene, rotationDegrees: number, blur: number): void {
  setSceneEnvironmentRotation(scene, rotationDegrees);
  setSceneEnvironmentBlur(scene, blur);
}

/**
 * Applies exposure, contrast, and the tone-mapping curve.
 *
 * @remarks
 * Asynchronous by nature: changing the curve recompiles the scene's PBR pipelines. The caller fires
 * it and tracks the promise rather than awaiting it inside a frame.
 *
 * @param scene - The render scene.
 * @param exposure - The exposure multiplier.
 * @param contrast - The contrast multiplier.
 * @param toneMapping - The curve name.
 * @returns A promise that resolves when any affected pipeline has been rebuilt.
 *
 * @internal
 */
export function applySceneImageProcessing(
  scene: LiteScene,
  exposure: number,
  contrast: number,
  toneMapping: ToneMappingName,
): Promise<void> {
  return setSceneImageProcessingOptions(scene, exposure, contrast, toneMapping);
}

/**
 * Moves a scene onto an already-loaded environment's textures.
 *
 * @remarks
 * The specular reflection follows only once the scene's material groups have been rebuilt — a PBR
 * bind group holds the cube map's texture view, not the scene's slot — so a `true` answer means the
 * caller owes a `rebuildSceneRenderables`. The `Environment` component discharges that by reporting
 * the install as a topology change, which the render-sync system coalesces with every other change
 * of the frame into one rebuild (`docs/architecture/07-rendering.md` §2.2, §2.5).
 *
 * @param scene - The render scene.
 * @param textures - The Lite handles the loaded `EnvironmentAsset` recorded.
 * @returns `true` when the scene was lit by something else and now is not; `false` when these
 * textures were already installed, in which case nothing was written.
 *
 * @internal
 */
export function installLoadedEnvironment(scene: LiteScene, textures: LiteEnvironmentTextures): boolean {
  return installSceneEnvironment(scene, textures);
}

/**
 * Reports which environment textures a scene is lit by, whoever installed them.
 *
 * @param scene - The render scene.
 * @returns The installed textures, or `null` when no environment has ever been installed on it.
 *
 * @internal
 */
export function readInstalledEnvironment(scene: LiteScene): LiteEnvironmentTextures | null {
  return readSceneEnvironment(scene);
}
