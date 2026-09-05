import { createApp, createManualClock, createMemorySink, Phase, Script } from "../../src/index.js";
import { sinkOf } from "./create-test-world.js";
import type { App, Extension, ManualClock, MemorySink, SettingsInput, System, World } from "../../src/index.js";

/**
 * The harness the runtime suites use: a real headless `createApp` on a manual clock, plus the
 * shared per-world log that `RecordingScript` and {@link FrameRecorder} append to.
 */

/** Options accepted by {@link createTestApp}. */
export interface TestAppOptions {
  /** Extensions to register after the implicit core extension. */
  readonly extensions?: readonly Extension[];
  /** Project settings. */
  readonly settings?: SettingsInput;
  /** The build mode; defaults to `"development"`. */
  readonly mode?: "development" | "production";
}

/** Everything a runtime test needs, wired together. */
export interface TestAppHarness {
  /** The app under test. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** The clock `realtimeSinceStartup` and `waitSecondsRealtime` read. */
  readonly clock: ManualClock;
  /** Where `app.log` writes. */
  readonly sink: MemorySink;
  /** The shared callback log. */
  readonly log: string[];
  /** Runs one frame and advances the manual clock by the same amount. */
  step(deltaSeconds: number): void;
  /** Disposes the app. */
  dispose(): void;
}

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Builds a headless app on a manual clock.
 *
 * @param options - Extensions, settings, and the build mode.
 * @returns The harness.
 */
export async function createTestApp(options?: TestAppOptions): Promise<TestAppHarness> {
  const clock = createManualClock();
  const sink = createMemorySink();
  const app = await createApp({
    headless: true,
    clock,
    logSink: sink,
    ...(options?.extensions === undefined ? {} : { extensions: options.extensions }),
    ...(options?.settings === undefined ? {} : { settings: options.settings }),
    ...(options?.mode === undefined ? {} : { mode: options.mode }),
  });
  const log = sinkOf(app.world);
  log.length = 0;
  return {
    app,
    world: app.world,
    clock,
    sink,
    log,
    step: (deltaSeconds: number): void => {
      clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
      app.step(deltaSeconds);
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}

/** A script that records every frame callback it receives, without the delta in the entry. */
export class FrameRecorder extends Script {
  static typeId = "test/FrameRecorder";

  /** The label written into each log entry. */
  label = "a";

  /**
   * Appends one entry to the world's shared log.
   *
   * @param callback - The callback name.
   */
  record(callback: string): void {
    sinkOf(this.world).push(`${callback}:${this.label}`);
  }

  awake(): void {
    this.record("awake");
  }

  onEnable(): void {
    this.record("onEnable");
  }

  start(): void {
    this.record("start");
  }

  fixedUpdate(): void {
    this.record("fixedUpdate");
  }

  update(): void {
    this.record("update");
  }

  lateUpdate(): void {
    this.record("lateUpdate");
  }

  onDisable(): void {
    this.record("onDisable");
  }

  onDestroy(): void {
    this.record("onDestroy");
  }
}

/** A {@link FrameRecorder} that keeps updating while the app is paused. */
export class PausedRecorder extends FrameRecorder {
  static override typeId = "test/PausedRecorder";
  static updateWhenPaused = true;
}

/**
 * A late-bound reference to the shared log. Systems are built inside an extension's `register`,
 * which runs before the world — and therefore before `sinkOf(world)` — exists, so they hold this
 * box and the harness fills it in once the app has resolved.
 */
export interface LogRef {
  /** The shared log. */
  entries: string[];
}

/** Creates an unbound log reference. */
export function createLogRef(): LogRef {
  return { entries: [] };
}

/** A system that records `sys:<phase>:<order>` every time its phase runs. */
export class RecordingSystem implements System {
  /** The system's name, as diagnostics see it. */
  readonly name: string;

  readonly #log: LogRef;

  readonly #entry: string;

  /** How many times the system has run. */
  runs = 0;

  /**
   * Creates a recorder.
   *
   * @param log - The late-bound shared log.
   * @param phase - The phase it is registered in.
   * @param order - Its order within the phase.
   */
  constructor(log: LogRef, phase: Phase, order: number) {
    this.#log = log;
    this.#entry = `sys:${PHASE_LABELS[phase]}:${String(order)}`;
    this.name = this.#entry;
  }

  update(): void {
    this.runs += 1;
    this.#log.entries.push(this.#entry);
  }
}

/** Phase names keyed by ordinal, so a log entry reads as prose. */
const PHASE_LABELS: Readonly<Record<Phase, string>> = {
  [Phase.EndOfFrame]: "EndOfFrame",
  [Phase.PreUpdate]: "PreUpdate",
  [Phase.FixedUpdate]: "FixedUpdate",
  [Phase.Update]: "Update",
  [Phase.PostUpdate]: "PostUpdate",
  [Phase.PreRender]: "PreRender",
};
