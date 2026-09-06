import type { AssetLoader, AssetTypeDefinition, Assets } from "../assets/types.js";
import type { ConcreteComponentType } from "../component/component-type.js";
import type { Component } from "../component/component.js";
import type { Diagnostics } from "../diagnostics/diagnostics.js";
import type { Entity } from "../entity/entity.js";
import type { HotReloadHost } from "../hot-reload/contract.js";
import type { PhysicsCallbackName } from "../lifecycle/callbacks.js";
import type { LiteEngine, LiteScene } from "../lite/scene.js";
import type { Logger } from "../log/logger.js";
import type { PlatformInfo } from "../platform/platform.js";
import type { Renderer, RenderingFeature } from "../render/renderer.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { Schema } from "../schema/types.js";
import type { Script } from "../script/script.js";
import type { Signal, SignalLike } from "../signal/signal.js";
import type { Storage } from "../storage/storage.js";
import type { Tweens } from "../tween/tweens.js";
import type { World } from "../world/world.js";

/**
 * The contracts the kernel and the runtime agree on: frame phases, the clock, systems, extensions,
 * services, coroutines, and the `App` surface a script sees through `this.app`
 * (`docs/architecture/01-lifecycle-and-time.md`, `03-scripting-and-components.md` §6–§7,
 * `04-extensions.md` §1).
 *
 * The module declares types and two frozen constant tables only — no classes and no behaviour — so
 * that the scene graph and the runtime can be written against it independently.
 */

/**
 * The ordered frame phases (`docs/architecture/01-lifecycle-and-time.md` §3). The ordinals are the
 * order the frame function walks them in, and they index the per-phase CPU timings in
 * `FrameSample.cpuMs`.
 *
 * @remarks
 * `EndOfFrame` is ordinal `0` because the work it carries is drained at the *top* of the next
 * frame, before the clock advances; the name describes when the work was queued, the ordinal
 * describes when it runs.
 *
 * @example
 * ```ts
 * ctx.registerSystem(new SpriteSyncSystem(), { phase: Phase.PreRender, order: 100 });
 * ```
 *
 * @public
 */
export const Phase = {
  /** Deferred signal deliveries and end-of-frame systems, drained at the start of the next frame. */
  EndOfFrame: 0,
  /** Input polling and asset delivery, before any script callback. */
  PreUpdate: 1,
  /** The fixed-timestep simulation loop: `fixedUpdate`, physics, collision dispatch. */
  FixedUpdate: 2,
  /** `update` on every enabled script, then coroutine resumption. */
  Update: 3,
  /** Animation, state machines, and tweens, between `update` and `lateUpdate`. */
  PostUpdate: 4,
  /** Render synchronisation: interpolation, sprite and camera sync, audio, diagnostics. */
  PreRender: 5,
} as const;

/**
 * The union of the frame phases.
 *
 * @public
 */
export type Phase = (typeof Phase)[keyof typeof Phase];

/**
 * Every phase in frame order, for loops that walk them all.
 *
 * @public
 */
export const PHASES: readonly Phase[] = Object.freeze([
  Phase.EndOfFrame,
  Phase.PreUpdate,
  Phase.FixedUpdate,
  Phase.Update,
  Phase.PostUpdate,
  Phase.PreRender,
]);

/**
 * The display name of each phase, indexed by its ordinal. Used by diagnostics and error messages.
 *
 * @public
 */
export const PHASE_NAMES: readonly string[] = Object.freeze([
  "EndOfFrame",
  "PreUpdate",
  "FixedUpdate",
  "Update",
  "PostUpdate",
  "PreRender",
]);

/**
 * The clock reached as `app.time` (`docs/architecture/01-lifecycle-and-time.md` §2). Every value is
 * in **seconds** unless its name ends in `Ms`.
 *
 * @example
 * ```ts
 * class Spin extends Script {
 *   update(dt: number): void {
 *     // `dt` is the argument, never `app.time.deltaTime`, inside a callback.
 *     this.transform.rotate({ x: 0, y: 90 * dt, z: 0 });
 *   }
 * }
 * ```
 *
 * @public
 */
