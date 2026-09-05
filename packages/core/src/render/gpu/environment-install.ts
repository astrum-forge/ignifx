import {
  setSceneEnvironmentBlur,
  setSceneEnvironmentRotation,
  setSceneImageProcessingOptions,
} from "../../lite/gpu/environment.js";
import type { ToneMappingName } from "../../lite/gpu/environment.js";
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
