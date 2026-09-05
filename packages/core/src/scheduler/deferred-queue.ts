import type { DeferredQueue } from "../signal/signal.js";

/**
 * The `EndOfFrame` queue (`docs/architecture/01-lifecycle-and-time.md` §3 step 0,
 * `02-scene-graph.md` §8). A `{ deferred: true }` signal connection and anything else that wants to
 * run "later, but still inside a phase" enqueues here; the scheduler drains the queue at the top of
 * the **next** frame.
 *
 * @remarks
 * Draining swaps the pending array for a scratch one before running anything, so work enqueued *by*
 * a deferred callback lands in the following frame rather than extending the current drain into an
 * unbounded loop. Both arrays are reused, so a steady stream of deferred deliveries allocates
 * nothing per frame (coding standards §7).
 *
 * @internal
 */
export class EndOfFrameQueue implements DeferredQueue {
  #pending: (() => void)[] = [];

  #running: (() => void)[] = [];

  readonly #onError: (error: unknown) => void;

  /**
   * Creates the queue of one app.
   *
   * @param onError - Where a deferred callback's exception is reported. It must not throw.
   */
  constructor(onError: (error: unknown) => void) {
    this.#onError = onError;
  }

  /**
   * How much work is waiting for the next drain.
   *
   * @returns The number of queued callbacks.
   */
  get length(): number {
    return this.#pending.length;
  }

  /**
   * Queues a callback for the next frame's `EndOfFrame` step.
   *
   * @param callback - The delivery to run.
   */
  enqueue(callback: () => void): void {
    this.#pending.push(callback);
  }

  /**
   * Runs everything queued before this call, in queue order.
   *
   * @returns How many callbacks ran.
   */
  drain(): number {
    const batch = this.#pending;
    const count = batch.length;
    if (count === 0) {
      return 0;
    }
    this.#pending = this.#running;
    this.#running = batch;
    for (let index = 0; index < count; index += 1) {
      const callback = batch[index];
      if (callback === undefined) {
        continue;
      }
      try {
        callback();
      } catch (error) {
        this.#onError(error);
      }
    }
    batch.length = 0;
    return count;
  }

  /** Drops every queued callback, for app disposal. */
  clear(): void {
    this.#pending.length = 0;
    this.#running.length = 0;
  }
}