export interface Time {
  /** Scaled seconds since the previous frame; what `update` and `lateUpdate` receive. */
  readonly deltaTime: number;
  /** Wall-clock frame delta after the {@link Time.maximumDeltaTime} clamp, unscaled. */
  readonly unscaledDeltaTime: number;
  /** The size of one fixed step; what `fixedUpdate` receives. Defaults to `1 / 60`. */
  fixedDeltaTime: number;
  /** Multiplier applied to {@link Time.unscaledDeltaTime}; `0` freezes scaled time. Defaults to `1`. */
  timeScale: number;
  /** Upper clamp on one frame's delta, in seconds. Defaults to `0.1`. */
  maximumDeltaTime: number;
  /** Scaled seconds since `app.start()`. */
  readonly time: number;
  /** Unscaled seconds since `app.start()`. */
  readonly unscaledTime: number;
  /** Scaled seconds advanced by fixed steps so far. */
  readonly fixedTime: number;
  /** Wall-clock seconds since the app was created, unaffected by pause or time scale. */
  readonly realtimeSinceStartup: number;
  /** How many frames have started. Starts at `0`. */
  readonly frameCount: number;
  /** `true` while `fixedUpdate` and physics run. */
  readonly inFixedStep: boolean;
  /** `accumulator / fixedDeltaTime` after the fixed loop, in `[0, 1)`; the interpolation alpha. */
  readonly fixedStepAlpha: number;
  /** When `true`, fixed steps stop and only `updateWhenPaused` scripts receive `update`. */
  paused: boolean;
}

/**
 * What a {@link System} is handed when its phase runs
 * (`docs/architecture/03-scripting-and-components.md` §6).
 *
 * @public
 */
export interface SystemContext {
  /** The world the system operates on. */
  readonly world: World;
  /** The app clock. */
  readonly time: Time;
  /** The phase currently running. */
  readonly phase: Phase;
  /**
   * Seconds elapsed: `time.deltaTime`, or `time.fixedDeltaTime` inside the fixed loop. Systems run
   * while the app is paused and `dt` is **not** zeroed then — only scripts are filtered by
   * `updateWhenPaused` — so a system that animates checks `time.paused` itself.
   */
  readonly dt: number;
}

/**
 * Engine-level logic that runs once per phase over many components, registered by an extension
 * (`docs/architecture/03-scripting-and-components.md` §6). Systems are not attached to entities and
 * never call script callbacks themselves.
 *
 * @example
 * ```ts
 * class SpriteSyncSystem implements System {
 *   readonly name = "sprite-sync";
 *   update(ctx: SystemContext): void {
 *     const sprites = ctx.world.components(SpriteRenderer);
 *     for (let index = 0; index < sprites.length; index += 1) {
 *       sprites[index]?.sync();
 *     }
 *   }
 * }
 * ```
 *
 * @public
 */
export interface System {
  /** A unique, human-readable name used in diagnostics and error reports. */
  readonly name: string;
  /**
   * Runs the system's work for one phase.
   *
   * @param ctx - The world, clock, phase, and delta for this invocation.
   */
  update?(ctx: SystemContext): void;
  /**
   * Called once when the world the system belongs to has been created.
   *
   * @param world - The new world.
   */
  onWorldCreated?(world: World): void;
  /**
   * Called once when the world the system belongs to is being disposed.
   *
   * @param world - The world going away.
   */
  onWorldDisposed?(world: World): void;
  /** Releases resources the system owns. */
  dispose?(): void;
}

/**
 * The token a service is registered and looked up under
 * (`docs/architecture/04-extensions.md` §1). Either the service's own abstract class — the common
 * case, so `ctx.require(PhysicsService)` reads naturally — or a branded token from
 * {@link createServiceKey} for services that have no class of their own.
 *
 * @typeParam T - The service instance type the key stands for.
 *
 * @public
 */
export type ServiceKey<T> = ServiceClassKey<T> | ServiceNameKey<T>;

