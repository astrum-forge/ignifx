import { assertNever } from "../errors/ignifx-error.js";
import type { Coroutine, CoroutineHandle, CoroutineHost, CoroutineYield, WaitInstruction } from "../app/types.js";
import type { FrameStateController } from "../lifecycle/frame-state.js";
import type { Script } from "../script/script.js";

/**
 * Resume coroutines synchronously after script updates or each fixed step (ADR-0010).
 * Promise callbacks only record results for the next update.
 *
 * A coroutine runs to its first yield immediately unless its owner is disabled. Timed waits end
 * when accumulated time reaches the requested duration. Stopping also detaches pending promises.
 */

/** What a suspended coroutine is waiting for. */
const WaitState = {
  /** `yield`, `yield null`, or `yield undefined`: the next `Update` resume point. */
  nextUpdate: 0,
  /** `waitSeconds(s)`: scaled time. */
  seconds: 1,
  /** `waitSecondsRealtime(s)`: unscaled time. */
  secondsRealtime: 2,
  /** `waitFixedUpdate()`: the point just after the next fixed step. */
  fixedUpdate: 3,
  /** `waitUntil(pred)`. */
  until: 4,
  /** `waitWhile(pred)`. */
  whileTrue: 5,
  /** `yield handle`: another coroutine finishing. */
  handle: 6,
  /** `yield promise`: the first `Update` after the promise settles. */
  promise: 7,
} as const;

/** The union of {@link WaitState} ordinals. */
type WaitState = (typeof WaitState)[keyof typeof WaitState];

/**
 * Relative slack applied to a timed wait, mirroring the fixed-step accumulator's snapping rule
 * (`docs/architecture/01-lifecycle-and-time.md` §3 notes).
 */
const WAIT_TOLERANCE = 1e-6;

/**
 * The handle `Script.startCoroutine` returns. It carries a back-reference to its record so that
 * `stopCoroutine(handle)` is O(1) and so that a handle from another app is rejected by identity.
 */
class CoroutineHandleImpl implements CoroutineHandle {
  /** `true` while the coroutine is still scheduled, including while it is paused. */
  isRunning = true;

  /** `true` once the coroutine finished, was stopped, or was cancelled. */
  isDone = false;

  /** The record this handle addresses, or `null` once the coroutine has finished. */
  record: CoroutineRecord | null = null;
}

/** One scheduled coroutine. Every field is mutated in place; the record itself is never copied. */
class CoroutineRecord {
  /** The script whose enabled state gates the coroutine. */
  readonly owner: Script;

  /** The generator, or `null` once the coroutine has finished. */
  routine: Coroutine | null;

  /** The handle handed to game code. */
  readonly handle: CoroutineHandleImpl;

  /** What the coroutine is waiting for. */
  wait: WaitState = WaitState.nextUpdate;

  /** Seconds still to wait, for the two timed waits. */
  remaining = 0;

  /**
   * How close to zero {@link CoroutineRecord.remaining} has to get before the wait counts as
   * elapsed. Repeated subtraction of a scaled delta rarely cancels exactly in binary floating
   * point, so the same relative `1e-6` slack the fixed-step accumulator uses
   * (`01-lifecycle-and-time.md` §3 notes) is applied here.
   */
  tolerance = 0;

  /** The condition, for the two predicate waits. */
  predicate: (() => boolean) | null = null;

  /** The coroutine being waited on, for `yield handle`. */
  awaited: CoroutineHandle | null = null;

  /** Whether the awaited promise has settled since the wait began. */
  isSettled = false;

  /** Whether the settled promise rejected, in which case the reason is thrown into the generator. */
  isRejected = false;

  /** The settled value or the rejection reason. */
  settled: unknown = null;

  /** The value handed to the next `routine.next(...)`. */
  resumeValue: unknown = undefined;

  /** `true` while the owning script is not effectively enabled. */
  isPaused = false;

