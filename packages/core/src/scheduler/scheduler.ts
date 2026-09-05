import { PHASES, Phase } from "../app/types.js";
import { ScriptCallbackKind } from "../lifecycle/callbacks.js";
import { updatesWhilePaused } from "../lifecycle/pause-filter.js";
import type { EndOfFrameQueue } from "./deferred-queue.js";
import type { RegisterSystemOptions, System, SystemContext, Time } from "../app/types.js";
import type { CoroutineHostImpl } from "../coroutine/coroutine-host.js";
import type { Diagnostics } from "../diagnostics/diagnostics.js";
import type { FrameStateController } from "../lifecycle/frame-state.js";
import type { Script } from "../script/script.js";
import type { Clock } from "../time/clock.js";
import type { TimeImpl } from "../time/time.js";
import type { WorldInternals } from "../world/world-internals.js";
import type { World } from "../world/world.js";

/**
 * The frame function (`docs/architecture/01-lifecycle-and-time.md` §3). One instance per app drives
 * the whole of steps 0–10, in order, whether the frame was started by Babylon Lite's render loop or
 * by `app.step(dt)`.
 *
 * Rules this file exists to keep:
 *
 * - **Nothing allocates per frame** (coding standards §7). The system context is one long-lived
 *   mutable object, the three script visitors are bound once in the field initialisers, and every
 *   loop is an indexed `for`.
 * - **Script callbacks go through the world's one guarded call site.** The scheduler decides *who*
 *   and *when*; `WorldInternals.invokeCallback` decides what happens when game code throws
 *   (`03-scripting-and-components.md` §6, `01-lifecycle-and-time.md` §5).
 * - **Systems never see a phase they did not register for**, and within a phase they run in
 *   ascending `order` with registration order breaking ties.
 *
 * Decisions the documents leave open:
 *
 * - **`lateUpdate` is billed to `PostUpdate` in the per-phase CPU timings.** §3 gives `lateUpdate`
 *   its own step but `Phase` has no ordinal for it, and `FrameSample.cpuMs` is indexed by phase
 *   ordinal; `PostUpdate` is the phase it sits inside.
 * - **The fixed loop does not run at all while the app is paused.** §2's table says the phases
 *   `FixedUpdate`…`LateUpdate` "skip scripts", but §7 is explicit that "fixed steps and physics do
 *   not run" while paused, and a physics system that kept stepping with no `fixedUpdate` in front
 *   of it would be worse than either reading alone. Systems of every other phase keep running:
 *   rendering, audio, and UI must still work on a pause screen.
 * - **`FrameSample.destroyed` counts entities.** The destroy flush reports no total, and the only
 *   world-level signal for a release is `onEntityDestroyed`; a component destroyed on a surviving
 *   entity is therefore not counted yet.
 */

/** How many phases the scheduler keeps system lists for. */
const PHASE_COUNT = PHASES.length;

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * How close the accumulator has to be to a multiple of the fixed step before it is snapped onto it
 * (§3 notes). Without this, `600` frames of exactly `1 / 60` would drift into a frame with two
 * steps and a frame with none.
 */
const SNAP_TOLERANCE = 1e-6;

/** One registered system, with the keys that order it inside its phase. */
class SystemEntry {
  /** The system. */
  readonly system: System;

  /** Ascending order within the phase. */
  readonly order: number;

  /** Registration serial, the tie-breaker. */
  readonly serial: number;

  /**
   * Creates an entry.
   *
   * @param system - The system.
   * @param order - Its order within the phase.
   * @param serial - Its registration serial.
   */
  constructor(system: System, order: number, serial: number) {
    this.system = system;
    this.order = order;
    this.serial = serial;
  }
}

/**
 * The one {@link SystemContext} every system in an app is handed. Its fields are mutable so that
 * running a phase allocates nothing; the public interface declares them `readonly`, which is what
 * systems see.
 */
class SystemContextImpl implements SystemContext {
  /** The world the system operates on. */
  world: World;

  /** The app clock. */
  readonly time: Time;

