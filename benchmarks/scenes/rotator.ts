import { f32, Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * Spins its entity about Y at a fixed rate.
 *
 * The reused `#step` vector is the point: the allocation benchmark measures the engine, so the
 * game code in front of it has to be allocation-free itself (coding standards §7).
 */
export class Rotator extends Script.define({ speed: f32(45) }) implements ScriptCallbacks {
  static typeId = "benchmarks/Rotator";

  readonly #step = { x: 0, y: 0, z: 0 };

  /**
   * Advances the rotation.
   *
   * @param dt - Seconds since the previous frame.
   */
  update(dt: number): void {
    this.#step.y = this.speed * dt;
    this.transform.rotate(this.#step);
  }
}
