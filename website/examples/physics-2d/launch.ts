import { Rigidbody2D, Script, Vec2 } from "ignifx";
import type { MutableVec2, ScriptCallbacks } from "ignifx";

/**
 * Gives a body its opening velocity on the first fixed step it lives through.
 *
 * @remarks
 * A `Rigidbody2D` is a *description* until 2D physics builds it, and it builds bodies at the start
 * of the next fixed step — never mid-frame, so that Rapier's internal order follows entity creation
 * order. Writing `linearVelocity` in the same frame the entity was created therefore writes to a
 * body that does not exist yet and is silently lost (measured 2026-09-08). One fixed step later it
 * lands, which is what this script is for.
 */
export class Launch extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "physics-2d/Launch";

  /** The velocity to apply, in metres per second. Assigned when the body is thrown. */
  readonly velocity: MutableVec2 = new Vec2();

  #spent = false;

  /** Scratch for the read-back that tells the script the write landed. */
  readonly #check: MutableVec2 = new Vec2();

  fixedUpdate(): void {
    if (this.#spent) {
      return;
    }
    const body = this.entity.getComponent(Rigidbody2D);
    if (body === null) {
      return;
    }
    body.linearVelocity = this.velocity;
    // Reading it back is what says the body exists: a write to a body that has not been built yet
    // is dropped, so the script asks again on the next step rather than assuming.
    body.linearVelocityToRef(this.#check);
    this.#spent = Math.hypot(this.#check.x, this.#check.y) > 0.001;
  }
}
