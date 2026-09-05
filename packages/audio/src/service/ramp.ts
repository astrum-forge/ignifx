/**
 * The one fade primitive in the package: a scalar that walks from where it is to where it was told
 * to go, over a number of seconds of frame time.
 *
 * Every fade `@ignifx/audio` performs goes through this — a bus fader, `AudioSource.stop(fade)`,
 * `MusicPlayer.crossfadeTo` — and the `PreRender` pump advances all of them with the frame delta.
 * Doing the interpolation here rather than handing Babylon Lite a `RampOptions` (`index.d.ts` 9339)
 * is what makes a two-second crossfade take exactly two seconds of *game* time on both backends:
 * Lite's ramp would run on the audio context's clock, which no headless test has.
 *
 * The class allocates nothing per frame and holds no reference to anything.
 */

/**
 * A linearly interpolated gain.
 *
 * @internal
 */
export class Ramp {
  #value: number;

  #from: number;

  #target: number;

  #duration = 0;

  #elapsed = 0;

  #isActive = false;

  /**
   * Creates a ramp already at a value.
   *
   * @param value - The starting value.
   */
  constructor(value: number) {
    this.#value = value;
    this.#from = value;
    this.#target = value;
  }

  /**
   * Where the ramp is now.
   *
   * @returns The current value.
   */
  get value(): number {
    return this.#value;
  }

  /**
   * Where the ramp is heading, which is {@link Ramp.value} when it is not moving.
   *
   * @returns The target value.
   */
  get target(): number {
    return this.#target;
  }

  /**
   * Whether the ramp still has ground to cover.
   *
   * @returns `true` while {@link Ramp.advance} would change the value.
   */
  get isActive(): boolean {
    return this.#isActive;
  }

  /**
   * Jumps to a value, cancelling any fade in progress.
   *
   * @param value - The new value.
   */
  set(value: number): void {
    this.#value = value;
    this.#from = value;
    this.#target = value;
    this.#duration = 0;
    this.#elapsed = 0;
    this.#isActive = false;
  }

  /**
   * Starts a fade towards a value.
   *
   * @param target - Where to end up.
   * @param seconds - How long to take; anything at or below zero jumps.
   */
  to(target: number, seconds: number): void {
    if (seconds <= 0) {
      this.set(target);
      return;
    }
    this.#from = this.#value;
    this.#target = target;
    this.#duration = seconds;
    this.#elapsed = 0;
    this.#isActive = true;
  }

  /**
   * Advances a fade in progress.
   *
   * @param deltaSeconds - The frame delta in seconds.
   * @returns `true` when the value changed, so the caller knows whether to push it anywhere.
   */
  advance(deltaSeconds: number): boolean {
    if (!this.#isActive) {
      return false;
    }
    this.#elapsed += deltaSeconds;
    if (this.#elapsed >= this.#duration) {
      this.#value = this.#target;
      this.#isActive = false;
      return true;
    }
    const alpha = this.#elapsed / this.#duration;
    this.#value = this.#from + (this.#target - this.#from) * alpha;
    return true;
  }
}
