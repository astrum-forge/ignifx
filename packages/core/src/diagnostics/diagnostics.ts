import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { createDiagnosticsGroup, type DiagnosticsGroup } from "./diagnostics-group.js";
import { createFrameSample, PHASE_COUNT, resetFrameSample, type FrameSample } from "./frame-sample.js";

/**
 * How many frames of history {@link Diagnostics} keeps by default — five seconds at 60 fps, which is
 * what the devtools graphs plot (`docs/architecture/15-devtools-and-diagnostics.md` §3).
 *
 * @public
 */
export const FRAME_HISTORY_LENGTH = 300;

/**
 * A timing scope opened by {@link Diagnostics.profile}. Ending it twice is a no-op.
 *
 * @remarks
 * Scopes are pooled per nesting depth, so opening one allocates nothing after the first frame, and
 * outside development builds `profile` returns a shared scope that does nothing at all.
 *
 * @public
 */
export interface ProfileScope {
  /**
   * How long the scope was open, in milliseconds of the diagnostics clock. Valid between
   * {@link ProfileScope.end} and the next {@link Diagnostics.profile} call at the same nesting
   * depth, because scopes are pooled. Always `0` outside development builds.
   */
  readonly durationMs: number;

  /** Closes the scope and, in development, records a `performance.measure` entry. */
  end(): void;
}

/**
 * Options for the {@link Diagnostics} constructor.
 *
 * @public
 */
export interface DiagnosticsOptions {
  /**
   * Whether this is a development build. Per-phase CPU timings and `performance.mark`/`measure`
   * entries are only produced when it is `true`. Defaults to `false`.
   */
  readonly development?: boolean;
  /**
   * The clock used for profile scopes, in milliseconds. Defaults to `performance.now` when the host
   * has it and `Date.now` otherwise; tests pass a counter so timings are deterministic.
   */
  readonly now?: () => number;
  /** How many frames of history to keep. Defaults to {@link FRAME_HISTORY_LENGTH}. */
  readonly historyLength?: number;
}

/**
 * Picks the default clock: the high-resolution monotonic one when the host exposes it.
 *
 * @returns A function returning milliseconds.
 */
function defaultNow(): () => number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return () => performance.now();
  }
  return () => Date.now();
}

/**
 * Reads one slot of a preallocated array.
 *
 * @remarks
 * `noUncheckedIndexedAccess` widens every typed-array read to `number | undefined`. Each index here
 * is derived from the array's own length, so the fallback is unreachable; funnelling the reads
 * through one helper keeps that concession in a single place.
 *
 * @param array - The array to read.
 * @param index - The slot, always in range.
 * @returns The stored value.
 */
function readSlot(array: Float64Array, index: number): number {
  return array[index] ?? 0;
}

/**
 * Reports whether the host implements the User Timing entries `profile` writes.
 *
 * @returns `true` when `performance.mark` and `performance.measure` are callable.
 */
function hasUserTiming(): boolean {
  return (
    typeof performance !== "undefined" &&
    typeof performance.mark === "function" &&
    typeof performance.measure === "function"
  );
}

class ProfileScopeImpl implements ProfileScope {
  name = "";
  depth = 0;
  startMs = 0;
  durationMs = 0;
  isActive = false;
  readonly #onEnd: (scope: ProfileScopeImpl) => void;

  constructor(onEnd: (scope: ProfileScopeImpl) => void) {
    this.#onEnd = onEnd;
  }

  end(): void {
    if (!this.isActive) {
      return;
    }
    this.isActive = false;
    this.#onEnd(this);
  }
}

/** The scope handed out when profiling is off; ending it does nothing. */
const INACTIVE_SCOPE: ProfileScope = {
  durationMs: 0,
  end(): void {
    // Profiling is a development-only facility; outside development there is nothing to record.
  },
};

/**
 * The frame-sampled counters reached as `app.diagnostics`
 * (`docs/architecture/15-devtools-and-diagnostics.md` §3).
 *
 * @remarks
 * Nothing on the per-frame path allocates: {@link Diagnostics.frame} is one long-lived object the
 * loop writes in place, the history is a preallocated structure-of-arrays ring buffer, and counters
 * are typed arrays addressed by index (coding standards §7).
 *
 * @example
 * ```ts
 * const diagnostics = new Diagnostics({ development: true });
 * diagnostics.beginFrame(16.7);
 * diagnostics.frame.fixedSteps = 1;
 * diagnostics.endFrame();
 * diagnostics.readFrame(0, sample).fixedSteps; // 1
 * ```
 *
 * @public
 */
