/**
 * The wall clock the runtime reads (`docs/architecture/01-lifecycle-and-time.md` §2, §8). It is a
 * one-method interface so headless runs and tests can inject a clock they control: "tests must not
 * depend on wall-clock time" (§8, coding standards §10).
 */

/**
 * A source of monotonically non-decreasing milliseconds.
 *
 * @remarks
 * Only `Time.realtimeSinceStartup` and the development-only phase timings read it; frame deltas are
 * supplied by Babylon Lite's render loop or by `app.step(dt)`, never measured from this clock, so
 * swapping the clock never changes simulation results (`CONSTITUTION.md` §2.1).
 *
 * @example
 * ```ts
 * const clock = createManualClock();
 * const app = await createApp({ headless: true, clock });
 * clock.advance(1000); // app.time.realtimeSinceStartup === 1
 * ```
 *
 * @public
 */
export interface Clock {
  /**
   * Reads the clock.
   *
   * @returns Milliseconds since an unspecified epoch; only differences are meaningful.
   */
  nowMs(): number;
}

/**
 * A clock that only moves when a test moves it.
 *
 * @public
 */
export interface ManualClock extends Clock {
  /**
   * Moves the clock forward.
   *
   * @param milliseconds - How far to advance. Negative values are rejected so the clock stays
   * monotonic.
   */
  advance(milliseconds: number): void;
  /**
   * Sets the clock to an absolute reading.
   *
   * @param milliseconds - The new reading.
   */
  set(milliseconds: number): void;
}

/**
 * Creates the default clock: `performance.now()` where the host has it, `Date.now()` otherwise.
 *
 * @returns A clock reading the host's monotonic timer.
 *
 * @public
 */
export function createPerformanceClock(): Clock {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return { nowMs: () => performance.now() };
  }
  return { nowMs: () => Date.now() };
}

/**
 * Creates a clock a test drives by hand. Headless apps take one so that `realtimeSinceStartup` and
 * `waitSecondsRealtime` are as deterministic as the rest of the frame
 * (`docs/architecture/01-lifecycle-and-time.md` §8).
 *
 * @param startMs - The initial reading. Defaults to `0`.
 * @returns The clock, with `advance` and `set`.
 *
 * @example
 * ```ts
 * const clock = createManualClock(1000);
 * clock.advance(1000 / 60);
 * clock.nowMs(); // 1016.666…
 * ```
 *
 * @public
 */
export function createManualClock(startMs: number = 0): ManualClock {
  let now = startMs;
  return {
    nowMs: (): number => now,
    advance: (milliseconds: number): void => {
      if (milliseconds > 0) {
        now += milliseconds;
      }
    },
    set: (milliseconds: number): void => {
      now = milliseconds;
    },
  };
}