  /** The phase currently running. */
  phase: Phase = Phase.EndOfFrame;

  /** Seconds elapsed. */
  dt = 0;

  /**
   * Creates the shared context.
   *
   * @param world - The world.
   * @param time - The clock.
   */
  constructor(world: World, time: Time) {
    this.world = world;
    this.time = time;
  }
}

/**
 * What the scheduler needs from the app.
 *
 * @internal
 */
export interface SchedulerOptions {
  /** The app clock the frame advances. */
  readonly time: TimeImpl;
  /** The per-frame counters the loop publishes. */
  readonly diagnostics: Diagnostics;
  /** The frame state, so `inFixedStep` is visible to the scene graph. */
  readonly frameState: FrameStateController;
  /** The coroutine scheduler, resumed at the two documented points. */
  readonly coroutines: CoroutineHostImpl;
  /** The `EndOfFrame` queue drained at step 0. */
  readonly deferred: EndOfFrameQueue;
  /** The wall clock used for the development-only per-phase timings. */
  readonly clock: Clock;
  /** Whether per-phase CPU timings are recorded. */
  readonly development: boolean;
  /**
   * Reports a system failure.
   *
   * @param error - Whatever the system threw.
   * @param system - The system that threw.
   * @param phase - The phase it was running in.
   */
  report(error: unknown, system: System, phase: Phase): void;
}

/**
 * The frame function of one app.
 *
 * @internal
 */
export class Scheduler {
  readonly #time: TimeImpl;

  readonly #diagnostics: Diagnostics;

  readonly #frameState: FrameStateController;

  readonly #coroutines: CoroutineHostImpl;

  readonly #deferred: EndOfFrameQueue;

  readonly #clock: Clock;

  readonly #development: boolean;

  readonly #report: (error: unknown, system: System, phase: Phase) => void;

  /** One system list per phase, kept sorted by `(order, registration serial)`. */
  readonly #systems: SystemEntry[][] = [];

  /** How many entries of each phase's list have a negative `order`. */
  readonly #negativeCounts: number[] = [];

  #context: SystemContextImpl | null = null;

  #internals: WorldInternals | null = null;

  #world: World | null = null;

  #serial = 0;

  #accumulator = 0;

  #phase: Phase | null = null;

  #stepDt = 0;

  #frameDt = 0;

