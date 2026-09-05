import { ComponentRegistry } from "../component/component-registry.js";
import { componentInternals } from "../component/internals.js";
import { CoroutineHostImpl } from "../coroutine/coroutine-host.js";
import { Diagnostics } from "../diagnostics/diagnostics.js";
import { createErrorCodeRegistry } from "../errors/error-code-registry.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { coreExtension } from "../extension/core-extension.js";
import { ExtensionHost } from "../extension/host.js";
import { ServiceRegistryImpl } from "../extension/service-registry.js";
import { createLayerTable } from "../layers/layer-table.js";
import { ScriptCallbackKind } from "../lifecycle/callbacks.js";
import { createFrameState } from "../lifecycle/frame-state.js";
import { createHeadlessEngine, createRenderEngine, disposeEngineHandles } from "../lite/engine.js";
import { registerFrameCallback, startRenderLoop, stopRenderLoop, unregisterFrameCallback } from "../lite/loop.js";
import { createConsoleSink } from "../log/console-sink.js";
import { createLogger } from "../log/logger.js";
import { detectPlatform } from "../platform/platform.js";
import { EndOfFrameQueue } from "../scheduler/deferred-queue.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { SettingsStore } from "../settings/settings-store.js";
import { Signal } from "../signal/signal.js";
import { createPerformanceClock } from "../time/clock.js";
import { TimeImpl } from "../time/time.js";
import { createWorld } from "../world/world.js";
import { PHASE_NAMES, Phase } from "./types.js";
import { VERSION } from "./version.js";
import type { App, AppLiteHandles, AppSettings, ErrorReport, Extension, System } from "./types.js";
import type { ConcreteComponentType } from "../component/component-type.js";
import type { ErrorFormatMode } from "../errors/ignifx-error.js";
import type { ScriptCallbackKind as ScriptCallbackKindValue } from "../lifecycle/callbacks.js";
import type { EngineHandles } from "../lite/engine.js";
import type { FrameCallbackHandle } from "../lite/loop.js";
import type { LogSink, LogThreshold } from "../log/log-level.js";
import type { Logger } from "../log/logger.js";
import type { PlatformInfo } from "../platform/platform.js";
import type { RenderSurface } from "../platform/webgpu.js";
import type { Script } from "../script/script.js";
import type { SettingsInput } from "../settings/settings-input.js";
import type { Clock } from "../time/clock.js";
import type { World } from "../world/world.js";

/**
 * `createApp` and the `App` implementation: the root object of a game
 * (`docs/architecture/00-overview.md` §1, `01-lifecycle-and-time.md` §1 and §8,
 * `04-extensions.md` §2). There are no globals — every engine service hangs off this object
 * (`CONSTITUTION.md` §3.6), and two apps in one process share nothing.
 *
 * Decisions the documents leave open:
 *
 * - **Settings are frozen before the engine is created**, not after. §2 rule 5 lists engine, world,
 *   then freeze; freezing first is the same work in a better order, because a project that names an
 *   unknown settings section then fails before a GPU device has been acquired.
 * - **`app.step(dt)` does not require `app.start()`.** §8's example starts first, and extensions'
 *   `onStart` hooks may well be required for a meaningful frame, but nothing in §3 depends on the
 *   loop having been started, and unit tests are much simpler when a bare `createApp` can be
 *   stepped. What `step` does refuse is running while Babylon Lite's own loop is driving frames
 *   (`IGX-0105`).
 * - **`stop()` may be followed by `start()`.** The frame callback is registered again and the
 *   `onStart` hooks run again; nothing in §1 says otherwise, and a template that stops on
 *   `visibilitychange` needs it.
 */

/** Milliseconds in one second; the boundary the Lite callback's delta crosses. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Options accepted by {@link createApp}.
 *
 * @example
 * ```ts
 * const app = await createApp({ canvas, extensions: [physics(), input()] });
 * await app.start();
 * ```
 *
 * @public
 */