  /**
   * Bumped whenever the coroutine finishes, so a promise continuation captured before that point
   * recognises itself as stale and does nothing (§5, "any promise it was waiting on is detached").
   */
  generation = 0;

  /**
   * Creates a record.
   *
   * @param owner - The owning script.
   * @param routine - The generator to drive.
   */
  constructor(owner: Script, routine: Coroutine) {
    this.owner = owner;
    this.routine = routine;
    this.handle = new CoroutineHandleImpl();
    this.handle.record = this;
  }
}

/**
 * What the host needs from the app.
 *
 * @internal
 */
export interface CoroutineHostOptions {
  /** The frame state, so a coroutine body counts as "inside a callback". */
  readonly frameState: FrameStateController;
  /**
   * Reports an exception a coroutine threw.
   *
   * @param error - Whatever was thrown.
   * @param owner - The script that owns the coroutine.
   */
  report(error: unknown, owner: Script): void;
}

/**
 * The coroutine scheduler of one app.
 *
 * @internal
 */
export class CoroutineHostImpl implements CoroutineHost {
  readonly #frameState: FrameStateController;

  readonly #report: (error: unknown, owner: Script) => void;

  readonly #records: CoroutineRecord[] = [];

  readonly #byOwner = new Map<Script, CoroutineRecord[]>();

  #deadCount = 0;

  #walkDepth = 0;

