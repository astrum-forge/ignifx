import type { TweensImpl } from "./tweens.js";
import type { System, SystemContext } from "../app/types.js";

/**
 * The `PostUpdate` system that advances `app.tweens` (`docs/architecture/01-lifecycle-and-time.md`
 * §3 step 5, `12-3d-toolkit.md` §4).
 *
 * `PostUpdate` is where every clock consumer in ignifx advances, so a `lateUpdate` and the render
 * sync both see the value a tween wrote in the same frame it wrote it.
 */

/**
 * The `PostUpdate` order the tween system runs at.
 *
 * @remarks
 * `-100` puts tweens **before** the toolkits' animation systems, which register at `0`
 * (`@ignifx/2d`) and `10` (`@ignifx/3d`): a tween that drives an `Animator` parameter or a
 * material property is read by the animation that runs after it, in the same frame.
 *
 * @public
 */
export const TWEEN_SYSTEM_ORDER = -100;

/**
 * Advances every tween once per frame.
 *
 * @internal
 */
export class TweenSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/tweens";

  readonly #tweens: TweensImpl;

  /**
   * Builds the system.
   *
   * @param tweens - The list to advance.
   */
  constructor(tweens: TweensImpl) {
    this.#tweens = tweens;
  }

  /**
   * Advances the list.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    const time = ctx.time;
    this.#tweens.advance(time.deltaTime, time.unscaledDeltaTime, time.paused);
  }
}