/**
 * A service key that is a class: the constructor itself is the token.
 *
 * @typeParam T - The service instance type.
 *
 * @public
 */
export type ServiceClassKey<T> = abstract new (...args: never[]) => T;

/**
 * A service key created from a name, for services that are plain objects rather than classes.
 *
 * @typeParam T - The service instance type. It is a compile-time marker only: `serviceOf` is never
 * assigned at runtime, and it is what makes two keys with different service types different types.
 *
 * @public
 */
export interface ServiceNameKey<T> {
  /** The name the key was created with, used in error messages. */
  readonly serviceName: string;
  /** Compile-time marker for the service type; never present at runtime. */
  readonly serviceOf?: T;
}

/**
 * Creates a named service key for a service that has no class to use as a token.
 *
 * @typeParam T - The service instance type the key stands for.
 * @param name - A unique, human-readable name, used in `IGX-0405` messages.
 * @returns The key. It is a plain frozen object, so it is safe at module scope.
 *
 * @example
 * ```ts
 * export const StorageService: ServiceKey<Storage> = createServiceKey<Storage>("storage");
 * ctx.registerService(StorageService, new LocalStorage());
 * ```
 *
 * @public
 */
export function createServiceKey<T>(name: string): ServiceNameKey<T> {
  return Object.freeze({ serviceName: name });
}

/**
 * The per-app service table (`docs/architecture/04-extensions.md` §1). Extensions write to it
 * through `ExtensionContext.registerService`; scripts read from it.
 *
 * @public
 */
export interface ServiceRegistry {
  /**
   * Looks a service up, requiring it to be present.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key the service was registered under.
   * @returns The registered instance.
   * @throws IgnifxError with code `IGX-0405` when no extension registered the service.
   */
  get<T>(key: ServiceKey<T>): T;
  /**
   * Looks a service up, tolerating its absence — the pattern for game code that must work with or
   * without an optional extension.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key the service was registered under.
   * @returns The instance, or `null` when it is not registered.
   */
  tryGet<T>(key: ServiceKey<T>): T | null;
  /**
   * Reports whether a service is registered.
   *
   * @param key - The class or named key.
   * @returns `true` when an instance is registered under the key.
   */
  has(key: ServiceKey<unknown>): boolean;
}

/**
 * The `layers` project settings section (`docs/architecture/04-extensions.md` §5,
 * `02-scene-graph.md` §7).
 *
 * @public
 */
export interface LayersSettings {
  /** The project's layer names in declaration order. */
  readonly layers: readonly string[];
}

/**
 * The `sortingLayers` project settings section, consumed by the 2D toolkit.
 *
 * @public
 */
export interface SortingLayersSettings {
  /** The project's sorting-layer names, back to front. */
  readonly sortingLayers: readonly string[];
}

/**
 * The `time` project settings section (`docs/architecture/01-lifecycle-and-time.md` §2).
 *
 * @public
 */
export interface TimeSettings {
  /** The initial fixed step in seconds. Defaults to `1 / 60`. */
  readonly fixedDeltaTime?: number;
  /** The initial frame-delta clamp in seconds. Defaults to `0.1`. */
  readonly maximumDeltaTime?: number;
  /** The initial time scale. Defaults to `1`. */
  readonly timeScale?: number;
}

/**
 * Resolved project settings, reached as `app.settings`
 * (`docs/architecture/04-extensions.md` §5). Each section is validated against the schema the
 * owning extension registered.
 *
 * @public
 */
export interface AppSettings {
  /** The core `layers` section. */
  readonly layers: LayersSettings;
  /** The core `sortingLayers` section. */
  readonly sortingLayers: SortingLayersSettings;
  /** The core `time` section. */
  readonly time: TimeSettings;
  /**
   * Reads an extension-registered section.
   *
   * @typeParam S - The section's resolved shape.
   * @param name - The section name the extension registered.
   * @returns The resolved section.
   * @throws IgnifxError with code `IGX-0407` when the section was never registered.
   */
  // The type parameter appears once on purpose: it is the caller's declaration of what the section
  // holds, the same escape hatch `JSON.parse`-style APIs use. There is no value to infer it from.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  section<S>(name: string): S;
}

