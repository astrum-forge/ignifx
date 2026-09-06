import { AppEventsImpl } from "../../src/app/events.js";
import { AssetsImpl } from "../../src/assets/assets-service.js";
import { Diagnostics } from "../../src/diagnostics/diagnostics.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { IgnifxError } from "../../src/errors/ignifx-error.js";
import { createLogger } from "../../src/log/logger.js";
import { createMemorySink } from "../../src/log/memory-sink.js";
import { detectPlatform } from "../../src/platform/platform.js";
import { RendererImpl } from "../../src/render/renderer.js";
import { defaultRenderingSettings } from "../../src/render/rendering-settings.js";
import { Signal } from "../../src/signal/signal.js";
import { MemoryStorageBackend } from "../../src/storage/memory-backend.js";
import { StorageImpl } from "../../src/storage/storage.js";
import { TweensImpl } from "../../src/tween/tweens.js";
import type {
  App,
  AppLiteHandles,
  AppSettings,
  CoroutineHost,
  Coroutine,
  CoroutineHandle,
  ErrorReport,
  LayersSettings,
  ServiceKey,
  ServiceRegistry,
  SortingLayersSettings,
  Time,
  TimeSettings,
} from "../../src/app/types.js";
import type { ConcreteComponentType } from "../../src/component/component-type.js";
import type { LiteEngine, LiteScene } from "../../src/lite/scene.js";
import type { Logger } from "../../src/log/logger.js";
import type { PlatformInfo } from "../../src/platform/platform.js";
import type { Script } from "../../src/script/script.js";
import type { Storage } from "../../src/storage/storage.js";
import type { World } from "../../src/world/world.js";

/**
 * A fake `App` that satisfies the contract in `src/app/types.ts` without any of the runtime the
 * second Phase 1 agent writes. It exists so the scene-graph suites can drive the lifecycle flushes
 * directly; the same stub is what the runtime suites replace one piece at a time.
 */

/** Records every call the kernel makes into the coroutine scheduler. */
export interface CoroutineCall {
  /** Which method was called. */
  readonly kind: "start" | "stop" | "stopAll" | "setPaused" | "cancelAll";
  /** The owning script, when the call names one. */
  readonly owner: Script | null;
  /** The `paused` argument of a `setPaused` call. */
  readonly paused?: boolean;
}

/** A coroutine host that records calls instead of scheduling anything. */
export class RecordingCoroutineHost implements CoroutineHost {
  readonly calls: CoroutineCall[] = [];

  readonly #handles = new Map<CoroutineHandle, Coroutine>();

  start(owner: Script, routine: Coroutine): CoroutineHandle {
    this.calls.push({ kind: "start", owner });
    const handle: CoroutineHandle = { isRunning: true, isDone: false };
    this.#handles.set(handle, routine);
    return handle;
  }

  stop(handle: CoroutineHandle): void {
    this.calls.push({ kind: "stop", owner: null });
    this.#handles.delete(handle);
  }

  stopAll(owner: Script): void {
    this.calls.push({ kind: "stopAll", owner });
  }

  setPaused(owner: Script, paused: boolean): void {
    this.calls.push({ kind: "setPaused", owner, paused });
  }

  cancelAll(owner: Script): void {
    this.calls.push({ kind: "cancelAll", owner });
  }

  /**
   * Every call of one kind, for assertions.
   *
   * @param kind - The method name.
   * @returns The matching calls in order.
   */
  ofKind(kind: CoroutineCall["kind"]): readonly CoroutineCall[] {
    return this.calls.filter((call) => call.kind === kind);
  }
}

/** A mutable `Time` with no clock behind it; the runtime agent replaces it. */
export class TestTime implements Time {
  deltaTime = 1 / 60;
  unscaledDeltaTime = 1 / 60;
  fixedDeltaTime = 1 / 60;
  timeScale = 1;
  maximumDeltaTime = 0.1;
  time = 0;
  unscaledTime = 0;
  fixedTime = 0;
  realtimeSinceStartup = 0;
  frameCount = 0;
  inFixedStep = false;
  fixedStepAlpha = 0;
  paused = false;
}

