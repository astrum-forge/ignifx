/**
 * The per-frame counters the loop publishes (`docs/architecture/01-lifecycle-and-time.md` §9) and
 * the fixed-size CPU timing array they carry.
 */

/**
 * How many update phases the frame loop times. The kernel owns the `Phase` names and their ordinals;
 * diagnostics only needs to know how many slots to preallocate, which keeps the two modules
 * independent.
 *
 * @public
 */
export const PHASE_COUNT = 6;

/**
 * A slot in {@link FrameSample.cpuMs}. The kernel's `Phase` ordinals index this array.
 *
 * @public
 */
export type PhaseIndex = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * One frame's counters.
 *
 * @remarks
 * The numeric fields are mutable on purpose: the frame loop writes them in place so that publishing
 * diagnostics costs no allocation (coding standards §7). Everything outside the loop treats a
 * sample as read-only, and history samples are read through
 * {@link Diagnostics.readFrame} into a caller-owned sample.
 *
 * @public
 */
export interface FrameSample {
  /** The monotonically increasing frame number, starting at 1. */
  frame: number;
  /** The wall-clock delta the loop was handed, before clamping, in milliseconds. */
  rawDeltaMs: number;
  /** How much of `rawDeltaMs` was discarded by the maximum-delta clamp, in milliseconds. */
  droppedMs: number;
  /** How many fixed steps ran this frame. */
  fixedSteps: number;
  /** How many scripts received `update` this frame. */
  scriptsUpdated: number;
  /** How many coroutines were resumed this frame. */
  coroutinesResumed: number;
  /** How many entities and components were destroyed in this frame's flush. */
  destroyed: number;
  /**
   * CPU milliseconds per phase, indexed by {@link PhaseIndex}. Always {@link PHASE_COUNT} long, and
   * filled only while the app is in development mode — every entry is `0` otherwise.
   *
   * @remarks
   * "Development mode" is `createApp({ mode })`, and nothing else. It is **not** the bundler's mode:
   * `mode` defaults to `"development"` and no ignifx tooling overrides it, so a `vite build` of a
   * game that never passes `mode` still records these timings. A project that wants them gone from
   * its shipped build passes `mode: "production"` itself — for example
   * `createApp({ mode: import.meta.env.PROD ? "production" : "development" })` — and a probe that
   * reads `cpuMs` then reports zeros.
   */
  readonly cpuMs: Float64Array;
}

/**
 * Allocates a frame sample with every counter at zero. Call it once, outside the frame loop — the
 * `out` parameter of {@link Diagnostics.readFrame} exists so that reading history never allocates.
 *
 * @returns A zeroed sample.
 *
 * @example
 * ```ts
 * const sample = createFrameSample();
 * for (let index = 0; index < app.diagnostics.historyLength; index += 1) {
 *   app.diagnostics.readFrame(index, sample);
 *   graph.push(sample.rawDeltaMs);
 * }
 * ```
 *
 * @public
 */
export function createFrameSample(): FrameSample {
  return {
    frame: 0,
    rawDeltaMs: 0,
    droppedMs: 0,
    fixedSteps: 0,
    scriptsUpdated: 0,
    coroutinesResumed: 0,
    destroyed: 0,
    cpuMs: new Float64Array(PHASE_COUNT),
  };
}

/**
 * Zeroes every counter of a sample in place, reusing its `cpuMs` array.
 *
 * @param sample - The sample to reset.
 * @returns The same sample, so it can be used as an expression.
 *
 * @public
 */
export function resetFrameSample(sample: FrameSample): FrameSample {
  sample.frame = 0;
  sample.rawDeltaMs = 0;
  sample.droppedMs = 0;
  sample.fixedSteps = 0;
  sample.scriptsUpdated = 0;
  sample.coroutinesResumed = 0;
  sample.destroyed = 0;
  sample.cpuMs.fill(0);
  return sample;
}