  /**
   * Creates the scheduler of one app.
   *
   * @param options - The frame state and the error reporter.
   */
  constructor(options: CoroutineHostOptions) {
    this.#frameState = options.frameState;
    this.#report = (error: unknown, owner: Script): void => {
      options.report(error, owner);
    };
  }

  /**
   * How many coroutines are scheduled, paused ones included.
   *
   * @returns The live coroutine count.
   */
  get count(): number {
    return this.#records.length - this.#deadCount;
  }

  /**
   * Schedules a coroutine owned by a script and runs its first segment when the script is
   * effectively enabled.
   *
   * @param owner - The script whose enabled state gates the coroutine.
   * @param routine - The generator to drive.
   * @returns A handle for stopping it or waiting on it.
   */
  start(owner: Script, routine: Coroutine): CoroutineHandle {
    const record = new CoroutineRecord(owner, routine);
    this.#records.push(record);
    let owned = this.#byOwner.get(owner);
    if (owned === undefined) {
      owned = [];
      this.#byOwner.set(owner, owned);
    }
    owned.push(record);
    if (owner.isDestroyed || !owner.isEnabledInHierarchy) {
      record.isPaused = true;
      return record.handle;
    }
    this.#advance(record);
    return record.handle;
  }

  /**
   * Stops one coroutine. Stopping a finished coroutine, or a handle from another app, is a no-op.
   *
   * @param handle - The handle {@link CoroutineHostImpl.start} returned.
   */
  stop(handle: CoroutineHandle): void {
    if (!(handle instanceof CoroutineHandleImpl)) {
      return;
    }
    const record = handle.record;
    if (record !== null) {
      this.#finish(record);
    }
  }

  /**
   * Stops every coroutine a script started.
   *
   * @param owner - The owning script.
   */
  stopAll(owner: Script): void {
    this.#finishOwned(owner);
  }

  /**
   * Pauses or resumes every coroutine a script started.
   *
   * @param owner - The owning script.
   * @param paused - `true` to pause, `false` to resume.
   */
  setPaused(owner: Script, paused: boolean): void {
    const owned = this.#byOwner.get(owner);
    if (owned === undefined) {
      return;
    }
    for (let index = 0; index < owned.length; index += 1) {
      const record = owned[index];
      if (record !== undefined) {
        record.isPaused = paused;
      }
    }
  }

  /**
   * Cancels every coroutine a script started and detaches any promise they were waiting on.
   *
   * @param owner - The owning script.
   */
  cancelAll(owner: Script): void {
    this.#finishOwned(owner);
  }

  /**
   * The `Update` resume point (`01-lifecycle-and-time.md` §3 step 6), run after every script's
   * `update`.
   *
   * @param deltaTime - Scaled seconds this frame, for `waitSeconds`.
   * @param unscaledDeltaTime - Unscaled seconds this frame, for `waitSecondsRealtime`.
   * @returns How many coroutines were resumed.
   */
  resumeUpdate(deltaTime: number, unscaledDeltaTime: number): number {
    let resumed = this.#walk(WaitState.nextUpdate, deltaTime, unscaledDeltaTime);
    // A coroutine waiting on another's handle must not care whether it was started before or after
    // the one it waits for: extra passes over the handle waits alone make the outcome the same
    // either way, and they terminate because a coroutine can only finish once.
    for (;;) {
      const again = this.#walkHandleWaiters();
      if (again === 0) {
        break;
      }
      resumed += again;
    }
    return resumed;
  }

  /**
   * The fixed-step resume point (§3 step 4), run after each fixed step.
   *
   * @returns How many coroutines were resumed.
   */
  resumeFixedUpdate(): number {
    return this.#walk(WaitState.fixedUpdate, 0, 0);
  }

  /** Cancels every coroutine and detaches every pending promise continuation, for app disposal. */
  dispose(): void {
    const records = this.#records;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record !== undefined && record.routine !== null) {
        this.#finish(record);
      }
    }
    records.length = 0;
    this.#byOwner.clear();
    this.#deadCount = 0;
  }

  /**
   * Resumes every coroutine whose awaited handle has finished, in one pass.
   *
   * @returns How many coroutines were resumed.
   */
  #walkHandleWaiters(): number {
    const records = this.#records;
    const count = records.length;
    let resumed = 0;
    this.#walkDepth += 1;
    for (let index = 0; index < count; index += 1) {
      const record = records[index];
      if (record === undefined || record.routine === null || record.isPaused || record.owner.isDestroyed) {
        continue;
      }
      if (record.wait !== WaitState.handle || record.awaited?.isDone !== true) {
        continue;
      }
      resumed += 1;
      this.#advance(record);
    }
    this.#walkDepth -= 1;
    if (this.#walkDepth === 0 && this.#deadCount > 0) {
      this.#compact();
    }
    return resumed;
  }

  /**
   * Walks the scheduled coroutines once, resuming those whose wait has elapsed.
   *
   * @param resumePoint - {@link WaitState.nextUpdate} for the `Update` point (which also serves the
   * timed, predicate, handle, and promise waits) or {@link WaitState.fixedUpdate} for the
   * post-fixed-step point.
   * @param deltaTime - Scaled seconds this frame.
   * @param unscaledDeltaTime - Unscaled seconds this frame.
   * @returns How many coroutines were resumed.
   */
  #walk(resumePoint: WaitState, deltaTime: number, unscaledDeltaTime: number): number {
    const records = this.#records;
    // The length is snapshotted, not the array: a coroutine started by another coroutine's
    // resumption first runs at the next resume point, and nothing is allocated to arrange that.
    const count = records.length;
    let resumed = 0;
    const isFixedPoint = resumePoint === WaitState.fixedUpdate;
    this.#walkDepth += 1;
    for (let index = 0; index < count; index += 1) {
      const record = records[index];
      if (record === undefined || record.routine === null || record.isPaused || record.owner.isDestroyed) {
        continue;
      }
      if (isFixedPoint !== (record.wait === WaitState.fixedUpdate)) {
        continue;
      }
      if (isFixedPoint || this.#isElapsed(record, deltaTime, unscaledDeltaTime)) {
        resumed += 1;
        this.#advance(record);
      }
    }
    this.#walkDepth -= 1;
    if (this.#walkDepth === 0 && this.#deadCount > 0) {
      this.#compact();
    }
    return resumed;
  }

  /**
   * Decides whether a coroutine's wait has elapsed at the `Update` resume point, advancing the
   * timed waits as a side effect.
   *
   * @param record - The suspended coroutine.
   * @param deltaTime - Scaled seconds this frame.
   * @param unscaledDeltaTime - Unscaled seconds this frame.
   * @returns `true` when the coroutine should be resumed now.
   */
  #isElapsed(record: CoroutineRecord, deltaTime: number, unscaledDeltaTime: number): boolean {
    switch (record.wait) {
      case WaitState.nextUpdate: {
        return true;
      }
      case WaitState.seconds: {
        record.remaining -= deltaTime;
        return record.remaining <= record.tolerance;
      }
      case WaitState.secondsRealtime: {
        record.remaining -= unscaledDeltaTime;
        return record.remaining <= record.tolerance;
      }
      case WaitState.until: {
        return this.#test(record) === true;
      }
      case WaitState.whileTrue: {
        return this.#test(record) === false;
      }
      case WaitState.handle: {
        return record.awaited?.isDone === true;
      }
      case WaitState.promise: {
        if (!record.isSettled) {
          return false;
        }
        record.isSettled = false;
        if (!record.isRejected) {
          record.resumeValue = record.settled;
          record.settled = null;
        }
        return true;
      }
      case WaitState.fixedUpdate: {
        return false;
      }
      default: {
        return assertNever(record.wait, "coroutine wait state");
      }
    }
  }

  /**
   * Evaluates a `waitUntil`/`waitWhile` predicate, guarded.
   *
   * @param record - The suspended coroutine.
   * @returns The predicate's result, or `null` when it threw — in which case the coroutine has
   * already been reported and cancelled.
   */
  #test(record: CoroutineRecord): boolean | null {
    const predicate = record.predicate;
    if (predicate === null) {
      return true;
    }
    const frameState = this.#frameState;
    frameState.beginCallback();
    try {
      return predicate();
    } catch (error) {
      this.#report(error, record.owner);
      this.#finish(record);
      return null;
    } finally {
      frameState.endCallback();
    }
  }

  /**
   * Drives one coroutine forward by one segment and records what it yielded.
   *
   * @param record - The coroutine to advance.
   */
  #advance(record: CoroutineRecord): void {
    const routine = record.routine;
    if (routine === null) {
      return;
    }
    const frameState = this.#frameState;
    frameState.beginCallback();
    let result: IteratorResult<CoroutineYield, void>;
    try {
      if (record.isRejected) {
        record.isRejected = false;
        const reason = record.settled;
        record.settled = null;
        result = routine.throw(reason);
      } else {
        const value = record.resumeValue;
        record.resumeValue = undefined;
        result = routine.next(value);
      }
    } catch (error) {
      this.#report(error, record.owner);
      this.#finish(record);
      return;
    } finally {
      frameState.endCallback();
    }
    if (result.done === true) {
      this.#finish(record);
      return;
    }
    this.#applyYield(record, result.value);
  }

  /**
   * Interprets what a coroutine yielded and files the matching wait.
   *
   * @param record - The coroutine that yielded.
   * @param yielded - The yielded value.
   */
  #applyYield(record: CoroutineRecord, yielded: CoroutineYield): void {
    record.predicate = null;
    record.awaited = null;
    if (yielded === null || yielded === undefined) {
      record.wait = WaitState.nextUpdate;
      return;
    }
    if ("kind" in yielded) {
      this.#applyWait(record, yielded);
      return;
    }
    if ("then" in yielded) {
      this.#awaitPromise(record, yielded);
      return;
    }
    record.wait = WaitState.handle;
    record.awaited = yielded;
  }

  /**
   * Files a {@link WaitInstruction}.
   *
   * @param record - The coroutine that yielded it.
   * @param instruction - The instruction built by `waitSeconds` and friends.
   */
  #applyWait(record: CoroutineRecord, instruction: WaitInstruction): void {
    switch (instruction.kind) {
      case "seconds": {
        record.wait = WaitState.seconds;
        record.remaining = instruction.seconds ?? 0;
        record.tolerance = Math.abs(record.remaining) * WAIT_TOLERANCE;
        return;
      }
      case "secondsRealtime": {
        record.wait = WaitState.secondsRealtime;
        record.remaining = instruction.seconds ?? 0;
        record.tolerance = Math.abs(record.remaining) * WAIT_TOLERANCE;
        return;
      }
      case "fixedUpdate": {
        record.wait = WaitState.fixedUpdate;
        return;
      }
      case "until": {
        record.wait = WaitState.until;
        record.predicate = instruction.predicate ?? null;
        return;
      }
      case "while": {
        record.wait = WaitState.whileTrue;
        record.predicate = instruction.predicate ?? null;
        return;
      }
      default: {
        assertNever(instruction.kind, "coroutine wait instruction");
      }
    }
  }

  /**
   * Bridges a promise into the frame (ADR-0010): the continuation records the outcome and the
   * scheduler resumes the coroutine at the first `Update` after that.
   *
   * @param record - The coroutine that yielded the promise.
   * @param promise - The promise it yielded.
   */
  #awaitPromise(record: CoroutineRecord, promise: PromiseLike<unknown>): void {
    record.wait = WaitState.promise;
    record.isSettled = false;
    record.isRejected = false;
    record.settled = null;
    const generation = record.generation;
    // Deliberately not awaited (coding standards §8): this is bookkeeping, not control flow. The
    // generation check is what makes a settlement that arrives after the coroutine was cancelled —
    // by `stop`, by destruction, or by app disposal — do nothing at all (§5).
    void Promise.resolve(promise).then(
      (value: unknown): void => {
        if (record.generation === generation) {
          record.isSettled = true;
          record.settled = value;
        }
      },
      (reason: unknown): void => {
        if (record.generation === generation) {
          record.isSettled = true;
          record.isRejected = true;
          record.settled = reason;
        }
      },
    );
  }

  /**
   * Finishes every coroutine one script owns.
   *
   * @param owner - The owning script.
   */
  #finishOwned(owner: Script): void {
    const owned = this.#byOwner.get(owner);
    if (owned === undefined) {
      return;
    }
    // A copy of the length only: `#finish` tombstones rather than splicing, so the list is stable.
    for (let index = 0; index < owned.length; index += 1) {
      const record = owned[index];
      if (record !== undefined && record.routine !== null) {
        this.#finish(record);
      }
    }
  }

  /**
   * Retires a coroutine: its generator is dropped, its handle reports `isDone`, and any promise it
   * was waiting on is detached.
   *
   * @param record - The coroutine to retire.
   */
  #finish(record: CoroutineRecord): void {
    if (record.routine === null) {
      return;
    }
    record.routine = null;
    record.generation += 1;
    record.predicate = null;
    record.awaited = null;
    record.settled = null;
    record.resumeValue = undefined;
    record.handle.isRunning = false;
    record.handle.isDone = true;
    record.handle.record = null;
    this.#deadCount += 1;
    if (this.#walkDepth === 0) {
      this.#compact();
    }
  }

  /** Removes retired coroutines from the schedule and from their owner's list. */
  #compact(): void {
    const records = this.#records;
    let write = 0;
    for (let read = 0; read < records.length; read += 1) {
      const record = records[read];
      if (record === undefined) {
        continue;
      }
      if (record.routine === null) {
        this.#detach(record);
        continue;
      }
      records[write] = record;
      write += 1;
    }
    records.length = write;
    this.#deadCount = 0;
  }

  /**
   * Removes a retired coroutine from its owner's list, dropping the list when it empties so the map
   * does not grow with every script that ever ran one.
   *
   * @param record - The retired coroutine.
   */
  #detach(record: CoroutineRecord): void {
    const owned = this.#byOwner.get(record.owner);
    if (owned === undefined) {
      return;
    }
    const at = owned.indexOf(record);
    if (at >= 0) {
      const last = owned.length - 1;
      const moved = owned[last];
      if (at !== last && moved !== undefined) {
        owned[at] = moved;
      }
      owned.pop();
    }
    if (owned.length === 0) {
      this.#byOwner.delete(record.owner);
    }
  }
}