/**
 * A failure the engine caught at a boundary and reported instead of rethrowing
 * (`docs/architecture/01-lifecycle-and-time.md` §5, `15-devtools-and-diagnostics.md` §1). One
 * script throwing never stops the others.
 *
 * @example
 * ```ts
 * app.onError.connect((report) => {
 *   app.log.error(`${report.source} callback threw on ${report.entity?.name ?? "-"}`, report.error);
 * });
 * ```
 *
 * @public
 */
export interface ErrorReport {
  /** Whatever was thrown. Usually an `Error`, often an `IgnifxError`. */
  readonly error: unknown;
  /** Which boundary caught it. */
  readonly source: "lifecycle" | "coroutine" | "system" | "extension" | "asset";
  /** The phase that was running, or `null` outside a phase (a lifecycle flush, say). */
  readonly phase: Phase | null;
  /** The entity involved, or `null` when the failure is not entity-scoped. */
  readonly entity: Entity | null;
  /** The component involved, or `null` when the failure is not component-scoped. */
  readonly component: Component | null;
}

/**
 * A generator coroutine (`docs/architecture/01-lifecycle-and-time.md` §5, ADR-0010). The scheduler
 * resumes it synchronously at defined points in the frame; it is never an `async` function.
 *
 * @public
 */
export type Coroutine = Generator<CoroutineYield, void, unknown>;

/**
 * Everything a coroutine may `yield`: `null`/`undefined` for "next frame", a wait instruction, a
 * handle to another coroutine to wait for, or a promise to resume on once it settles.
 *
 * @public
 */
export type CoroutineYield = null | undefined | WaitInstruction | CoroutineHandle | Promise<unknown>;

/**
 * A wait a coroutine yielded, built by `waitSeconds`, `waitSecondsRealtime`, `waitFixedUpdate`,
 * `waitUntil`, or `waitWhile`.
 *
 * @public
 */
export interface WaitInstruction {
  /** Which kind of wait this is; the scheduler switches on it. */
  readonly kind: "seconds" | "secondsRealtime" | "fixedUpdate" | "until" | "while";
  /** How long to wait, for the two timed kinds. */
  readonly seconds?: number;
  /** The condition, for the two predicate kinds. */
  readonly predicate?: () => boolean;
}

/**
 * The observable state of a running coroutine, returned by `Script.startCoroutine`.
 *
 * @public
 */
export interface CoroutineHandle {
  /** `true` while the coroutine is still scheduled — including while it is paused. */
  readonly isRunning: boolean;
  /** `true` once the coroutine has finished, been stopped, or been cancelled. */
  readonly isDone: boolean;
}

/**
 * The coroutine scheduler, reached as `app.coroutines` and driven by `Script.startCoroutine`
 * (`docs/architecture/01-lifecycle-and-time.md` §5). The kernel calls
 * {@link CoroutineHost.setPaused} on every enable transition and {@link CoroutineHost.cancelAll}
 * when a script is destroyed.
 *
 * @public
 */
export interface CoroutineHost {
  /**
   * Schedules a coroutine owned by a script.
   *
   * @param owner - The script whose enabled state gates the coroutine.
   * @param routine - The generator to drive.
   * @returns A handle for stopping it or waiting on it.
   */
  start(owner: Script, routine: Coroutine): CoroutineHandle;
  /**
   * Stops one coroutine. Stopping an already finished coroutine is a no-op.
   *
   * @param handle - The handle returned by {@link CoroutineHost.start}.
   */
  stop(handle: CoroutineHandle): void;
  /**
   * Stops every coroutine a script started.
   *
   * @param owner - The owning script.
   */
  stopAll(owner: Script): void;
  /**
   * Pauses or resumes every coroutine a script started, without discarding their state.
   *
   * @param owner - The owning script.
   * @param paused - `true` to pause, `false` to resume.
   */
  setPaused(owner: Script, paused: boolean): void;
  /**
   * Cancels every coroutine a script started and detaches any promise they were waiting on, so the
   * continuation never runs. Called by the destroy flush and by world disposal.
   *
   * @param owner - The owning script.
   */
  cancelAll(owner: Script): void;
}

