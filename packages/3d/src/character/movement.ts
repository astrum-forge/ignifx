import { deltaAngleDegrees, RAD_TO_DEG, VEC3_UP } from "@ignifx/core";
import type { MutableVec3, Vec3Like } from "@ignifx/core";

/**
 * The character-movement arithmetic, as pure functions
 * (`docs/architecture/12-3d-toolkit.md` §1).
 *
 * Camera-relative movement, turning, coyote time, and jump buffering are the four things every
 * third-person controller gets subtly wrong, and all four are pure: a stick vector plus a camera
 * forward plus a delta. Keeping them out of the component is what lets a headless test step them a
 * frame at a time and assert the answer, rather than driving a whole physics world to find out
 * whether a jump one frame after leaving a ledge still works.
 *
 * ignifx is left-handed, like Babylon Lite: `+Z` is forward and `right = up x forward`
 * (`@ignifx/core`'s `VEC3_FORWARD`, `VEC3_RIGHT`).
 */

/** Below this squared length a stick reading counts as centred. */
const DEAD_ZONE_SQUARED = 1e-6;

/**
 * Turns a stick reading into a world-space direction relative to a camera's facing.
 *
 * @remarks
 * Only the camera's yaw is used: a third-person camera looking down at a character should still
 * send "forward on the stick" along the ground, not into it. The result is normalized, or left at
 * zero when the stick is centred.
 *
 * @param inputX - The stick's X, where `+1` is right.
 * @param inputY - The stick's Y, where `+1` is forward.
 * @param cameraForward - The camera's forward vector; its Y component is discarded.
 * @param out - Where to write the direction.
 * @returns `out`, for chaining.
 *
 * @example
 * ```ts
 * cameraRelativeToRef(move.x, move.y, camera.transform.forward, direction);
 * ```
 *
 * @public
 */
export function cameraRelativeToRef<TOut extends MutableVec3>(
  inputX: number,
  inputY: number,
  cameraForward: Vec3Like,
  out: TOut,
): TOut {
  let forwardX = cameraForward.x;
  let forwardZ = cameraForward.z;
  const length = Math.hypot(forwardX, forwardZ);
  if (length < 1e-6) {
    // The camera is looking straight up or down; fall back to world forward so the character keeps
    // moving in a defined direction rather than freezing.
    forwardX = 0;
    forwardZ = 1;
  } else {
    forwardX /= length;
    forwardZ /= length;
  }
  // right = up x forward, with up = (0, 1, 0).
  const rightX = forwardZ;
  const rightZ = -forwardX;
  const x = rightX * inputX + forwardX * inputY;
  const z = rightZ * inputX + forwardZ * inputY;
  const magnitude = Math.hypot(x, z);
  if (magnitude < 1e-6) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  out.x = x / magnitude;
  out.y = 0;
  out.z = z / magnitude;
  return out;
}

/**
 * The yaw, in degrees, that faces a horizontal direction.
 *
 * @param x - The direction's X.
 * @param z - The direction's Z.
 * @returns The yaw in degrees, or `null` when the direction is degenerate.
 *
 * @public
 */
export function yawFromDirection(x: number, z: number): number | null {
  if (x * x + z * z < DEAD_ZONE_SQUARED) {
    return null;
  }
  return Math.atan2(x, z) * RAD_TO_DEG;
}

/**
 * Rotates one yaw towards another at a bounded rate, the short way round.
 *
 * @param currentDegrees - Where the character faces now.
 * @param targetDegrees - Where it should face.
 * @param degreesPerSecond - The turn rate; `0` or less snaps.
 * @param deltaSeconds - The step.
 * @returns The new yaw, in degrees.
 *
 * @example
 * ```ts
 * const yaw = turnTowardsDegrees(current, target, 720, dt);
 * ```
 *
 * @public
 */
export function turnTowardsDegrees(
  currentDegrees: number,
  targetDegrees: number,
  degreesPerSecond: number,
  deltaSeconds: number,
): number {
  const difference = deltaAngleDegrees(currentDegrees, targetDegrees);
  if (degreesPerSecond <= 0) {
    return currentDegrees + difference;
  }
  const step = degreesPerSecond * deltaSeconds;
  if (Math.abs(difference) <= step) {
    return currentDegrees + difference;
  }
  return currentDegrees + Math.sign(difference) * step;
}

