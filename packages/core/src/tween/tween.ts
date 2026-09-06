import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { Signal } from "../signal/signal.js";
import { TweenChannel } from "./channel.js";
import { resolveEase } from "./easing.js";
import type { TweenableValue } from "./channel.js";
import type { EasingFunction, EasingName } from "./easing.js";

/**
 * A running tween and the handle a game holds on to (`docs/architecture/12-3d-toolkit.md` §4).
 *
 * A tween is created by `app.tweens.to(...)`, advanced once per frame in `PostUpdate`, and dies
 * with the app. Everything it needs is allocated in the constructor: advancing one costs a few
 * multiplications per channel and nothing on the heap (coding standards §7).
 */

/**
 * `loop: -1` means "repeat until stopped".
 *
 * @public
 */
export const TWEEN_LOOP_FOREVER = -1;

/**
 * How close to its total duration a tween has to get before it counts as finished, in seconds.
 *
 * @remarks
 * Ten frames of `0.1` add up to `0.9999999999999999`, not `1`, so a tween compared exactly against
 * its duration would always run one frame long and end a hair short of its destination. A
 * nanosecond of slack is far below any frame time and far above the accumulated error of a
 * realistic frame count.
 */
const COMPLETION_EPSILON = 1e-9;

/**
 * What `app.tweens.to(...)` accepts.
 *
 * @public
 */
export interface TweenOptions {
  /** How long one cycle takes, in seconds. Must be finite and greater than zero. */
  readonly duration: number;
  /** The curve, by name or as a custom `(t) => number`. Defaults to `"linear"`. */
  readonly ease?: EasingName | EasingFunction;
  /** How long to wait before the first cycle starts, in seconds. Defaults to `0`. */
  readonly delay?: number;
  /** How many extra cycles to run; `-1` repeats forever. Defaults to `0` — one cycle. */
  readonly loop?: number;
  /** Whether every other cycle plays backwards. Defaults to `false`. */
  readonly yoyo?: boolean;
  /**
   * Whether the tween keeps running while `app.pause()` holds. A tween that does advances on
   * `time.unscaledDeltaTime`; every other tween advances on `time.deltaTime` and is frozen by a
   * pause. Defaults to `false`.
   */
  readonly updateWhenPaused?: boolean;
  /** Called once when the tween finishes on its own or through {@link Tween.complete}. */
  readonly onComplete?: () => void;
}

/**
 * Builds the failure an out-of-domain option produces.
 *
 * @param option - The option name.
 * @param domain - What the option accepts, as prose.
 * @param value - What was passed.
 * @returns The error to throw.
 */
function rejectOption(option: string, domain: string, value: unknown): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidTweenOptions, `${option} must be ${domain}.`, {
    context: { option, domain, value: String(value) },
  });
}

/**
 * A tween in flight.
 *
 * @remarks
 * Endpoints are latched when the delay elapses, not when the tween is created, so two tweens queued
 * on one property in the same frame chain rather than fight.
 *
 * @example
 * ```ts
 * const tween = app.tweens.to(entity.transform, { position: { x: 5, y: 0, z: 0 } }, {
 *   duration: 1,
 *   ease: "cubicInOut",
 * });
 * tween.onComplete.connect(() => app.log.info("arrived"));
 * ```
 *
 * @public
 */
export class Tween {
  /** Fires once when the tween finishes, with the tween itself. Never fires after `stop`. */
  readonly onComplete: Signal<Tween> = new Signal<Tween>();

  /** Whether the tween runs while the app is paused. */
  readonly updateWhenPaused: boolean;

  readonly #target: object;

  readonly #channels: readonly TweenChannel[];

  readonly #duration: number;

  readonly #delay: number;

  readonly #loop: number;

  readonly #yoyo: boolean;

  readonly #ease: EasingFunction;

  readonly #onComplete: (() => void) | null;

  #elapsed = 0;

  #progress = 0;

  #started = false;

  #paused = false;

  #finished = false;

  #stopped = false;

