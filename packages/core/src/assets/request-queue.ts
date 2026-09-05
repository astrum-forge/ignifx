/**
 * The priority queue in front of the network
 * (`docs/architecture/05-assets-and-loading.md` §4: "Requests are scheduled through a priority
 * queue with a concurrency limit (default 6 concurrent fetches)").
 *
 * Decision the documents leave open: **the limit gates fetches, not whole loader runs.** §4 counts
 * "concurrent fetches", and gating loader runs instead would deadlock the moment a loader used
 * `loadDependency`: the parent would hold a slot while waiting for a child that cannot get one.
 * With the limit on `ctx.fetchBytes`/`fetchText`/`fetchJson`, a loader waiting on a dependency
 * holds nothing, and the number of sockets in flight is still exactly what §4 promises.
 *
 * Ordering: higher `priority` first, and first-come first-served within one priority.
 */

/** One request waiting for a slot. */
interface QueuedTask {
  /** Higher runs first. */
  readonly priority: number;
  /** Enqueue serial; the tie-breaker that makes one priority band first-come first-served. */
  readonly serial: number;
  /** Takes a slot and runs the task. */
  start(): void;
  /**
   * Fails the task without ever running it.
   *
   * @param reason - What to reject the caller's promise with.
   */
  reject(reason: unknown): void;
}

/**
 * The concurrency limit an unconfigured queue uses (§4).
 *
 * @public
 */
export const DEFAULT_ASSET_CONCURRENCY = 6;

/**
 * A bounded, priority-ordered runner for asynchronous work.
 *
 * @internal
 */
export class RequestQueue {
  /** How many tasks may run at once. Changing it takes effect at the next completion. */
  concurrency: number;

  readonly #pending: QueuedTask[] = [];

  #active = 0;

  #serial = 0;

  /**
   * Creates a queue.
   *
   * @param concurrency - How many tasks may run at once. Defaults to
   * {@link DEFAULT_ASSET_CONCURRENCY}.
   */
  constructor(concurrency: number = DEFAULT_ASSET_CONCURRENCY) {
    this.concurrency = concurrency;
  }

  /**
   * How many tasks are waiting for a slot.
   *
   * @returns The pending count, which diagnostics reports as `queued`.
   */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /**
   * How many tasks are running.
   *
   * @returns The active count, which diagnostics reports as `inFlight`.
   */
  get activeCount(): number {
    return this.#active;
  }

  /**
   * Schedules work and returns its result.
   *
   * @typeParam T - What the task produces.
   * @param priority - Higher runs first; ties break in enqueue order.
   * @param task - The work. It is not started until a slot is free.
   * @returns What the task produced.
   */
  run<T>(priority: number, task: () => Promise<T>): Promise<T> {
    this.#serial += 1;
    const serial = this.#serial;
    return new Promise<T>((resolve, reject) => {
      this.#pending.push({
        priority,
        serial,
        start: (): void => {
          this.#active += 1;
          // Bookkeeping, not control flow: the caller's promise is what carries the outcome
          // (coding standards §8).
          void task().then(
            (value: T): void => {
              this.#finish();
              resolve(value);
            },
            (error: unknown): void => {
              this.#finish();
              reject(error);
            },
          );
        },
        reject,
      });
      this.#pump();
    });
  }

  /**
   * Fails every task that has not started yet — what disposal does so no loader waits forever.
   *
   * @param reason - What to reject the waiting callers with.
   */
  clear(reason: unknown): void {
    const pending = this.#pending.slice();
    this.#pending.length = 0;
    for (let index = 0; index < pending.length; index += 1) {
      pending[index]?.reject(reason);
    }
  }

  /** Frees a slot and starts whatever was waiting for it. */
  #finish(): void {
    this.#active -= 1;
    this.#pump();
  }

  /** Starts waiting tasks while there are slots for them. */
  #pump(): void {
    while (this.#active < this.concurrency) {
      const index = this.#bestIndex();
      if (index < 0) {
        return;
      }
      const task = this.#pending[index];
      this.#pending.splice(index, 1);
      // `start` takes the slot synchronously, so the loop always terminates.
      task?.start();
    }
  }

  /**
   * Finds the task that should run next.
   *
   * @returns Its index, or `-1` when nothing is waiting.
   */
  #bestIndex(): number {
    const pending = this.#pending;
    let best = -1;
    let bestPriority = 0;
    let bestSerial = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const task = pending[index];
      if (task === undefined) {
        continue;
      }
      if (best < 0 || task.priority > bestPriority || (task.priority === bestPriority && task.serial < bestSerial)) {
        best = index;
        bestPriority = task.priority;
        bestSerial = task.serial;
      }
    }
    return best;
  }
}