export class Diagnostics {
  /**
   * The frame being measured. The frame loop writes its counters in place; everything else reads
   * them. Values are reset by {@link Diagnostics.beginFrame}.
   */
  readonly frame: FrameSample = createFrameSample();

  /** Whether per-phase timings and User Timing entries are being recorded. */
  readonly isDevelopment: boolean;

  /** How many frames the history can hold. */
  readonly historyCapacity: number;

  readonly #now: () => number;
  readonly #hasUserTiming: boolean;
  readonly #groups: DiagnosticsGroup[] = [];
  readonly #groupsByName = new Map<string, DiagnosticsGroup>();
  readonly #scopePool: ProfileScopeImpl[] = [];
  #scopeDepth = 0;

  readonly #frameIds: Float64Array;
  readonly #rawDeltaMs: Float64Array;
  readonly #droppedMs: Float64Array;
  readonly #fixedSteps: Float64Array;
  readonly #scriptsUpdated: Float64Array;
  readonly #coroutinesResumed: Float64Array;
  readonly #destroyed: Float64Array;
  readonly #cpuMs: Float64Array;
  #head = 0;
  #historyLength = 0;
  #frameCounter = 0;

  readonly #endScope = (scope: ProfileScopeImpl): void => {
    if (scope.depth < this.#scopeDepth) {
      this.#scopeDepth = scope.depth;
    }
    scope.durationMs = this.#now() - scope.startMs;
    if (this.#hasUserTiming) {
      const mark = markName(scope.name, scope.depth);
      performance.measure(`ignifx:${scope.name}`, mark);
      performance.clearMarks(mark);
    }
  };

  /**
   * Creates the diagnostics service of one app.
   *
   * @param options - Development flag, clock, and history length.
   */
  constructor(options?: DiagnosticsOptions) {
    this.isDevelopment = options?.development ?? false;
    this.#now = options?.now ?? defaultNow();
    this.#hasUserTiming = this.isDevelopment && hasUserTiming();
    const capacity = Math.max(1, Math.floor(options?.historyLength ?? FRAME_HISTORY_LENGTH));
    this.historyCapacity = capacity;
    this.#frameIds = new Float64Array(capacity);
    this.#rawDeltaMs = new Float64Array(capacity);
    this.#droppedMs = new Float64Array(capacity);
    this.#fixedSteps = new Float64Array(capacity);
    this.#scriptsUpdated = new Float64Array(capacity);
    this.#coroutinesResumed = new Float64Array(capacity);
    this.#destroyed = new Float64Array(capacity);
    this.#cpuMs = new Float64Array(capacity * PHASE_COUNT);
  }

  /**
   * How many frames of history are currently recorded, never more than the capacity.
   *
   * @returns The number of retained frames.
   */
  get historyLength(): number {
    return this.#historyLength;
  }

  /**
   * Every registered counter group, in registration order.
   *
   * @returns The live list of groups.
   */
  get groups(): readonly DiagnosticsGroup[] {
    return this.#groups;
  }

  /**
   * Starts a new frame: zeroes {@link Diagnostics.frame}, assigns the next frame number, and records
   * the raw delta.
   *
   * @param rawDeltaMs - The wall-clock delta handed to the loop, before clamping, in milliseconds.
   */
  beginFrame(rawDeltaMs: number): void {
    const frame = this.frame;
    resetFrameSample(frame);
    this.#frameCounter += 1;
    frame.frame = this.#frameCounter;
    frame.rawDeltaMs = rawDeltaMs;
  }

  /** Copies {@link Diagnostics.frame} into the history ring buffer, overwriting the oldest entry. */
  endFrame(): void {
    const slot = this.#head;
    const frame = this.frame;
    this.#frameIds[slot] = frame.frame;
    this.#rawDeltaMs[slot] = frame.rawDeltaMs;
    this.#droppedMs[slot] = frame.droppedMs;
    this.#fixedSteps[slot] = frame.fixedSteps;
    this.#scriptsUpdated[slot] = frame.scriptsUpdated;
    this.#coroutinesResumed[slot] = frame.coroutinesResumed;
    this.#destroyed[slot] = frame.destroyed;
    const base = slot * PHASE_COUNT;
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      this.#cpuMs[base + phase] = readSlot(frame.cpuMs, phase);
    }
    this.#head = (slot + 1) % this.historyCapacity;
    if (this.#historyLength < this.historyCapacity) {
      this.#historyLength += 1;
    }
  }

  /**
   * Reads a recorded frame into a caller-owned sample, so plotting the whole history allocates
   * nothing.
   *
   * @param offset - `0` is the most recently ended frame, `historyLength - 1` the oldest retained.
   * @param out - The sample to fill; build it with `createFrameSample()`.
   * @returns The same `out` sample, zeroed when the offset is out of range.
   *
   * @example
   * ```ts
   * const sample = createFrameSample();
   * diagnostics.readFrame(0, sample); // the frame that just ended
   * ```
   */
  readFrame(offset: number, out: FrameSample): FrameSample {
    resetFrameSample(out);
    if (offset < 0 || offset >= this.#historyLength) {
      return out;
    }
    const capacity = this.historyCapacity;
    const slot = (this.#head - 1 - offset + capacity * 2) % capacity;
    out.frame = readSlot(this.#frameIds, slot);
    out.rawDeltaMs = readSlot(this.#rawDeltaMs, slot);
    out.droppedMs = readSlot(this.#droppedMs, slot);
    out.fixedSteps = readSlot(this.#fixedSteps, slot);
    out.scriptsUpdated = readSlot(this.#scriptsUpdated, slot);
    out.coroutinesResumed = readSlot(this.#coroutinesResumed, slot);
    out.destroyed = readSlot(this.#destroyed, slot);
    const base = slot * PHASE_COUNT;
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      out.cpuMs[phase] = readSlot(this.#cpuMs, base + phase);
    }
    return out;
  }

  /** Drops every recorded frame and resets the frame counter. */
  clearHistory(): void {
    this.#head = 0;
    this.#historyLength = 0;
    this.#frameCounter = 0;
  }

  /**
   * Registers a subsystem's counter group.
   *
   * @param name - The group name, unique within this app.
   * @param counterNames - The counter names, in the order their indices are assigned.
   * @returns The group, whose indices are resolved once with {@link DiagnosticsGroup.index}.
   * @throws IgnifxError with code `IGX-1503` when the name is already registered.
   */
  registerGroup(name: string, counterNames: readonly string[]): DiagnosticsGroup {
    if (this.#groupsByName.has(name)) {
      throw new IgnifxError(
        CoreErrorCode.duplicateDiagnosticsGroup,
        `The diagnostics group ${name} is already registered.`,
        { context: { group: name }, hint: "Register one group per subsystem and keep a reference to it." },
      );
    }
    const group = createDiagnosticsGroup(name, counterNames);
    this.#groups.push(group);
    this.#groupsByName.set(name, group);
    return group;
  }

  /**
   * Looks a counter group up by name.
   *
   * @param name - The group name.
   * @returns The group, or `null` when no subsystem registered it — an absent group is expected
   * absence, not a failure (coding standards §5.5).
   */
  group(name: string): DiagnosticsGroup | null {
    return this.#groupsByName.get(name) ?? null;
  }

  /**
   * Opens a timing scope. In development builds it writes a `performance.mark`/`measure` pair that
   * shows up in browser profilers; outside development it is free
   * (`docs/architecture/15-devtools-and-diagnostics.md` §6).
   *
   * @param name - The scope name, shown in the profiler.
   * @returns A scope to `end()`; scopes must be ended in the order they were opened.
   *
   * @example
   * ```ts
   * const scope = app.diagnostics.profile("physics.step");
   * stepPhysics();
   * scope.end();
   * ```
   */
  profile(name: string): ProfileScope {
    if (!this.isDevelopment) {
      return INACTIVE_SCOPE;
    }
    const depth = this.#scopeDepth;
    let scope = this.#scopePool[depth];
    if (scope === undefined) {
      scope = new ProfileScopeImpl(this.#endScope);
      this.#scopePool.push(scope);
    }
    this.#scopeDepth = depth + 1;
    scope.name = name;
    scope.depth = depth;
    scope.startMs = this.#now();
    scope.durationMs = 0;
    scope.isActive = true;
    if (this.#hasUserTiming) {
      performance.mark(markName(name, depth));
    }
    return scope;
  }
}

/**
 * Builds the User Timing mark name for a scope, keyed by depth so that nesting two scopes with the
 * same name still pairs each mark with the right measure.
 *
 * @param name - The scope name.
 * @param depth - The nesting depth of the scope.
 * @returns The mark name.
 */
function markName(name: string, depth: number): string {
  return `ignifx:${name}:${depth}`;
}