/**
 * The upward speed that reaches a given jump height under a given gravity.
 *
 * @param height - The apex height above the take-off point, in metres.
 * @param gravity - The downward acceleration, as a positive number.
 * @returns The initial vertical speed, in metres per second.
 *
 * @public
 */
export function jumpVelocity(height: number, gravity: number): number {
  return Math.sqrt(Math.max(0, 2 * gravity * Math.max(0, height)));
}

/**
 * The two forgiving timers every good jump has (`12-3d-toolkit.md` §1.1).
 *
 * @remarks
 * Coyote time* keeps a jump legal for a moment after walking off a ledge; *jump buffering* keeps a
 * jump pressed a moment early from being thrown away. Both are counters, and both are the sort of
 * thing that is either right or infuriating, so both are testable on a stepped clock with no
 * physics world in sight.
 *
 * @example
 * ```ts
 * const jumps = new JumpTimers();
 * jumps.step(dt, controller.isGrounded, jumpAction.wasPressedThisFrame, 0.12, 0.12);
 * if (jumps.consume()) {
 *   verticalVelocity = jumpVelocity(1.2, 20);
 * }
 * ```
 *
 * @public
 */
export class JumpTimers {
  #coyoteRemaining = 0;

  #bufferRemaining = 0;

  /**
   * How much longer a jump started off the ground would still be legal, in seconds.
   *
   * @returns How much longer a jump started off the ground would still be legal, in seconds.
   */
  get coyoteRemaining(): number {
    return this.#coyoteRemaining;
  }

  /**
   * How much longer a jump pressed early is still remembered, in seconds.
   *
   * @returns How much longer a jump pressed early is still remembered, in seconds.
   */
  get bufferRemaining(): number {
    return this.#bufferRemaining;
  }

  /**
   * Advances both timers by one step.
   *
   * @param deltaSeconds - The step.
   * @param isGrounded - Whether the character is standing on something.
   * @param jumpPressed - Whether the jump button went down this step.
   * @param coyoteSeconds - How long a jump stays legal after leaving the ground.
   * @param bufferSeconds - How long an early jump press is remembered.
   */
  step(
    deltaSeconds: number,
    isGrounded: boolean,
    jumpPressed: boolean,
    coyoteSeconds: number,
    bufferSeconds: number,
  ): void {
    this.#coyoteRemaining = isGrounded ? coyoteSeconds : Math.max(0, this.#coyoteRemaining - deltaSeconds);
    this.#bufferRemaining = jumpPressed ? bufferSeconds : Math.max(0, this.#bufferRemaining - deltaSeconds);
  }

  /**
   * Takes a jump if one is owed, clearing both timers.
   *
   * @returns `true` when the character should leave the ground.
   */
  consume(): boolean {
    if (this.#bufferRemaining <= 0 || this.#coyoteRemaining <= 0) {
      return false;
    }
    this.#bufferRemaining = 0;
    this.#coyoteRemaining = 0;
    return true;
  }

  /** Forgets both timers, for a teleport or a cutscene. */
  reset(): void {
    this.#coyoteRemaining = 0;
    this.#bufferRemaining = 0;
  }
}

/**
 * Projects a movement vector onto a slope so a character slides along it rather than into it.
 *
 * @param direction - The desired direction.
 * @param normal - The ground normal.
 * @param out - Where to write the projected direction.
 * @returns `out`, for chaining.
 *
 * @public
 */
export function projectOnSlopeToRef<TOut extends MutableVec3>(direction: Vec3Like, normal: Vec3Like, out: TOut): TOut {
  const dot = direction.x * normal.x + direction.y * normal.y + direction.z * normal.z;
  out.x = direction.x - normal.x * dot;
  out.y = direction.y - normal.y * dot;
  out.z = direction.z - normal.z * dot;
  return out;
}

/**
 * The angle between a ground normal and straight up, in degrees.
 *
 * @param normal - The ground normal.
 * @returns The slope angle in degrees; `0` for flat ground.
 *
 * @public
 */
export function slopeAngleDegrees(normal: Vec3Like): number {
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (length < 1e-6) {
    return 0;
  }
  const cosine = (normal.x * VEC3_UP.x + normal.y * VEC3_UP.y + normal.z * VEC3_UP.z) / length;
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * RAD_TO_DEG;
}