  /**
   * Builds a tween. Games call `app.tweens.to(...)` instead.
   *
   * @param target - The object whose fields move.
   * @param props - The destination value of each field.
   * @param options - Duration, curve, delay, looping, and the completion callback.
   * @throws IgnifxError with code `IGX-0109` when an option is outside its domain.
   * @throws IgnifxError with code `IGX-0110` when a named field is not tweenable.
   *
   * @internal
   */
  constructor(target: object, props: Readonly<Record<string, TweenableValue>>, options: TweenOptions) {
    const duration = options.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw rejectOption("duration", "a finite number greater than zero", duration);
    }
    const delay = options.delay ?? 0;
    if (!Number.isFinite(delay) || delay < 0) {
      throw rejectOption("delay", "a finite number that is not negative", delay);
    }
    const loop = options.loop ?? 0;
    if (!Number.isInteger(loop) || loop < TWEEN_LOOP_FOREVER) {
      throw rejectOption("loop", "an integer of -1 or more", loop);
    }
    const ease = resolveEase(options.ease);
    if (ease === null) {
      throw rejectOption("ease", "a declared easing name or a custom (t) => number", options.ease);
    }
    const channels: TweenChannel[] = [];
    for (const key of Object.keys(props)) {
      const destination = props[key];
      if (destination !== undefined) {
        channels.push(new TweenChannel(target, key, destination));
      }
    }
    this.#target = target;
    this.#channels = channels;
    this.#duration = duration;
    this.#delay = delay;
    this.#loop = loop;
    this.#yoyo = options.yoyo ?? false;
    this.#ease = ease;
    this.#onComplete = options.onComplete ?? null;
    this.updateWhenPaused = options.updateWhenPaused ?? false;
  }

  /**
   * The object being tweened, for `stopAllOf`.
   *
   * @returns The object being tweened, for `stopAllOf`.
   */
  get target(): object {
    return this.#target;
  }

  /**
   * How far through the current cycle the tween is, in `[0, 1]`, after the yoyo reversal and before
   * the easing curve.
   *
   * @returns The normalized cycle time.
   */
  get progress(): number {
    return this.#progress;
  }

  /**
   * Whether the tween is still advancing.
   *
   * @returns Whether the tween is still advancing.
   */
  get isPlaying(): boolean {
    return !this.#paused && !this.#finished && !this.#stopped;
  }

  /**
   * Whether `pause` is holding the tween.
   *
   * @returns Whether `pause` is holding the tween.
   */
  get isPaused(): boolean {
    return this.#paused;
  }

  /**
   * Whether the tween has finished or been stopped and will never advance again.
   *
   * @returns Whether the tween has finished or been stopped and will never advance again.
   */
  get isDone(): boolean {
    return this.#finished || this.#stopped;
  }

  /** Holds the tween where it is; `resume` picks it back up. */
  pause(): void {
    this.#paused = true;
  }

  /** Releases a `pause`. */
  resume(): void {
    this.#paused = false;
  }

  /**
   * Ends the tween where it stands, leaving the target at its current value. `onComplete` does not
   * fire.
   */
  stop(): void {
    this.#stopped = true;
  }

  /**
   * Jumps the target to the tween's end value, then finishes it. `onComplete` fires, exactly as it
   * would have on the last frame.
   */
  complete(): void {
    if (this.isDone) {
      return;
    }
    this.#ensureStarted();
    this.#writeEnd();
    this.#finish();
  }

  /**
   * Advances the tween by one frame's worth of time.
   *
   * @param dt - Seconds to advance by, already chosen for this tween's `updateWhenPaused`.
   * @returns `true` when the tween is done and should leave the list.
   *
   * @internal
   */
  advance(dt: number): boolean {
    if (this.#stopped || this.#finished) {
      return true;
    }
    if (this.#paused) {
      return false;
    }
    this.#elapsed += dt;
    if (this.#elapsed < this.#delay) {
      return false;
    }
    this.#ensureStarted();
    const local = this.#elapsed - this.#delay;
    const cycles = local / this.#duration;
    let index = Math.floor(cycles);
    let fraction = cycles - index;
    let done = false;
    if (this.#loop !== TWEEN_LOOP_FOREVER && local >= this.#duration * (this.#loop + 1) - COMPLETION_EPSILON) {
      index = this.#loop;
      fraction = 1;
      done = true;
    }
    if (this.#yoyo && index % 2 === 1) {
      fraction = 1 - fraction;
    }
    this.#progress = fraction;
    this.#write(fraction);
    if (done) {
      this.#finish();
      return true;
    }
    return false;
  }

  /** Latches every channel's starting value, once. */
  #ensureStarted(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    for (let index = 0; index < this.#channels.length; index += 1) {
      this.#channels[index]?.capture(this.#target);
    }
  }

  /** Writes the value the tween ends on, honouring `yoyo`. */
  #writeEnd(): void {
    const last = this.#loop === TWEEN_LOOP_FOREVER ? 0 : this.#loop;
    const fraction = this.#yoyo && last % 2 === 1 ? 0 : 1;
    this.#progress = fraction;
    this.#write(fraction);
  }

  /**
   * Applies the eased value of `fraction` to every channel.
   *
   * @param fraction - The normalized cycle time.
   */
  #write(fraction: number): void {
    const eased = this.#ease(fraction);
    for (let index = 0; index < this.#channels.length; index += 1) {
      this.#channels[index]?.apply(this.#target, eased);
    }
  }

  /** Marks the tween finished and fires both completion hooks, in declaration order. */
  #finish(): void {
    this.#finished = true;
    this.#onComplete?.();
    this.onComplete.emit(this);
  }
}
