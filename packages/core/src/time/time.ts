import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { Clock } from "./clock.js";
import type { Time } from "../app/types.js";

/**
 * The implementation of {@link Time} (`docs/architecture/01-lifecycle-and-time.md` §2). The
 * scheduler owns one per app and drives it through {@link TimeImpl.beginFrame},
 * {@link TimeImpl.beginFixedStep}, and {@link TimeImpl.endFixedLoop}; everything else reads it.
 */

/** The default fixed step, in seconds (`01-lifecycle-and-time.md` §2). */
export const DEFAULT_FIXED_DELTA_TIME: number = 1 / 60;

/** The default upper clamp on one frame's delta, in seconds. */
export const DEFAULT_MAXIMUM_DELTA_TIME = 0.1;

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Rejects a value that is outside a `Time` property's documented domain.
 *
 * @param property - The property being written, for the message.
 * @param value - The offending value.
 * @param domain - A prose description of the domain, for example `"a positive finite number"`.
 * @throws IgnifxError with code `IGX-0108` always.
 */
function rejectTimeValue(property: string, value: number, domain: string): never {
  throw new IgnifxError(CoreErrorCode.invalidTimeValue, `time.${property} must be ${domain}; got ${String(value)}.`, {
    context: { property, value, domain },
    hint: "Time values are seconds; a zero or negative fixed step would make the fixed loop unbounded.",
  });
}

/**
 * The app clock.
 *
 * @remarks
 * **When a `fixedDeltaTime` write takes effect.** §2 allows the write "between frames only (a set
 * during a frame takes effect at the next frame start)". A write made while a frame is running is
 * therefore buffered and applied by the next {@link TimeImpl.beginFrame}, and the getter keeps
 * reporting the step the frame is actually running at — which is what makes §4's guarantee that
 * `fixedUpdate` receives `dt === time.fixedDeltaTime` hold even when a script changes the step from
 * inside a callback. A write made between frames applies immediately, because there is no frame for
 * it to disagree with.
 *
 * @internal
 */
export class TimeImpl implements Time {
  readonly #clock: Clock;

  readonly #startMs: number;

  #deltaTime = 0;

  #unscaledDeltaTime = 0;

  #fixedDeltaTime: number = DEFAULT_FIXED_DELTA_TIME;

  #pendingFixedDeltaTime: number | null = null;

  #timeScale = 1;

  #maximumDeltaTime: number = DEFAULT_MAXIMUM_DELTA_TIME;

  #time = 0;

  #unscaledTime = 0;

  #fixedTime = 0;

  #frameCount = 0;

  #inFixedStep = false;

  #fixedStepAlpha = 0;

  #isInsideFrame = false;

  /** Seconds of the raw delta the {@link Time.maximumDeltaTime} clamp discarded this frame. */
  droppedSeconds = 0;

  /** Whether `app.pause()` is in effect. */
  paused = false;

  /**
   * Creates the clock of one app.
   *
   * @param clock - The wall clock behind {@link Time.realtimeSinceStartup}.
   */
  constructor(clock: Clock) {
    this.#clock = clock;
    this.#startMs = clock.nowMs();
  }

  /**
   * Scaled seconds since the previous frame.
   *
   * @returns The scaled delta.
   */
  get deltaTime(): number {
    return this.#deltaTime;
  }

  /**
   * Wall-clock frame delta after the {@link Time.maximumDeltaTime} clamp.
   *
   * @returns The unscaled delta.
   */
  get unscaledDeltaTime(): number {
    return this.#unscaledDeltaTime;
  }

  /**
   * The size of one fixed step, in seconds.
   *
   * @returns The step the current frame is running at.
   */
  get fixedDeltaTime(): number {
    return this.#fixedDeltaTime;
  }