export interface CreateAppOptions {
  /**
   * Run on Babylon Lite's null engine with no render surface
   * (`docs/architecture/01-lifecycle-and-time.md` §8). Defaults to `true` when no `canvas` is
   * given, so `createApp({})` is a headless app.
   */
  readonly headless?: boolean;
  /** The canvas to render into. Ignored when `headless` is `true`. */
  readonly canvas?: RenderSurface;
  /** The extensions to register, after the implicit core extension. */
  readonly extensions?: readonly Extension[];
  /**
   * Project settings, as `ignifx.config.ts` would supply them
   * (`docs/architecture/04-extensions.md` §5). The Vite plugin injects the resolved config in
   * Phase 2; tests and Electron tooling pass it here.
   */
  readonly settings?: SettingsInput;
  /**
   * The wall clock behind `time.realtimeSinceStartup` and the development phase timings. Defaults
   * to `performance.now()`; headless tests pass {@link createManualClock}.
   */
  readonly clock?: Clock;
  /**
   * `"development"` turns on per-phase CPU timings, full error messages, and the strict half of
   * every rule `04-extensions.md` §2 relaxes in production. Defaults to `"development"`; the Vite
   * plugin sets it from the build mode in Phase 2.
   */
  readonly mode?: ErrorFormatMode;
  /** Where `app.log` writes. Defaults to the console sink. */
  readonly logSink?: LogSink;
  /**
   * The lowest level `app.log` writes to the sink. Defaults to `"info"` in every mode, so an app
   * prints nothing at startup; pass `"debug"` to see the kernel's own diagnostics.
   */
  readonly logLevel?: LogThreshold;
}

/** The options after {@link createApp} has applied its defaults. */
interface ResolvedAppOptions {
  /** The canvas to render into, or `null` for a headless app. */
  readonly canvas: RenderSurface | null;
  /** Project settings. */
  readonly settings: SettingsInput;
  /** The wall clock. */
  readonly clock: Clock;
  /** The build mode. */
  readonly mode: ErrorFormatMode;
  /** Where `app.log` writes. */
  readonly logSink: LogSink;
  readonly logLevel: LogThreshold;
}

/**
 * The root object of a game.
 *
 * @internal
 */
class AppImpl implements App {
  /** The clock. */
  readonly time: TimeImpl;

  /** The app-scoped logger. */
  readonly log: Logger;

  /** Per-frame counters and profiling scopes. */
  readonly diagnostics: Diagnostics;

  /** Services registered by extensions. */
  readonly services: ServiceRegistryImpl;

  /** Every failure the engine caught at a boundary rather than rethrowing. */
  readonly onError: Signal<ErrorReport>;

  /** The coroutine scheduler. */
  readonly coroutines: CoroutineHostImpl;

  /** `true` when the app runs on Lite's null engine with no render surface. */
  readonly isHeadless: boolean;

  /** The `@ignifx/core` version this app was built from. */
  readonly version: string = VERSION;

  /** Where the app is running. */
  readonly platform: PlatformInfo;

  readonly #canvas: RenderSurface | null;

  readonly #clock: Clock;

  readonly #mode: ErrorFormatMode;

  readonly #frameState = createFrameState();

  readonly #registry = new ComponentRegistry();

  readonly #settings: SettingsStore;

  readonly #deferred: EndOfFrameQueue;

  readonly #scheduler: Scheduler;

  readonly #host: ExtensionHost;

  #world: World | null = null;

  #handles: EngineHandles | null = null;

  #frameCallback: FrameCallbackHandle | null = null;

  #isLoopRunning = false;

  #isRunning = false;

  #isDisposed = false;

