import { Camera } from "@ignifx/core";
import type { Vec3Like, World } from "@ignifx/core";

/**
 * Finding "the camera" (`docs/architecture/07-rendering.md` §2.1).
 *
 * Several things in this package need the camera the player is looking through: a third-person
 * controller moves relative to it, a `Billboard` faces it, a `LodGroup` measures distance from it.
 * Core has no notion of a *main* camera — `Camera.priority` orders the render passes — so the rule
 * is stated once, here: the enabled camera with the highest `priority`, and the first of those in
 * component order when several tie.
 */

/**
 * Where something faces when the world has no enabled camera at all.
 *
 * @public
 */
export const WORLD_FORWARD: Vec3Like = Object.freeze({ x: 0, y: 0, z: 1 });

/**
 * The camera the player is looking through.
 *
 * @param world - The world to look in.
 * @returns The highest-priority enabled camera, or `null` when the world has none.
 *
 * @example
 * ```ts
 * const camera = mainCamera(this.world);
 * ```
 *
 * @public
 */
export function mainCamera(world: World): Camera | null {
  const cameras = world.components(Camera);
  let best: Camera | null = null;
  for (let index = 0; index < cameras.length; index += 1) {
    const camera = cameras[index];
    if (camera === undefined || !camera.isEnabledInHierarchy) {
      continue;
    }
    if (best === null || camera.priority > best.priority) {
      best = camera;
    }
  }
  return best;
}

/**
 * The main camera's forward vector.
 *
 * @param world - The world to look in.
 * @returns The forward vector, or {@link WORLD_FORWARD} when there is no camera.
 *
 * @public
 */
export function mainCameraForward(world: World): Vec3Like {
  return mainCamera(world)?.entity.transform.forward ?? WORLD_FORWARD;
}
