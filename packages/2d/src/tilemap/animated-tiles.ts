import type { World } from "@ignifx/core";

/**
 * The seam between the 2D animation system and the tilemap renderer.
 *
 * Animated tiles advance on the same clock as `SpriteAnimator`
 * (`docs/architecture/11-2d-toolkit.md` §2.5), so the animation system drives both. This interface
 * is what keeps the animation system from importing the tilemap renderer, which imports the layer
 * registry, which imports the sprite component — a cycle that adds nothing.
 */

/**
 * Anything that owns animated tiles and can step them.
 *
 * @public
 */
export interface AnimatedTilemapSink {
  /**
   * Advances every animated tile by one frame's worth of scaled time.
   *
   * @param world - The world holding the tilemaps.
   * @param deltaSeconds - The scaled frame delta, `time.deltaTime`.
   */
  advanceAnimatedTiles(world: World, deltaSeconds: number): void;
}
