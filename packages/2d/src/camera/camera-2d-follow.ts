import { Script, Vec2 } from "@ignifx/core";
import { Camera2D } from "./camera-2d.js";
import type { MutableVec2 } from "@ignifx/core";

/**
 * Follow the camera's target in `lateUpdate`, after gameplay and physics interpolation have
 * written its display pose. Keeping follow behaviour in a script lets games replace it without
 * changing `Camera2D` (docs/architecture/11-2d-toolkit.md §2.1).
 */

/**
 * A damped, dead-zoned camera follow.
 *
 * @example
 * ```ts
 * const camera = app.world.createEntity({ name: "camera" });
 * const view = camera.addComponent(Camera2D);
 * view.follow = player;
 * view.deadZone = { x: 0.5, y: 0.3 };
 * camera.addComponent(Camera2DFollow);
 * ```
 *
 * @public
 */
export class Camera2DFollow extends Script {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/Camera2DFollow";

  /** One follow per entity. */
  static allowMultiple = false;

  /** The camera this script drives, found once on attach. */
  #camera: Camera2D | null = null;

  /** Scratch, so following allocates nothing per frame. */
  readonly #target: MutableVec2 = new Vec2();

  /**
   * Finds the camera on this entity.
   */
  awake(): void {
    this.#camera = this.entity.getComponent(Camera2D);
  }

  /**
   * Moves the camera toward its target.
   *
   * @remarks
   * The damping is frame-rate independent: the camera covers the same fraction of the remaining
   * distance per *second*, not per frame, so a 30 fps machine and a 144 fps machine see the same
   * motion. `followDamping` is the time constant in seconds; `0` snaps.
   *
   * @param deltaTime - The scaled frame delta.
   */
  lateUpdate(deltaTime: number): void {
    const camera = this.#camera;
    const target = camera?.follow ?? null;
    if (camera === null || target === null || target.isDestroyed) {
      return;
    }
    const targetMatrix = target.transform.worldMatrix;
    const offset = camera.followOffset;
    const desiredX = (targetMatrix[12] ?? 0) + offset.x;
    const desiredY = (targetMatrix[13] ?? 0) + offset.y;
    const transform = this.entity.transform;
    const matrix = transform.worldMatrix;
    const currentX = matrix[12] ?? 0;
    const currentY = matrix[13] ?? 0;
    const zone = camera.deadZone;
    // Inside the dead zone the camera does not move at all; outside it, it chases only the part of
    // the distance that is beyond the zone, so the target rides the zone's edge.
    const wantedX = beyond(desiredX, currentX, zone.x);
    const wantedY = beyond(desiredY, currentY, zone.y);
    const damping = camera.followDamping;
    const blend = damping <= 0 ? 1 : 1 - Math.exp(-deltaTime / damping);
    this.#target.x = currentX + (wantedX - currentX) * blend;
    this.#target.y = currentY + (wantedY - currentY) * blend;
    transform.position2D = new Vec2(this.#target.x, this.#target.y);
  }
}

/**
 * The position the camera should chase, given a dead zone.
 *
 * @param desired - Where the target is.
 * @param current - Where the camera is.
 * @param half - Half the dead zone's extent on this axis, in metres.
 * @returns The camera's goal: `current` while the target is inside the zone.
 */
function beyond(desired: number, current: number, half: number): number {
  const delta = desired - current;
  if (Math.abs(delta) <= half) {
    return current;
  }
  return delta > 0 ? desired - half : desired + half;
}