  /**
   * Runs one ignifx frame from Babylon Lite's render loop.
   *
   * @param deltaMs - The frame delta Lite delivered, in milliseconds; the adapter boundary is where
   * it becomes ignifx's seconds (`docs/architecture/00-overview.md` §4).
   */
  readonly #onLiteFrame = (deltaMs: number): void => {
    this.#scheduler.runFrame(deltaMs / MILLISECONDS_PER_SECOND);
  };

  /** The document became hidden or visible. */
  readonly #onVisibilityChange = (): void => {
    this.#dispatchApplication(ScriptCallbackKind.onApplicationPause, globalThis.document.hidden);
  };

  /** The window gained focus. */
  readonly #onFocus = (): void => {
    this.#dispatchApplication(ScriptCallbackKind.onApplicationFocus, true);
  };

  /** The window lost focus. */
  readonly #onBlur = (): void => {
    this.#dispatchApplication(ScriptCallbackKind.onApplicationFocus, false);
  };

  /**
   * Builds an app. Call {@link createApp}, which also runs the asynchronous half of construction.
   *
   * @param options - The resolved creation options.
   */
  constructor(options: ResolvedAppOptions) {
    this.#canvas = options.canvas;
    this.#clock = options.clock;
    this.#mode = options.mode;
    this.isHeadless = options.canvas === null;
    this.platform = detectPlatform();
    const development = options.mode === "development";
    this.log = createLogger({ sink: options.logSink, level: options.logLevel });
    this.diagnostics = new Diagnostics({ development, now: (): number => this.#clock.nowMs() });
    this.time = new TimeImpl(options.clock);
    this.services = new ServiceRegistryImpl();
    this.#settings = new SettingsStore(options.settings, options.mode, this.log);
    this.onError = new Signal<ErrorReport>({
      onHandlerError: (error: unknown): void => {
        this.log.error("An app.onError handler threw.", error);
      },
    });
    this.#deferred = new EndOfFrameQueue((error: unknown): void => {
      this.#report({ error, source: "system", phase: Phase.EndOfFrame, entity: null, component: null });
    });
    this.coroutines = new CoroutineHostImpl({
      frameState: this.#frameState,
      report: (error: unknown, owner: Script): void => {
        this.#report({
          error,
          source: "coroutine",
          phase: this.#scheduler.currentPhase,
          entity: componentInternals(owner).entity,
          component: owner,
        });
      },
    });
    this.#scheduler = new Scheduler({
      time: this.time,
      diagnostics: this.diagnostics,
      frameState: this.#frameState,
      coroutines: this.coroutines,
      deferred: this.#deferred,
      clock: options.clock,
      development,
      report: (error: unknown, system: System, phase: Phase): void => {
        this.log.error("The system {system} threw in {phase}.", system.name, PHASE_NAMES[phase] ?? "", error);
        this.#report({ error, source: "system", phase, entity: null, component: null });
      },
    });
    this.#host = new ExtensionHost({
      app: this,
      log: this.log,
      registry: this.#registry,
      services: this.services,
      settings: this.#settings,
      errorCodes: createErrorCodeRegistry(),
      scheduler: this.#scheduler,
      version: VERSION,
      mode: options.mode,
      report: (report: ErrorReport): void => {
        this.#report(report);
      },
    });
    this.onError.connect((report: ErrorReport): void => {
      this.#logError(report);
    });
  }

  /**
   * The running simulation.
   *
   * @returns The world.
   * @throws IgnifxError with code `IGX-0106` when the app has been disposed, or `IGX-0107` when it
   * is read from inside an extension's `register` hook, before the world exists.
   */
  get world(): World {
    this.#assertUsable("app.world");
    const world = this.#world;
    if (world === null) {
      throw new IgnifxError(CoreErrorCode.appNotReady, "app.world is not available until createApp() resolves.", {
        context: { member: "app.world" },
        hint: "Extensions declare components and systems in register(); touch the world in onStart().",
      });
    }
    return world;
  }

  /**
   * Resolved project settings.
   *
   * @returns The settings table.
   */
  get settings(): AppSettings {
    return this.#settings;
  }

  /**
   * `true` between `start()` and `stop()`/`dispose()`.
   *
   * @returns Whether the app is running.
   */
  get isRunning(): boolean {
    return this.#isRunning;
  }

  /**
   * Unstable Babylon Lite escape hatch (`docs/architecture/00-overview.md` §3).
   *
   * @returns The engine and the render scene.
   * @throws IgnifxError with code `IGX-0106` when the app has been disposed, or `IGX-0107` before
   * `createApp()` resolves.
   */
  get lite(): AppLiteHandles {
    this.#assertUsable("app.lite");
    const handles = this.#handles;
    if (handles === null) {
      throw new IgnifxError(CoreErrorCode.appNotReady, "app.lite is not available until createApp() resolves.", {
        context: { member: "app.lite" },
      });
    }
    return handles;
  }

  /**
   * Makes component `typeId`s known to the serializer and the inspector.
   *
   * @param types - The component classes to register.
   * @throws IgnifxError with code `IGX-0203` when a `typeId` is already registered.
   */
  registerComponents(types: readonly ConcreteComponentType[]): void {
    this.#assertUsable("app.registerComponents()");
    this.#registry.registerAll(types);
  }

  /**
   * Runs extension `onStart` hooks and starts the frame loop
   * (`docs/architecture/01-lifecycle-and-time.md` §1).
   *
   * @returns A promise that settles once the first frame has been submitted. In headless mode there
   * is no loop to start, so it settles once the hooks have run.
   * @throws IgnifxError with code `IGX-0106` when the app has been disposed.
   */

  async start(): Promise<void> {
    this.#assertUsable("app.start()");
    if (this.#isRunning) {
      return;
    }
    await this.#host.start();
    this.#isRunning = true;
    this.#applicationListeners(true);
    const handles = this.#handles;
    if (this.isHeadless || handles === null) {
      return;
    }
    // §1: exactly one Lite before-render callback per world, registered after every extension has
    // finished register() — which `createApp` guarantees by resolving only once they have — and
    // before startEngine, so the ignifx frame sits at the front of the scene's callback list.
    if (this.#frameCallback !== null) {
      throw new IgnifxError(CoreErrorCode.appNotReady, "app.start() already registered this world's frame callback.", {
        context: { member: "app.start()" },
      });
    }
    this.#frameCallback = registerFrameCallback(handles.scene, this.#onLiteFrame);
    this.#isLoopRunning = true;
    await startRenderLoop(handles.engine, handles.scene);
  }

  /** Stops the frame loop without disposing anything, then runs `onStop` in reverse order. */
  stop(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#stopInternal();
  }

  /**
   * Stops the loop, disposes the world, the extensions, and the Lite objects, in the order of
   * `docs/architecture/07-rendering.md` §7. Disposing twice is a no-op.
   */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#stopInternal();
    this.#isDisposed = true;
    this.#world?.dispose();
    this.#host.dispose();
    this.coroutines.dispose();
    this.#deferred.clear();
    this.#scheduler.dispose();
    this.services.clear();
    const handles = this.#handles;
    if (handles !== null) {
      disposeEngineHandles(handles);
    }
    this.#handles = null;
    this.#world = null;
  }

  /**
   * Runs exactly one frame with a supplied delta — the headless driver
   * (`docs/architecture/01-lifecycle-and-time.md` §8).
   *
   * @param deltaSeconds - The raw frame delta in seconds, before the maximum-delta clamp.
   * @throws IgnifxError with code `IGX-0105` when Babylon Lite's render loop is driving the frames,
   * or `IGX-0106` when the app has been disposed.
   */
  step(deltaSeconds: number): void {
    this.#assertUsable("app.step()");
    if (this.#isLoopRunning) {
      throw new IgnifxError(
        CoreErrorCode.stepOutsideHeadless,
        "step() is only available in headless mode or while the render loop is stopped.",
        { hint: "Call app.stop() first, or create the app with { headless: true }." },
      );
    }
    this.#scheduler.runFrame(deltaSeconds);
  }

  /** Sets `time.paused` (`docs/architecture/01-lifecycle-and-time.md` §7). */
  pause(): void {
    this.time.paused = true;
  }

  /** Clears `time.paused`. */
  resume(): void {
    this.time.paused = false;
  }

  /**
   * The asynchronous half of construction: extensions register, the Lite engine and scene are
   * created, and the world is built (`docs/architecture/04-extensions.md` §2 rule 5).
   *
   * @param extensions - The game's extension list, after the implicit core extension.
   * @returns A promise that settles once the app is ready to start.
   */
  async initialize(extensions: readonly Extension[]): Promise<void> {
    const list: Extension[] = [coreExtension()];
    for (let index = 0; index < extensions.length; index += 1) {
      const extension = extensions[index];
      if (extension !== undefined) {
        list.push(extension);
      }
    }
    await this.#host.register(list);
    this.#settings.freeze();
    const canvas = this.#canvas;
    this.#handles = canvas === null ? createHeadlessEngine() : await createRenderEngine(canvas);
    const time = this.#settings.time;
    this.time.applySettings(time.fixedDeltaTime, time.maximumDeltaTime, time.timeScale);
    const world = createWorld({
      app: this,
      scene: this.#handles.scene,
      frameState: this.#frameState,
      layers: createLayerTable(this.#settings.layers.layers),
      registry: this.#registry,
      deferredQueue: this.#deferred,
    });
    this.#world = world;
    this.#scheduler.attachWorld(world);
    if (this.#mode === "development") {
      this.log.debug(`ignifx ${VERSION} ready with ${String(this.#host.extensions.length)} extensions.`);
    }
  }

  /** Stops the Lite loop, detaches the browser listeners, and runs `onStop` in reverse order. */
  #stopInternal(): void {
    const handles = this.#handles;
    if (this.#isLoopRunning && handles !== null) {
      stopRenderLoop(handles.engine);
    }
    this.#isLoopRunning = false;
    if (this.#frameCallback !== null) {
      unregisterFrameCallback(this.#frameCallback);
      this.#frameCallback = null;
    }
    this.#applicationListeners(false);
    if (!this.#isRunning) {
      return;
    }
    this.#isRunning = false;
    this.#host.stop();
  }

  /**
   * Attaches or detaches the document and window listeners behind `onApplicationPause` and
   * `onApplicationFocus` (`docs/architecture/01-lifecycle-and-time.md` §4, §7).
   *
   * @remarks
   * The host is re-checked rather than trusted from `platform.kind`, which was resolved when the
   * app was built: a window torn down before `dispose()` runs — an Electron window closing, an
   * iframe removed from its parent — must not turn teardown into a `TypeError`.
   *
   * @param attach - `true` to add the listeners, `false` to remove them.
   */
  #applicationListeners(attach: boolean): void {
    if (this.platform.kind !== "browser") {
      return;
    }
    if (globalThis.document === undefined || globalThis.window === undefined) {
      return;
    }
    const host = globalThis.document;
    const frame = globalThis.window;
    if (attach) {
      host.addEventListener("visibilitychange", this.#onVisibilityChange);
      frame.addEventListener("focus", this.#onFocus);
      frame.addEventListener("blur", this.#onBlur);
      return;
    }
    host.removeEventListener("visibilitychange", this.#onVisibilityChange);
    frame.removeEventListener("focus", this.#onFocus);
    frame.removeEventListener("blur", this.#onBlur);
  }

  /**
   * Delivers an application callback to every script implementing it
   * (`docs/architecture/01-lifecycle-and-time.md` §4).
   *
   * @param kind - `onApplicationPause` or `onApplicationFocus`.
   * @param value - The boolean the callback receives.
   */
  #dispatchApplication(kind: ScriptCallbackKindValue, value: boolean): void {
    const world = this.#world;
    if (world === null) {
      return;
    }
    const internals = world.lifecycle;
    // One closure per document event, not per frame: `visibilitychange` and window focus fire on
    // human timescales, so coding standards §7's no-closures rule does not reach here.
    internals.forEachScript(kind, (script: Script): void => {
      internals.invokeCallback(script, kind, value);
    });
  }

  /**
   * Emits an error report.
   *
   * @param report - What failed, and where.
   */
  #report(report: ErrorReport): void {
    this.onError.emit(report);
  }

  /**
   * The default `onError` handler: one log line naming the boundary, the phase, and the object
   * (`docs/architecture/15-devtools-and-diagnostics.md` §1). The development overlay is
   * `@ignifx/devtools`' job, not the kernel's.
   *
   * @param report - What failed, and where.
   */
  #logError(report: ErrorReport): void {
    const phase = report.phase === null ? "no phase" : (PHASE_NAMES[report.phase] ?? "no phase");
    const entity = report.entity === null ? "-" : report.entity.name;
    const component = report.component === null ? "-" : report.component.constructor.name;
    this.log.error(
      "A {source} boundary caught a failure in {phase} on {entity}/{component}.",
      report.source,
      phase,
      entity,
      component,
      report.error,
    );
  }

  /**
   * Refuses to serve a disposed app.
   *
   * @param member - What was being reached, for the message.
   * @throws IgnifxError with code `IGX-0106` when the app has been disposed.
   */
  #assertUsable(member: string): void {
    if (this.#isDisposed) {
      throw new IgnifxError(CoreErrorCode.appDisposed, `The app has been disposed; ${member} is no longer available.`, {
        context: { member },
        hint: "Create a new app; a disposed one releases its world, its extensions, and its engine.",
      });
    }
  }
}

/**
 * Creates a game (`docs/architecture/00-overview.md` §1, `04-extensions.md` §2).
 *
 * @remarks
 * The whole of construction happens here: the extension list is built, sorted, and validated, every
 * `register` hook runs in order, the Lite engine and scene are created, the project settings are
 * frozen, and the world is built. Nothing runs a frame until `app.start()` (browser) or
 * `app.step(dt)` (headless).
 *
 * @param options - The canvas or `headless`, the extensions, the project settings, and the clock.
 * @returns The app, ready to start.
 * @throws IgnifxError with the `IGX-04xx` codes of `04-extensions.md` §2 when the extension list
 * does not validate, `IGX-0408`/`IGX-0407` when the project settings do not, and `IGX-0701` when a
 * canvas was given but the host has no WebGPU.
 *
 * @example
 * ```ts
 * const app = await createApp({ headless: true, clock: createManualClock() });
 * const player = app.world.createEntity("Player");
 * player.addComponent(Mover);
 * app.step(1 / 60);
 * app.dispose();
 * ```
 *
 * @public
 */
export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const wantsHeadless = options.headless ?? options.canvas === undefined;
  const canvas = wantsHeadless ? null : (options.canvas ?? null);
  const app = new AppImpl({
    canvas,
    settings: options.settings ?? {},
    clock: options.clock ?? createPerformanceClock(),
    mode: options.mode ?? "development",
    logSink: options.logSink ?? createConsoleSink(),
    logLevel: options.logLevel ?? "info",
  });
  await app.initialize(options.extensions ?? []);
  return app;
}