/** A service table backed by a plain map. */
class TestServices implements ServiceRegistry {
  readonly #entries = new Map<unknown, unknown>();

  get<T>(key: ServiceKey<T>): T {
    const found = this.tryGet(key);
    if (found === null) {
      throw new IgnifxError(CoreErrorCode.serviceNotRegistered, "The service is not registered.", {
        context: { service: "unknown" },
      });
    }
    return found;
  }

  tryGet<T>(key: ServiceKey<T>): T | null {
    const value = this.#entries.get(key);
    return value === undefined ? null : (value as T);
  }

  has(key: ServiceKey<unknown>): boolean {
    return this.#entries.has(key);
  }

  set<T>(key: ServiceKey<T>, value: T): void {
    this.#entries.set(key, value);
  }
}

/** Settings with the three core sections and nothing else. */
class TestSettings implements AppSettings {
  readonly layers: LayersSettings;
  readonly sortingLayers: SortingLayersSettings = { sortingLayers: ["Default"] };
  readonly time: TimeSettings = { fixedDeltaTime: 1 / 60, maximumDeltaTime: 0.1 };

  constructor(layers: readonly string[]) {
    this.layers = { layers };
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- mirrors the App contract.
  section<S>(name: string): S {
    throw new IgnifxError(CoreErrorCode.unknownSettingsSection, `${name} is not a registered settings section.`, {
      context: { section: name },
    });
  }
}

/** The `App` the scene-graph suites run against. */
export class TestApp implements App {
  readonly time = new TestTime();
  readonly log: Logger;
  readonly diagnostics = new Diagnostics();
  readonly services = new TestServices();
  readonly settings: AppSettings;
  readonly onError = new Signal<ErrorReport>();
  readonly coroutines = new RecordingCoroutineHost();
  readonly tweens = new TweensImpl();
  readonly assets: AssetsImpl;
  readonly events: AppEventsImpl;
  readonly renderer: RendererImpl;
  readonly isHeadless = true;
  readonly version = "0.0.0-test";
  readonly platform: PlatformInfo = detectPlatform();
  readonly storage: Storage = new StorageImpl(new MemoryStorageBackend());
  readonly errors: ErrorReport[] = [];

  isRunning = false;

  #world: World | null = null;

  readonly #lite: AppLiteHandles;

  constructor(engine: LiteEngine, scene: LiteScene, layers: readonly string[]) {
    this.log = createLogger({ sink: createMemorySink() });
    this.settings = new TestSettings(layers);
    this.assets = new AssetsImpl({ app: this, diagnostics: this.diagnostics });
    this.events = new AppEventsImpl(() => {});
    this.#lite = { engine, scene };
    this.renderer = new RendererImpl(this, defaultRenderingSettings());
    this.onError.connect((report) => {
      this.errors.push(report);
    });
  }

  get world(): World {
    if (this.#world === null) {
      throw new Error("The test app has no world yet.");
    }
    return this.#world;
  }

  get lite(): AppLiteHandles {
    return this.#lite;
  }

  /**
   * Completes the two-way link between the app and its world.
   *
   * @param world - The world built on this app.
   */
  bindWorld(world: World): void {
    this.#world = world;
  }

  registerComponents(types: readonly ConcreteComponentType[]): void {
    this.world.registry.registerAll(types);
  }

  start(): Promise<void> {
    this.isRunning = true;
    return Promise.resolve();
  }

  stop(): void {
    this.isRunning = false;
  }

  dispose(): void {
    this.isRunning = false;
  }

  step(): void {
    throw new Error("The test app does not run frames; drive the lifecycle flushes directly.");
  }

  pause(): void {
    this.time.paused = true;
  }

  resume(): void {
    this.time.paused = false;
  }
}
