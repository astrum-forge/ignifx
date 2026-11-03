import { createScreenSpaceContactShadowsPostProcessTask } from "@babylonjs/lite";
import type { SceneColorPass } from "./scene-color-passes.js";
import type {
  Camera,
  DirectionalLight,
  EngineContext,
  RenderTarget,
  SceneContext,
  ScreenSpaceContactShadowsPostProcessTask,
} from "@babylonjs/lite";

/**
 * Screen-space contact shadows (GI plan step G10): Lite's
 * `createScreenSpaceContactShadowsPostProcessTask` (`index.d.ts` 3672), fed the shared scene-input
 * depth and run as a scene-colour pass (`./scene-color-passes.ts`). Its own chunk, loaded only while
 * a `PostProcessStack` enables `contactShadows` (`CONSTITUTION.md` §2.5).
 *
 * Lite marches from each pixel towards one light through the depth buffer and multiplies the colour
 * by the occlusion it finds, so the light is the scene's main directional light: the first one that
 * casts shadows, else the first one. With none, the task runs disabled (its composite copies).
 */

/**
 * The tuning a recorded pass follows live.
 *
 * @internal
 */
export interface ContactShadowsTuning {
  /** How dark a contact gets, 0 to 4. */
  readonly intensity: number;
  /** How far each ray marches, in world units. */
  readonly length: number;
  /** How thick a surface is assumed to be behind its depth, in world units. */
  readonly thickness: number;
  /** March steps per pixel, 1 to 64. */
  readonly samples: number;
}

/**
 * A contact-shadows pass: its task once created, and its per-frame update.
 *
 * @internal
 */
export interface ContactShadowsPass extends SceneColorPass {
  /**
   * Writes the tuning and the main light's direction onto the task.
   *
   * @param tuning - The stack's `contactShadows` record.
   */
  update(tuning: ContactShadowsTuning): void;
}

/** The pass's frame-graph task name. */
const TASK_NAME = "ignifx:contact-shadows";

/**
 * Creates a contact-shadows pass.
 *
 * @param engine - The engine.
 * @param scene - The scene, whose lights are read every frame.
 * @param depth - The scene-input depth target.
 * @param camera - The camera the depth was drawn from.
 * @param tuning - The initial tuning.
 * @returns The pass.
 *
 * @internal
 */
export function createContactShadowsPass(
  engine: EngineContext,
  scene: SceneContext,
  depth: RenderTarget,
  camera: Camera,
  tuning: ContactShadowsTuning,
): ContactShadowsPass {
  // Lite keeps this object and reads it every frame (`lib/post-process/screen-space-contact-shadows.js`).
  const lightDirection = { x: 0, y: -1, z: 0 };
  let task: ScreenSpaceContactShadowsPostProcessTask | null = null;
  return {
    create(source: RenderTarget, target: RenderTarget): ScreenSpaceContactShadowsPostProcessTask {
      task = createScreenSpaceContactShadowsPostProcessTask(
        {
          name: TASK_NAME,
          sourceTexture: source,
          depthTexture: depth,
          targetTexture: target,
          camera,
          lightDirection,
          intensity: tuning.intensity,
          maxDistance: tuning.length,
          thickness: tuning.thickness,
          stepCount: tuning.samples,
        },
        engine,
        scene,
      );
      return task;
    },
    update(next: ContactShadowsTuning): void {
      if (task === null) {
        return;
      }
      task.intensity = next.intensity;
      task.maxDistance = next.length;
      task.thickness = next.thickness;
      task.stepCount = next.samples;
      const light = mainDirectionalLight(scene);
      task.enabled = light !== null;
      if (light !== null) {
        lightDirection.x = light.direction.x;
        lightDirection.y = light.direction.y;
        lightDirection.z = light.direction.z;
      }
    },
  };
}

/**
 * The scene's main directional light: the first that casts shadows, else the first.
 *
 * @param scene - The scene.
 * @returns The light, or `null` when the scene has none.
 */
function mainDirectionalLight(scene: SceneContext): DirectionalLight | null {
  let first: DirectionalLight | null = null;
  for (const light of scene.lights) {
    if (!isDirectional(light)) {
      continue;
    }
    if (light.shadowGenerator !== undefined) {
      return light;
    }
    first ??= light;
  }
  return first;
}

/**
 * Whether a scene light is directional.
 *
 * @param light - The light.
 * @param light.lightType - Its type tag.
 * @returns `true` for a directional light.
 */
function isDirectional(light: { readonly lightType: string }): light is DirectionalLight {
  return light.lightType === "directional";
}
