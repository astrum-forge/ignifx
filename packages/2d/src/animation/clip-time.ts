/**
 * Which frame of a sprite clip shows at a given time: the same rule `SpriteAnimator` plays by, as a
 * pure function, so an editor can scrub a clip by time (engine ask E51) and a test can check the
 * mapping without an app.
 */

/**
 * The parts of a clip {@link spriteClipFrameAtTime} reads.
 *
 * @public
 */
export interface SpriteClipTiming {
  /** How many frames the clip has. */
  readonly frameCount: number;
  /** Frames per second. */
  readonly fps: number;
  /** Whether the clip restarts at its end. */
  readonly loop: boolean;
}

/**
 * The frame within a clip that shows `seconds` into it, counting from `0`.
 *
 * @remarks
 * Frame `n` shows from `n / (fps × speed)` seconds until the next one starts, as in playback. Past
 * the end a looping clip wraps and a one-shot clip holds its last frame; before `0` a looping clip
 * wraps backwards and a one-shot clip holds its first. A clip with no frames, or a rate of `0` or
 * less, answers `0`.
 *
 * @param clip - The clip's frame count, frame rate and loop flag.
 * @param seconds - How far into the clip, in seconds.
 * @param speed - A multiplier on the clip's frame rate, as `SpriteAnimator.speed`. Defaults to `1`.
 * @returns The frame index within the clip, in `[0, frameCount - 1]`.
 *
 * @example
 * ```ts
 * spriteClipFrameAtTime({ frameCount: 4, fps: 8, loop: true }, 0.6); // 0 (wrapped from frame 4)
 * ```
 *
 * @public
 */
export function spriteClipFrameAtTime(clip: SpriteClipTiming, seconds: number, speed = 1): number {
  const count = Math.trunc(clip.frameCount);
  const rate = clip.fps * speed;
  if (count <= 0 || !(rate > 0) || !Number.isFinite(seconds)) {
    return 0;
  }
  const raw = Math.floor(seconds * rate);
  if (clip.loop) {
    return ((raw % count) + count) % count;
  }
  return Math.min(Math.max(raw, 0), count - 1);
}