/**
 * Babylon Lite objects an app owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3); excluded from the stability guarantees of
 * `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export interface AppLiteHandles {
  /** The Lite engine — a WebGPU engine, or the null engine in headless mode. */
  readonly engine: LiteEngine;
  /** The Lite scene the world renders into. */
  readonly scene: LiteScene;
}

/**
 * What Babylon Lite reported when the WebGPU device was lost
 * (`docs/architecture/07-rendering.md` §4).
 *
 * @public
 */
export interface DeviceLostInfo {
  /** The `GPUDeviceLostInfo.reason` string, or `null` when the host gave none. */
  readonly reason: string | null;
  /** The human-readable message. */
  readonly message: string;
}

/**
 * The engine-wide events reached as `app.events` (`docs/architecture/02-scene-graph.md` §8,
 * `07-rendering.md` §4). Extensions add their own signals through declaration merging, the same way
 * they add app properties.
 *
 * @example
 * ```ts
 * class Hud extends Script {
 *   onEnable(): void {
 *     this.app.events.onSceneLoaded.connect((scene) => this.rebuild(scene), { owner: this });
 *   }
 * }
 * ```
 *
 * @public
 */
export interface AppEvents {
  /** A scene instance and its entities exist. */
  readonly onSceneLoaded: SignalLike<SceneInstance>;
  /** A scene instance is about to be unloaded and its entities destroyed. */
  readonly onSceneUnloaded: SignalLike<SceneInstance>;
  /** The WebGPU device was lost; rendering is suspended while Lite rebuilds it. */
  readonly onDeviceLost: SignalLike<DeviceLostInfo>;
  /** The WebGPU device and its resources were rebuilt. */
  readonly onDeviceRecovered: SignalLike;
  /** Recovery failed; the payload is whatever the recovery path reported. */
  readonly onDeviceRecoveryFailed: SignalLike<unknown>;
}

/**
 * The root object of a game and the surface a script sees through `this.app`
 * (`docs/architecture/00-overview.md` §1). There are no globals: every engine service is reached
 * from here, or from the `entity`/`world` a script belongs to (`CONSTITUTION.md` §3.6).
 *
 * @remarks
 * Extensions add typed properties through declaration merging
 * (`docs/architecture/03-scripting-and-components.md` §7), so `this.app.input` is fully typed when
 * `@ignifx/input` is installed and a compile error when it is not.
 *
 * @example
 * ```ts
 * class Menu extends Script {
 *   static updateWhenPaused = true;
 *   onEnable(): void {
 *     this.app.pause();
 *   }
 * }
 * ```
 *
 * @public
 */
