import { SpriteAnimator } from "./sprite-animator.js";
import type { AnimatedTilemapSink } from "../tilemap/animated-tiles.js";
import type { System, SystemContext } from "@ignifx/core";

/**
 * Advance sprite and tile animation in `PostUpdate` so `lateUpdate` sees the current frame.
 * Systems still run while paused with a nonzero delta, so this system checks `time.paused`
 * before advancing animation (docs/architecture/01-lifecycle-and-time.md §7).
 */

/**
 * The `PostUpdate` order the 2D animation system runs at.
 *
 * @remarks
 * `PostUpdate` is empty today — no core or extension system registers there — so `0` is the middle
 * of an open phase. Anything a game adds later can sit either side of it by choosing a sign.
 *
 * @public
 */
export const TWO_D_ANIMATION_ORDER = 0;

/**
 * Advances sprite animation on ignifx's clock.
 *
 * @public
 */
export class TwoDAnimationSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/2d-animation";

  readonly #tilemaps: AnimatedTilemapSink;

  /**
   * Builds the system.
   *
   * @param tilemaps - Advances animated tiles on the same clock.
   */
  constructor(tilemaps: AnimatedTilemapSink) {
    this.#tilemaps = tilemaps;
  }

  /**
   * Advances every animator and every animated tile.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    if (ctx.time.paused) {
      return;
    }
    const animators = ctx.world.components(SpriteAnimator);
    for (let index = 0; index < animators.length; index += 1) {
      const animator = animators[index];
      if (animator !== undefined && animator.isEnabledInHierarchy) {
        animator.advance(ctx.dt);
      }
    }
    this.#tilemaps.advanceAnimatedTiles(ctx.world, ctx.dt);
  }
}
