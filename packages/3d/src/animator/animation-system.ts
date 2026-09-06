import { Animator } from "./animator.js";
import type { System, SystemContext } from "@ignifx/core";

/**
 * The `PostUpdate` system that advances every `Animator`
 * (`docs/architecture/01-lifecycle-and-time.md` §3 step 5, ADR-0003).
 *
 * `PostUpdate` is where animation happens in ignifx: after every `update`, before `lateUpdate` sees
 * the posed skeleton, and before the `PreRender` sync writes the frame. That ordering is what lets
 * `ThirdPersonCamera` — a `lateUpdate` script — frame an animated character without the one-frame
 * lag every naive camera rig has.
 */

/**
 * The `PostUpdate` order the 3D animation system runs at.
 *
 * @remarks
 * `10` puts it **after** `@ignifx/2d`'s animation system, which registers at `0`, and after the
 * core tween system at `-100`. A project with both toolkits therefore advances tweens, then sprite
 * clips, then skeletal clips — so a tween driving an `Animator` parameter is read in the same
 * frame it is written, and a single `Animator` document driving both a `SpriteAnimator` and a
 * skeleton stays one frame consistent.
 *
 * @public
 */
export const THREE_D_ANIMATION_ORDER = 10;

/**
 * Advances skeletal animation on ignifx's clock.
 *
 * @public
 */
export class ThreeDAnimationSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/3d-animation";

  /**
   * Advances every enabled animator.
   *
   * @remarks
   * `ctx.dt` is `time.deltaTime`, already scaled by `time.timeScale`. It is **not** zero while the
   * app is paused — `TimeImpl.beginFrame` scales by `timeScale` only — so the pause check is made
   * here, per animator, which is also what makes `updateWhenPaused` mean something.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    const paused = ctx.time.paused;
    const animators = ctx.world.components(Animator);
    for (let index = 0; index < animators.length; index += 1) {
      const animator = animators[index];
      if (animator === undefined || !animator.isEnabledInHierarchy) {
        continue;
      }
      if (paused && !animator.updateWhenPaused) {
        continue;
      }
      animator.advance(animator.updateWhenPaused ? ctx.time.unscaledDeltaTime : ctx.dt);
    }
  }
}