export interface App {
  /** The clock. */
  readonly time: Time;
  /** The running simulation. */
  readonly world: World;
  /** Addressed, reference-counted asset loading (`docs/architecture/05-assets-and-loading.md` §4). */
  readonly assets: Assets;
  /** Engine-wide events (`docs/architecture/02-scene-graph.md` §8). */
  readonly events: AppEvents;
  /**
   * Surface sizing, material warm-up, GPU picking, screenshots, and the render diagnostics
   * (`docs/architecture/07-rendering.md` §1, §3, §5).
   */
  readonly renderer: Renderer;
  /** The app-scoped logger. */
  readonly log: Logger;
  /** Per-frame counters and profiling scopes. */
  readonly diagnostics: Diagnostics;
  /** Services registered by extensions. */
  readonly services: ServiceRegistry;
  /** Resolved project settings. */
  readonly settings: AppSettings;
  /** Every failure the engine caught at a boundary rather than rethrowing. */
  readonly onError: Signal<ErrorReport>;
  /** `true` when the app runs on Lite's null engine with no render surface. */
  readonly isHeadless: boolean;
  /** `true` between `start()` and `stop()`/`dispose()`. */
  readonly isRunning: boolean;
  /** The `@ignifx/core` version this app was built from. */
  readonly version: string;
  /**
   * Where the app is running, what it is running on, and what its WebGPU adapter offers
   * (`docs/architecture/14-platform-electron.md` §1).
   */
  readonly platform: PlatformInfo;
  /**
   * The asynchronous key-value store settings, save games, and input rebindings live in
   * (`docs/architecture/14-platform-electron.md` §2). The backend is chosen from
   * {@link PlatformInfo.kind} — IndexedDB in a browser, memory under Node — unless `createApp` was
   * given one.
   */
  readonly storage: Storage;
  /** Unstable Babylon Lite escape hatch (`docs/architecture/00-overview.md` §3). */
  readonly lite: AppLiteHandles;
  /** The coroutine scheduler. */
  readonly coroutines: CoroutineHost;
  /**
   * The app-wide tween list (`docs/architecture/12-3d-toolkit.md` §4), advanced in `PostUpdate` on
   * ignifx's clock and used by both toolkits.
   */
  readonly tweens: Tweens;
  /**
   * Script and scene hot reload (`docs/architecture/15-devtools-and-diagnostics.md` §5). The Vite
   * plugin's HMR client drives it in development; it works headlessly with no bundler at all.
   */
  readonly hotReload: HotReloadHost;
  /**
   * Makes component `typeId`s known to the serializer and the inspector
   * (`docs/architecture/03-scripting-and-components.md` §4).
   *
   * @param types - The component classes to register.
   * @throws IgnifxError with code `IGX-0203` when a `typeId` is already registered.
   */
  registerComponents(types: readonly ConcreteComponentType[]): void;
  /**
   * Runs extension `onStart` hooks and starts the frame loop.
   *
   * @returns A promise that settles once the first frame has been submitted.
   */
  start(): Promise<void>;
  /** Stops the frame loop without disposing anything. */
  stop(): void;
  /** Stops the loop, disposes the world, the extensions, and the Lite objects. */
  dispose(): void;
  /**
   * Runs exactly one frame with a supplied delta — the headless driver
   * (`docs/architecture/01-lifecycle-and-time.md` §8).
   *
   * @param deltaSeconds - The raw frame delta in seconds, before the maximum-delta clamp.
   */
  step(deltaSeconds: number): void;
  /** Sets `time.paused`. */
  pause(): void;
  /** Clears `time.paused`. */
  resume(): void;
}

/**
 * Where in the frame the engine currently is, as far as the scene graph needs to know
 * (`docs/architecture/01-lifecycle-and-time.md` §4, §6). The scheduler and the lifecycle queue
 * write it; `Entity` and the queue read it to decide whether `awake` runs nested and synchronously
 * and whether `destroyImmediate` is legal.
 *
 * @public
 */
export interface FrameState {
  /** `true` while a lifecycle callback, a script callback, or a coroutine body is on the stack. */
  readonly isInsideCallback: boolean;
  /** `true` while the fixed loop is running (`time.inFixedStep`). */
  readonly isInsideFixedStep: boolean;
}

/**
 * Options accepted by `ExtensionContext.registerComponent`.
 *
 * @public
 */
export interface RegisterComponentOptions {
  /** An explicit registration id, when the class does not declare one. */
  readonly typeId?: string;
}

/**
 * Options accepted by `ExtensionContext.registerSystem`.
 *
 * @public
 */
export interface RegisterSystemOptions {
  /** Which phase the system runs in. */
  readonly phase: Phase;
  /** Ascending order within the phase; core uses `[-1000, 1000]`, extensions `[1001, 9999]`. */
  readonly order?: number;
}