  /**
   * Dispatches `fixedUpdate` to one script. Bound once so the fixed loop allocates nothing.
   *
   * @param script - The script to call.
   */
  readonly #visitFixedUpdate = (script: Script): void => {
    this.#internals?.invokeCallback(script, ScriptCallbackKind.fixedUpdate, this.#stepDt);
  };

  /**
   * Dispatches `update` to one script, honouring `time.paused`.
   *
   * @param script - The script to call.
   */
  readonly #visitUpdate = (script: Script): void => {
    if (this.#time.paused && !updatesWhilePaused(script)) {
      return;
    }
    this.#diagnostics.frame.scriptsUpdated += 1;
    this.#internals?.invokeCallback(script, ScriptCallbackKind.update, this.#frameDt);
  };

  /**
   * Dispatches `lateUpdate` to one script, honouring `time.paused`.
   *
   * @param script - The script to call.
   */
  readonly #visitLateUpdate = (script: Script): void => {
    if (this.#time.paused && !updatesWhilePaused(script)) {
      return;
    }
    this.#internals?.invokeCallback(script, ScriptCallbackKind.lateUpdate, this.#frameDt);
  };

  /** Counts an entity release into this frame's diagnostics. */
  readonly #countDestroyed = (): void => {
    this.#diagnostics.frame.destroyed += 1;
  };

  /**
   * Creates the frame function of one app.
   *
   * @param options - The clock, diagnostics, coroutine scheduler, and deferred queue it drives.
   */
  constructor(options: SchedulerOptions) {
    this.#time = options.time;
    this.#diagnostics = options.diagnostics;
    this.#frameState = options.frameState;
    this.#coroutines = options.coroutines;
    this.#deferred = options.deferred;
    this.#clock = options.clock;
    this.#development = options.development;
    // Bound rather than assigned: `options.report` is declared as a method, so handing the raw
    // reference around would detach its `this` (coding standards §5.4).
    this.#report = (error: unknown, system: System, phase: Phase): void => {
      options.report(error, system, phase);
    };
    for (let index = 0; index < PHASE_COUNT; index += 1) {
      this.#systems.push([]);
      this.#negativeCounts.push(0);
    }
  }

  /**
   * The phase currently running, for error reports raised outside the world's guarded call site.
   *
   * @returns The phase, or `null` between phases.
   */
  get currentPhase(): Phase | null {
    return this.#phase;
  }

  /**
   * What is left in the fixed-step accumulator, in seconds.
   *
   * @returns The residue the interpolation alpha is derived from.
   */
  get accumulator(): number {
    return this.#accumulator;
  }

  /**
   * Registers a system in a phase (`docs/architecture/03-scripting-and-components.md` §6).
   *
   * @param system - The system.
   * @param options - The phase and the ascending order within it; `order` defaults to `0`.
   */
  registerSystem(system: System, options: RegisterSystemOptions): void {
    const phase = options.phase;
    const list = this.#systems[phase];
    if (list === undefined) {
      return;
    }
    this.#serial += 1;
    const entry = new SystemEntry(system, options.order ?? 0, this.#serial);
    // Sorted insertion, not a per-frame sort: both keys are fixed for the system's whole life.
    let index = list.length;
    while (index > 0) {
      const previous = list[index - 1];
      if (previous === undefined || previous.order <= entry.order) {
        break;
      }
      list[index] = previous;
      index -= 1;
    }
    list[index] = entry;
    let negatives = 0;
    for (let at = 0; at < list.length; at += 1) {
      if ((list[at]?.order ?? 0) < 0) {
        negatives += 1;
      }
    }
    this.#negativeCounts[phase] = negatives;
    const world = this.#world;
    if (world !== null) {
      system.onWorldCreated?.(world);
    }
  }

  /**
   * Binds the world the frame function drives and tells every registered system about it.
   *
   * @param world - The world `createApp` built.
   */
  attachWorld(world: World): void {
    this.#world = world;
    this.#internals = world.lifecycle;
    this.#context = new SystemContextImpl(world, this.#time);
    world.onEntityDestroyed.connect(this.#countDestroyed);
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      const list = this.#systems[phase] ?? [];
      for (let index = 0; index < list.length; index += 1) {
        list[index]?.system.onWorldCreated?.(world);
      }
    }
  }

  /**
   * Runs one frame: `docs/architecture/01-lifecycle-and-time.md` §3, top to bottom.
   *
   * @param rawDeltaSeconds - The delta the driver supplied, before the maximum-delta clamp.
   */
  runFrame(rawDeltaSeconds: number): void {
    const time = this.#time;
    const diagnostics = this.#diagnostics;
    const internals = this.#internals;

    // Step 0 — EndOfFrame work carried over from the previous frame. It runs before the clock
    // advances, so a deferred handler still sees the delta of the frame that queued it.
    const endOfFrameStart = this.#now();
    this.#deferred.drain();
    this.#runSystems(Phase.EndOfFrame, 0, -1, time.deltaTime);
    const endOfFrameMs = this.#now() - endOfFrameStart;

    // Step 1 — the clock.
    time.beginFrame(rawDeltaSeconds);
    diagnostics.beginFrame(rawDeltaSeconds * MILLISECONDS_PER_SECOND);
    diagnostics.frame.droppedMs = time.droppedSeconds * MILLISECONDS_PER_SECOND;
    this.#writePhaseTime(Phase.EndOfFrame, endOfFrameMs);
    this.#frameDt = time.deltaTime;

    // Step 2 — PreUpdate.
    this.#runPhase(Phase.PreUpdate, 0, -1, time.deltaTime);

    // Step 3 — lifecycle flush A: awake, then onEnable.
    internals?.flushAwakeAndEnable();

    // Step 4 — the fixed loop.
    this.#runFixedLoop();

    // Step 5 — lifecycle flush B: start.
    internals?.flushStart();

    // Step 6 — Update.
    this.#runUpdate();

    // Step 7 and 8 — PostUpdate, then lateUpdate.
    const postUpdateStart = this.#now();
    this.#runSystems(Phase.PostUpdate, 0, -1, time.deltaTime);
    this.#dispatch(ScriptCallbackKind.lateUpdate, this.#visitLateUpdate, Phase.PostUpdate);
    this.#writePhaseTime(Phase.PostUpdate, this.#now() - postUpdateStart);

    // Step 9 — the destroy flush, before anything renders.
    internals?.flushDestroy();

    // Step 10 — PreRender.
    this.#runPhase(Phase.PreRender, 0, -1, time.deltaTime);

    time.endFrame();
    diagnostics.endFrame();
  }

  /** Releases every system and clears the phase lists. */
  dispose(): void {
    const world = this.#world;
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      const list = this.#systems[phase] ?? [];
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const system = list[index]?.system;
        if (system === undefined) {
          continue;
        }
        if (world !== null) {
          system.onWorldDisposed?.(world);
        }
        system.dispose?.();
      }
      list.length = 0;
      this.#negativeCounts[phase] = 0;
    }
    this.#world = null;
    this.#internals = null;
    this.#context = null;
  }

  /**
   * Step 4: the fixed-timestep loop, with the accumulator snapping rule of §3.
   *
   * @remarks
   * The loop is bounded by `maximumDeltaTime`, which is what the clamp in step 1 is for: with the
   * defaults a frame runs at most six fixed steps no matter how long the tab was in the background.
   */
  #runFixedLoop(): void {
    const time = this.#time;
    const start = this.#now();
    this.#phase = Phase.FixedUpdate;
    this.#internals?.setPhase(Phase.FixedUpdate);
    if (!time.paused) {
      this.#accumulator = snap(this.#accumulator + time.deltaTime, time.fixedDeltaTime);
      const step = time.fixedDeltaTime;
      this.#stepDt = step;
      const negatives = this.#negativeCounts[Phase.FixedUpdate] ?? 0;
      while (this.#accumulator >= step) {
        time.beginFixedStep();
        this.#frameState.setInsideFixedStep(true);
        this.#runSystems(Phase.FixedUpdate, 0, negatives, step);
        this.#dispatch(ScriptCallbackKind.fixedUpdate, this.#visitFixedUpdate, Phase.FixedUpdate);
        this.#runSystems(Phase.FixedUpdate, negatives, -1, step);
        // Physics contact and trigger dispatch belongs here, between the step and the coroutine
        // resume point (§3). `@ignifx/physics` performs it from its own `FixedUpdate` system, which
        // the line above already ran; the kernel adds no hook of its own.
        this.#diagnostics.frame.coroutinesResumed += this.#coroutines.resumeFixedUpdate();
        this.#accumulator = snap(this.#accumulator - step, step);
        this.#diagnostics.frame.fixedSteps += 1;
      }
      this.#frameState.setInsideFixedStep(false);
    }
    time.endFixedLoop(this.#accumulator);
    this.#internals?.setPhase(null);
    this.#phase = null;
    this.#writePhaseTime(Phase.FixedUpdate, this.#now() - start);
  }

  /** Step 6: `Systems(Update, order < 0)`, `update`, coroutines, `Systems(Update, order >= 0)`. */
  #runUpdate(): void {
    const start = this.#now();
    const time = this.#time;
    const negatives = this.#negativeCounts[Phase.Update] ?? 0;
    this.#runSystems(Phase.Update, 0, negatives, time.deltaTime);
    this.#dispatch(ScriptCallbackKind.update, this.#visitUpdate, Phase.Update);
    this.#phase = Phase.Update;
    this.#diagnostics.frame.coroutinesResumed += this.#coroutines.resumeUpdate(time.deltaTime, time.unscaledDeltaTime);
    this.#phase = null;
    this.#runSystems(Phase.Update, negatives, -1, time.deltaTime);
    this.#writePhaseTime(Phase.Update, this.#now() - start);
  }

  /**
   * Runs a whole phase's systems and records its CPU time.
   *
   * @param phase - The phase.
   * @param from - The first entry to run.
   * @param to - One past the last entry, or `-1` for "to the end".
   * @param dt - The delta handed to the systems.
   */
  #runPhase(phase: Phase, from: number, to: number, dt: number): void {
    const start = this.#now();
    this.#runSystems(phase, from, to, dt);
    this.#writePhaseTime(phase, this.#now() - start);
  }

  /**
   * Runs a slice of one phase's system list, guarded: a system that throws is reported and the rest
   * of the phase still runs (coding standards §5.5).
   *
   * @param phase - The phase.
   * @param from - The first entry to run.
   * @param to - One past the last entry, or `-1` for "to the end".
   * @param dt - The delta handed to the systems.
   */
  #runSystems(phase: Phase, from: number, to: number, dt: number): void {
    const list = this.#systems[phase];
    const context = this.#context;
    if (list === undefined || context === null) {
      return;
    }
    const end = to < 0 ? list.length : to;
    if (from >= end) {
      return;
    }
    context.phase = phase;
    context.dt = dt;
    const previousPhase = this.#phase;
    this.#phase = phase;
    this.#internals?.setPhase(phase);
    for (let index = from; index < end; index += 1) {
      const system = list[index]?.system;
      if (system === undefined) {
        continue;
      }
      try {
        system.update?.(context);
      } catch (error) {
        this.#report(error, system, phase);
      }
    }
    this.#internals?.setPhase(previousPhase);
    this.#phase = previousPhase;
  }

  /**
   * Walks one callback's sorted dispatch list.
   *
   * @param kind - Which callback.
   * @param visitor - The bound visitor for that callback; never allocated here.
   * @param phase - The phase to record in error reports.
   */
  #dispatch(kind: ScriptCallbackKind, visitor: (script: Script) => void, phase: Phase): void {
    const internals = this.#internals;
    if (internals === null) {
      return;
    }
    const previousPhase = this.#phase;
    this.#phase = phase;
    internals.setPhase(phase);
    // `forEachScript` is what makes the walk safe when a callback disables, destroys, or enables a
    // script; the visitor is a bound field, so this allocates nothing (coding standards §7).
    internals.forEachScript(kind, visitor);
    internals.setPhase(previousPhase);
    this.#phase = previousPhase;
  }

  /**
   * Reads the timing clock, or returns `0` outside development builds so the timings cost nothing.
   *
   * @returns Milliseconds, or `0` when timings are off.
   */
  #now(): number {
    return this.#development ? this.#clock.nowMs() : 0;
  }

  /**
   * Records one phase's CPU time.
   *
   * @param phase - The phase.
   * @param milliseconds - How long it took.
   */
  #writePhaseTime(phase: Phase, milliseconds: number): void {
    if (this.#development) {
      this.#diagnostics.frame.cpuMs[phase] = milliseconds;
    }
  }
}

/**
 * Snaps an accumulator onto the nearest multiple of the fixed step when it is within
 * `1e-6 × fixedDeltaTime` of one (`docs/architecture/01-lifecycle-and-time.md` §3 notes).
 *
 * @remarks
 * This is what makes `app.step(1 / 60)` run exactly one fixed step per call for as long as the test
 * runs: without it, the accumulated rounding error of the repeated `+= 1/60` and `-= 1/60` would
 * eventually leave a residue just below the step and produce a frame with no fixed step, followed
 * by one with two.
 *
 * @param accumulator - The current residue, in seconds.
 * @param step - The fixed step, in seconds.
 * @returns The snapped residue.
 */
function snap(accumulator: number, step: number): number {
  const multiples = Math.round(accumulator / step);
  const nearest = multiples * step;
  if (Math.abs(accumulator - nearest) <= SNAP_TOLERANCE * step) {
    return nearest;
  }
  return accumulator;
}