  /**
   * Changes the fixed step. A write made while a frame is running takes effect at the next frame
   * start (§2).
   *
   * @param value - The new step in seconds; must be positive and finite.
   * @throws IgnifxError with code `IGX-0108` when the value is not a positive finite number.
   */
  set fixedDeltaTime(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      rejectTimeValue("fixedDeltaTime", value, "a positive finite number of seconds");
    }
    if (this.#isInsideFrame) {
      this.#pendingFixedDeltaTime = value;
      return;
    }
    this.#fixedDeltaTime = value;
    this.#pendingFixedDeltaTime = null;
  }

  /**
   * The multiplier applied to {@link Time.unscaledDeltaTime}.
   *
   * @returns The current scale.
   */
  get timeScale(): number {
    return this.#timeScale;
  }

  /**
   * Changes the time scale. `0` freezes scaled time and, with it, the fixed loop.
   *
   * @param value - The new scale; must be a finite number that is not negative.
   * @throws IgnifxError with code `IGX-0108` when the value is negative or not finite.
   */
  set timeScale(value: number) {
    if (!Number.isFinite(value) || value < 0) {
      rejectTimeValue("timeScale", value, "a finite number that is not negative");
    }
    this.#timeScale = value;
  }

  /**
   * The upper clamp on one frame's delta, in seconds.
   *
   * @returns The clamp.
   */
  get maximumDeltaTime(): number {
    return this.#maximumDeltaTime;
  }

  /**
   * Changes the frame-delta clamp, which is also what bounds the number of fixed steps per frame.
   *
   * @param value - The new clamp in seconds; must be positive and finite.
   * @throws IgnifxError with code `IGX-0108` when the value is not a positive finite number.
   */
  set maximumDeltaTime(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      rejectTimeValue("maximumDeltaTime", value, "a positive finite number of seconds");
    }
    this.#maximumDeltaTime = value;
  }

  /**
   * Scaled seconds since the app started running frames.
   *
   * @returns The scaled elapsed time.
   */
  get time(): number {
    return this.#time;
  }

  /**
   * Unscaled seconds since the app started running frames.
   *
   * @returns The unscaled elapsed time.
   */
  get unscaledTime(): number {
    return this.#unscaledTime;
  }

  /**
   * Scaled seconds advanced by fixed steps so far.
   *
   * @returns The fixed-step clock.
   */
  get fixedTime(): number {
    return this.#fixedTime;
  }

  /**
   * Wall-clock seconds since the app was created, unaffected by pause or time scale.
   *
   * @returns The reading of the injected clock, relative to app creation.
   */
  get realtimeSinceStartup(): number {
    return (this.#clock.nowMs() - this.#startMs) / MILLISECONDS_PER_SECOND;
  }

  /**
   * How many frames have started.
   *
   * @returns The frame counter, starting at `0`.
   */
  get frameCount(): number {
    return this.#frameCount;
  }

  /**
   * Whether the fixed loop is running.
   *
   * @returns `true` between {@link TimeImpl.beginFixedStep} and {@link TimeImpl.endFixedLoop}.
   */
  get inFixedStep(): boolean {
    return this.#inFixedStep;
  }

  /**
   * The interpolation alpha left over from the fixed loop.
   *
   * @returns `accumulator / fixedDeltaTime`, in `[0, 1)`.
   */
  get fixedStepAlpha(): number {
    return this.#fixedStepAlpha;
  }

  /**
   * Step 1 of the frame (`01-lifecycle-and-time.md` §3): applies a buffered `fixedDeltaTime`
   * change, clamps the raw delta, scales it, and advances the counters.
   *
   * @param rawDeltaSeconds - The delta the driver supplied, before clamping. Non-finite and
   * negative values are treated as zero rather than corrupting the clock: they come from a render
   * loop, not from game code, so a diagnostic is the right response, not a throw.
   */
  beginFrame(rawDeltaSeconds: number): void {
    const pending = this.#pendingFixedDeltaTime;
    if (pending !== null) {
      this.#fixedDeltaTime = pending;
      this.#pendingFixedDeltaTime = null;
    }
    this.#isInsideFrame = true;
    const raw = Number.isFinite(rawDeltaSeconds) && rawDeltaSeconds > 0 ? rawDeltaSeconds : 0;
    const clamped = raw > this.#maximumDeltaTime ? this.#maximumDeltaTime : raw;
    this.droppedSeconds = raw - clamped;
    this.#unscaledDeltaTime = clamped;
    this.#deltaTime = clamped * this.#timeScale;
    this.#time += this.#deltaTime;
    this.#unscaledTime += this.#unscaledDeltaTime;
    this.#frameCount += 1;
  }

  /** Marks the end of the frame, so a `fixedDeltaTime` write applies immediately again. */
  endFrame(): void {
    this.#isInsideFrame = false;
  }

  /** Enters one fixed step: raises `inFixedStep` and advances `fixedTime`. */
  beginFixedStep(): void {
    this.#inFixedStep = true;
    this.#fixedTime += this.#fixedDeltaTime;
  }

  /**
   * Leaves the fixed loop and publishes the interpolation alpha.
   *
   * @param accumulator - What is left in the fixed-step accumulator, in seconds.
   */
  endFixedLoop(accumulator: number): void {
    this.#inFixedStep = false;
    const alpha = accumulator / this.#fixedDeltaTime;
    if (alpha <= 0) {
      this.#fixedStepAlpha = 0;
      return;
    }
    // The documented domain is `[0, 1)`; a residue that rounds up to one would break interpolation
    // consumers that assume the exclusive upper bound.
    this.#fixedStepAlpha = alpha >= 1 ? 1 - Number.EPSILON : alpha;
  }

  /**
   * Applies the resolved `time` settings section at app creation
   * (`docs/architecture/04-extensions.md` §5).
   *
   * @param fixedDeltaTime - The initial fixed step, when the section declares one.
   * @param maximumDeltaTime - The initial delta clamp, when the section declares one.
   * @param timeScale - The initial time scale, when the section declares one.
   */
  applySettings(fixedDeltaTime?: number, maximumDeltaTime?: number, timeScale?: number): void {
    if (fixedDeltaTime !== undefined) {
      this.fixedDeltaTime = fixedDeltaTime;
    }
    if (maximumDeltaTime !== undefined) {
      this.maximumDeltaTime = maximumDeltaTime;
    }
    if (timeScale !== undefined) {
      this.timeScale = timeScale;
    }
  }
}