/**
 * An extension's registration surface (`docs/architecture/04-extensions.md` §1). Everything an
 * extension contributes is declared here; nothing happens at module import time
 * (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export interface ExtensionContext {
  /** The app being built. */
  readonly app: App;
  /** A logger scoped to this extension. */
  readonly log: Logger;
  /**
   * Registers one component class.
   *
   * @param type - The component class.
   * @param options - An explicit `typeId`, when the class does not declare one.
   */
  registerComponent(type: ConcreteComponentType, options?: RegisterComponentOptions): void;
  /**
   * Registers several component classes.
   *
   * @param types - The component classes.
   */
  registerComponents(types: readonly ConcreteComponentType[]): void;
  /**
   * Registers a system in a phase.
   *
   * @param system - The system.
   * @param options - The phase and the ascending order within it; core uses `[-1000, 1000]`.
   */
  registerSystem(system: System, options: RegisterSystemOptions): void;
  /**
   * Registers a service instance under a key.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @param instance - The service.
   */
  registerService<T>(key: ServiceKey<T>, instance: T): void;
  /**
   * Declares an asset type whose loader is registered separately, or not at all, so that addresses
   * with its extensions resolve to a type (`docs/architecture/04-extensions.md` §1).
   *
   * @param type - The type name and the extensions that select it.
   */
  registerAssetType(type: AssetTypeDefinition): void;
  /**
   * Registers an asset loader (`docs/architecture/05-assets-and-loading.md` §5).
   *
   * @param loader - The loader, which also declares the extensions that select its type.
   * @throws IgnifxError with code `IGX-0506` when another extension already owns the type.
   */
  registerAssetLoader(loader: AssetLoader): void;
  /**
   * Declares that this extension needs a rendering feature switched on
   * (`docs/architecture/07-rendering.md` §1.1).
   *
   * @remarks
   * Babylon Lite compiles its shader permutations and records its frame graph inside
   * `registerScene`, so every feature that changes what gets compiled has to be on before that
   * call. `register` runs before `app.start()` does it, so this is a *declaration* there: the
   * feature is switched on whether or not the project listed it. After the scene is registered it
   * is a refusal instead.
   *
   * @param feature - The feature the extension needs.
   * @throws IgnifxError with code `IGX-0704` when the render scene has already been registered.
   *
   * @example
   * ```ts
   * register(ctx: ExtensionContext): void {
   *   ctx.requireRenderingFeature("skeletons");
   * }
   * ```
   */
  requireRenderingFeature(feature: RenderingFeature): void;
  /**
   * Defines a property on `App`, pairing with a module augmentation of the `App` interface.
   *
   * @param name - The property name, for example `"input"`.
   * @param getter - Returns the value each time the property is read.
   * @throws IgnifxError with code `IGX-0401` when the property is already defined.
   */
  defineAppProperty(name: string, getter: () => unknown): void;
  /**
   * Registers a project settings section.
   *
   * @typeParam S - The section's resolved shape.
   * @param section - The section name as it appears in `ignifx.config.ts`.
   * @param schema - The schema the section is validated against.
   * @param defaults - The values used when the project omits the section.
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see `AppSettings.section`.
  registerSettings<S>(section: string, schema: Schema, defaults: S): void;
  /**
   * Adds diagnostic codes to the app's error-code registry.
   *
   * @param codes - `IGX-####` to one-line message template.
   */
  registerErrorCodes(codes: Readonly<Record<string, string>>): void;
  /**
   * Delivers one physics callback to every script on an entity that implements it, for extension
   * authors (`docs/architecture/09-physics.md` §4). The scheduler stays the only thing that calls a
   * script callback: this routes through the same guarded call site the frame loop uses
   * (`03-scripting-and-components.md` §6).
   *
   * @remarks
   * Delivery is synchronous and in component order, to effectively-enabled scripts only; a
   * destroyed or inactive entity receives nothing. A handler that throws is reported to
   * `app.onError` with `source: "lifecycle"` and the running phase, and the remaining scripts still
   * receive the callback. Nothing is allocated per call.
   *
   * @param entity - The entity whose scripts should receive the callback.
   * @param kind - Which physics callback to deliver.
   * @param argument - The single argument the callback receives — a collision or a trigger event.
   * @throws IgnifxError with code `IGX-0409` in development when called from outside the fixed
   * loop, where `01-lifecycle-and-time.md` §3 says these callbacks never run. Production builds
   * deliver it anyway rather than losing the event.
   *
   * @example
   * ```ts
   * for (let index = 0; index < events.length; index += 1) {
   *   ctx.dispatchScriptCallback(events[index].entity, PhysicsCallbackName.onTriggerEnter, events[index]);
   * }
   * ```
   *
   * @beta
   */
  dispatchScriptCallback(entity: Entity, kind: PhysicsCallbackName, argument: unknown): void;
  /**
   * Whether any script on an entity implements a physics callback, for extension authors. This is
   * what `Rigidbody.collisionEvents` auto-detection asks (`09-physics.md` §2.1).
   *
   * @remarks
   * The answer ignores `enabled`, so it stays stable while scripts are toggled and only changes
   * when a component is added or removed — the two moments the physics extension recomputes it.
   * Components already queued for destruction do not count.
   *
   * @param entity - The entity to inspect.
   * @param kind - Which physics callback.
   * @returns `true` when at least one script on the entity implements it.
   *
   * @beta
   */
  entityImplements(entity: Entity, kind: PhysicsCallbackName): boolean;
  /**
   * Publishes the scene an extension simulates in as `world.lite.simulationScene`, for extension
   * authors (`docs/architecture/09-physics.md` §1, `02-scene-graph.md` §2).
   *
   * @param scene - The simulation scene, or `null` to clear it from the extension's `dispose`.
   * @throws IgnifxError with code `IGX-0410` when the world already has a different simulation
   * scene.
   *
   * @beta
   */
  setSimulationScene(scene: LiteScene | null): void;
  /**
   * Registers a callback that runs when the app is disposed.
   *
   * @param callback - The teardown to run.
   */
  onDispose(callback: () => void): void;
  /**
   * Looks up a service registered by an earlier extension.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @returns The instance.
   * @throws IgnifxError with code `IGX-0405` when the service is not registered.
   */
  require<T>(key: ServiceKey<T>): T;
  /**
   * Looks up a service registered by an earlier extension, tolerating its absence.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @returns The instance, or `null` when it is not registered.
   */
  tryGet<T>(key: ServiceKey<T>): T | null;
  /**
   * Reads a resolved settings section.
   *
   * @typeParam S - The section's resolved shape.
   * @param section - The section name.
   * @returns The resolved section.
   * @throws IgnifxError with code `IGX-0407` when the section was never registered.
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see `AppSettings.section`.
  settings<S>(section: string): S;
}

/**
 * The unit of optional functionality (`docs/architecture/04-extensions.md` §1). Core features are
 * extensions too (`CONSTITUTION.md` §8.1).
 *
 * @public
 */
export interface Extension {
  /** Unique name; the npm package name for published extensions. */
  readonly name: string;
  /** The semver version of the extension itself. */
  readonly version: string;
  /** The semver range of `@ignifx/core` this extension supports, checked at registration. */
  readonly engine?: string;
  /** Extensions that must be registered before this one. */
  readonly requires?: readonly string[];
  /** Extensions this one integrates with when they are present. */
  readonly optional?: readonly string[];
  /**
   * Declares components, systems, services, loaders, and settings.
   *
   * @param ctx - The registration surface.
   * @returns Nothing, or a promise the host awaits before registering the next extension.
   */
  register(ctx: ExtensionContext): void | Promise<void>;
  /**
   * Runs after every extension registered and the Lite engine exists, before the first frame.
   *
   * @param app - The app being started.
   * @returns Nothing, or a promise `app.start()` awaits.
   */
  onStart?(app: App): void | Promise<void>;
  /**
   * Runs when the app stops, in reverse registration order.
   *
   * @param app - The app being stopped.
   */
  onStop?(app: App): void;
  /**
   * Releases everything the extension owns, in reverse registration order.
   *
   * @param app - The app being disposed.
   */
  dispose?(app: App): void;
}
