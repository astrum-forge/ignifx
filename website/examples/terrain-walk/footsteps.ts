/**
 * Dust under the walker's feet: one `ParticleSystem` that never plays, and a script that calls
 * `emit()` once per stride.
 *
 * `emit(count)` spawns at the system's current clock whether the system is playing or not, and the
 * emission phase runs late in `Update`, after every script, so a burst asked for this frame is
 * uploaded and drawn this frame. Stride length rather than a timer is what makes the puffs line up
 * with the ground: a sprinting character leaves them the same distance apart as a walking one.
 */

import { Script } from "ignifx";
import type { ParticleSystem, ScriptCallbacks, ThirdPersonController } from "ignifx";

/** Below this speed, in metres per second, the character is not walking and leaves no dust. */
const WALK_THRESHOLD = 0.6;

/** How many particles one footfall throws up. */
const PARTICLES_PER_STEP = 5;

/**
 * Emits a puff of dust every stride while the character is on the ground.
 *
 * @example
 * ```ts
 * const steps = character.addComponent(Footsteps);
 * steps.controller = controller;
 * steps.dust = dust;
 * ```
 */
export class Footsteps extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "terrain-walk/Footsteps";

  /** The controller whose speed and grounding decide when a step lands. Assigned in code. */
  controller: ThirdPersonController | null = null;

  /** The effect the steps emit into. Assigned in code. */
  dust: ParticleSystem | null = null;

  /** Metres between puffs. */
  strideLength = 1.6;

  /** Whether the dust is switched on at all; the panel writes it. */
  dustEnabled = true;

  /** How far the character has walked since the last puff, in metres. */
  #travelled = 0;

  /**
   * Counts distance walked and emits when a stride is complete.
   *
   * @param dt - Seconds since the previous frame.
   */
  update(dt: number): void {
    const controller = this.controller;
    const dust = this.dust;
    if (controller === null || dust === null) {
      return;
    }
    if (!controller.isGrounded || controller.speed < WALK_THRESHOLD) {
      this.#travelled = 0;
      return;
    }
    this.#travelled += controller.speed * dt;
    if (this.#travelled < this.strideLength) {
      return;
    }
    this.#travelled = 0;
    if (this.dustEnabled) {
      dust.emit(PARTICLES_PER_STEP);
    }
  }
}
