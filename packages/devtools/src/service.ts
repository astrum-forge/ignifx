import { assertNever, Signal } from "@ignifx/core";
import { resolveDevtoolsTarget } from "./dom/dom-target.js";
import { devtoolsError, DevtoolsErrorCode } from "./errors.js";
import { createHotReloadBridge } from "./hot-reload.js";
import { DevtoolsOverlay } from "./overlay/overlay.js";
import { createPanelHost } from "./overlay/panel-host.js";
import { DevtoolsSampler } from "./overlay/sampler.js";
import { installToggleKey } from "./overlay/toggle-key.js";
import { WorldIndex } from "./overlay/world-index.js";
import { createAssetsPanel } from "./panels/assets.js";
import { createAudioPanel } from "./panels/audio.js";
import { createConsolePanel } from "./panels/console.js";
import { createInputPanel } from "./panels/input.js";
import { createInspectorPanel } from "./panels/inspector.js";
import { createPhysicsPanel } from "./panels/physics.js";
import { createSceneTreePanel } from "./panels/scene-tree.js";
import { createStatsPanel } from "./panels/stats.js";
import { createTimelinePanel } from "./panels/timeline.js";
import { createSceneReloadWatcher } from "./scene-reload.js";
import { resolvePanelOrder } from "./settings.js";
import type { DevtoolsDomTarget } from "./dom/dom-target.js";
import type { HotReloadBridge, HotReloadReportView } from "./hot-reload.js";
import type { DevtoolsLogSink } from "./log-sink.js";
import type { DevtoolsErrorEntry, DevtoolsHotReloadEntry, DevtoolsPanel, DevtoolsPanelHost } from "./overlay/panel.js";
import type { SceneReloadWatcher } from "./scene-reload.js";
import type { DevtoolsPanelName, DevtoolsSettings } from "./settings.js";
import type { App, Disconnect, Entity, ErrorReport, SignalLike, System } from "@ignifx/core";

/**
 * `app.devtools` (`docs/architecture/15-devtools-and-diagnostics.md` §4).
 *
 * ## Zero cost when closed
 *
 * The exit criterion in `docs/plan/engineering-plan.md` Phase 10 is that a registered-but-closed
 * devtools costs nothing. What that means here, precisely:
 *
 * - **No system while it has never been opened.** `devtools()` registers no system in `register`.
 *   The `PreRender` sampler is registered by the first {@link DevtoolsService.open}, through the
 *   callback the extension handed the service.
 * - **No subscriptions while closed.** `app.onError`, the world's four structural signals, the
 *   hot-reload signal and the scene-reload watcher are all connected by `open()` and disconnected
 *   by `close()`.
 * - **No DOM while closed.** `close()` disposes the overlay and its panels; `open()` rebuilds them.
 *   Panel visibility survives the round trip because the service, not the overlay, owns it.
 * - **One live listener.** The toggle key, which is one `keydown` handler doing one string
 *   comparison.
 *
 * The one thing core does **not** allow is removing the sampler system again: `Scheduler` has a
 * `registerSystem` and no `unregisterSystem`, so once the overlay has been opened the system stays
 * registered for the app's life and returns on its first line while the overlay is closed. That is
 * one predicate per frame, and it is what `benchmarks/devtools-closed.test.ts` measures.
 *
 * ## Where the sampler runs
 *
 * `Phase.PreRender`, order {@link DEVTOOLS_SAMPLE_ORDER} = 9000. Core's render sync is 900
 * (`packages/core/src/render/render-sync-system.ts`), `@ignifx/ui` is 1100, `@ignifx/2d` is -450
 * and `@ignifx/audio` is -400, and `04-extensions.md` gives extensions `[1001, 9999]`. 9000 is
 * after every one of them, which is the only order at which the sample reports the numbers those
 * systems just wrote rather than the previous frame's.
 */

/**
 * The `Phase.PreRender` order the sampler runs at: after every renderer, 2D, UI and audio system,
 * and inside the `[1001, 9999]` band `docs/architecture/04-extensions.md` gives extensions.
 *
 * @public
 */
export const DEVTOOLS_SAMPLE_ORDER = 9000;

/**
 * How many `app.onError` reports the Console panel retains while the overlay is open. Reports that
 * arrive while it is closed are not retained: a closed overlay holds no subscription.
 *
 * @public
 */
export const DEVTOOLS_ERROR_LIMIT = 50;

/**
 * How many `app.hotReload` reports the Console and Stats panels retain
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 *
 * @public
 */
export const DEVTOOLS_HOT_RELOAD_LIMIT = 20;

/**
 * One panel, as `app.devtools.panel(name)` hands it out.
 *
 * @public
 */
export interface DevtoolsPanelHandle {
  /** The panel's name. */
  readonly name: string;
  /** The tab label. */
  readonly title: string;
  /** Whether the panel's tab is shown. */
  readonly visible: boolean;
  /** Shows the panel's tab and brings it to the front. */
  show(): void;
  /** Hides the panel's tab; the neighbouring tab takes over when it was the visible one. */
  hide(): void;
}

/**
 * What {@link DevtoolsService} is constructed with.
 *
 * @internal
 */
export interface DevtoolsServiceOptions {
  /** The app being inspected. */
  readonly app: App;
  /** The resolved settings, already merged with the extension's options. */
  readonly settings: DevtoolsSettings;
  /** The Console panel's sink, when the game installed one. */
  readonly logSink: DevtoolsLogSink | null;
  /**
   * Finds the DOM to mount the overlay in, or answers `null` for a headless app. Defaults to
   * resolving `app.renderer.surface`; the node suites pass a fake, which is the same seam
   * `@ignifx/ui`'s `UiHostOptions.resolveTarget` opens and for the same reason.
   */
  readonly resolveTarget?: () => DevtoolsDomTarget | null;
  /**
   * Registers the sampler system in `Phase.PreRender` at {@link DEVTOOLS_SAMPLE_ORDER}. Called at
   * most once, by the first `open()`.
   *
   * @param system - The system to register.
   */
  readonly registerSystem: (system: System) => void;
}

/**
 * The devtools overlay's controller, reached as `app.devtools`.
 *
 * @example
 * ```ts
 * app.devtools.open();
 * app.devtools.panel("inspector").show();
 * app.devtools.select(app.world.findByName("Player"));
 * ```
 *
 * @public
 */
export class DevtoolsService {
  readonly #app: App;
  readonly #settings: DevtoolsSettings;
  readonly #registerSystem: (system: System) => void;
  readonly #resolveTarget: () => DevtoolsDomTarget | null;
  readonly #order: readonly DevtoolsPanelName[];
  readonly #visible = new Map<DevtoolsPanelName, boolean>();
  readonly #errors: DevtoolsErrorEntry[] = [];
  readonly #hotReloads: DevtoolsHotReloadEntry[] = [];
  readonly #subscriptions: Disconnect[] = [];
  readonly #opened = new Signal();
  readonly #closed = new Signal();
  readonly #selectionChanged = new Signal<Entity | null>();
  readonly #sampler: DevtoolsSampler;
  readonly #index: WorldIndex;
  readonly #hotReload: HotReloadBridge;
  readonly #sceneReload: SceneReloadWatcher;
  readonly #host: DevtoolsPanelHost;
  #overlay: DevtoolsOverlay | null = null;
  #panels: DevtoolsPanel[] = [];
  #detachToggle: (() => void) | null = null;
  #selected: Entity | null = null;
  #reloadScenes: boolean;
  #isOpen = false;
  #systemRegistered = false;
  #disposed = false;

  /**
   * Builds the service. `devtools()` does this; a game never constructs one.
   *
   * @param options - The app, the settings, the log sink, and the system registrar.
   *
   * @internal
   */
  constructor(options: DevtoolsServiceOptions) {
    this.#app = options.app;
    this.#settings = options.settings;
    this.#registerSystem = options.registerSystem;
    this.#resolveTarget =
      options.resolveTarget ?? ((): DevtoolsDomTarget | null => resolveDevtoolsTarget(options.app.renderer.surface));
    this.#order = resolvePanelOrder(options.settings.panels);
    this.#reloadScenes = options.settings.reloadScenes;
    this.#sampler = new DevtoolsSampler(options.app);
    this.#index = new WorldIndex(options.app);
    this.#hotReload = createHotReloadBridge(options.app);
    this.#sceneReload = createSceneReloadWatcher({
      app: options.app,
      report: (error: unknown): void => {
        this.#report(error);
      },
      onReloaded: (scene: string): void => {
        this.#pushHotReload({ label: `scene ${scene}`, detail: "re-instantiated", failed: false });
      },
    });
    this.#host = createPanelHost({
      app: options.app,
      sampler: this.#sampler,
      index: this.#index,
      logSink: options.logSink,
      getDocument: (): Document | null => this.#resolveTarget()?.document ?? null,
      errors: this.#errors,
      hotReloads: this.#hotReloads,
      getSelected: (): Entity | null => this.#selected,
      getReloadScenes: (): boolean => this.#reloadScenes,
      getSceneReloadDelegated: (): boolean => this.#sceneReload.isDelegated,
      select: (entity: Entity | null): void => {
        this.select(entity);
      },
      setReloadScenes: (value: boolean): void => {
        this.reloadScenes = value;
      },
      report: (error: unknown): void => {
        this.#report(error);
      },
    });
  }

  /**
   * Whether the overlay is up.
   *
   * @returns `true` between {@link DevtoolsService.open} and {@link DevtoolsService.close}.
   */
  get isOpen(): boolean {
    return this.#isOpen;
  }

  /**
   * The entity the Inspector panel is showing.
   *
   * @returns The entity, or `null`.
   */
  get selected(): Entity | null {
    return this.#selected;
  }

  /**
   * Whether a scene file that changes on disk re-instantiates its live scene instances
   * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
   *
   * @returns `true` while scene reload is on.
   */
  get reloadScenes(): boolean {
    return this.#reloadScenes;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set reloadScenes(value: boolean) {
    if (this.#reloadScenes === value) {
      return;
    }
    this.#reloadScenes = value;
    this.#sceneReload.setEnabled(value && this.#isOpen);
  }

  /**
   * Whether `app.hotReload` is already re-instantiating scene instances, in which case
   * {@link DevtoolsService.reloadScenes} deliberately does nothing rather than reloading twice.
   *
   * @returns `true` when core's own `hotReload.reloadScenes` is on.
   */
  get isSceneReloadDelegated(): boolean {
    return this.#sceneReload.isDelegated;
  }

  /**
   * Emitted after the overlay opened.
   *
   * @returns The signal.
   */
  get onOpened(): SignalLike {
    return this.#opened;
  }

  /**
   * Emitted after the overlay closed.
   *
   * @returns The signal.
   */
  get onClosed(): SignalLike {
    return this.#closed;
  }

  /**
   * Emitted whenever {@link DevtoolsService.select} changes the selection.
   *
   * @returns The signal.
   */
  get onSelectionChanged(): SignalLike<Entity | null> {
    return this.#selectionChanged;
  }

  /**
   * Every panel this build carries, in tab order.
   *
   * @returns The handles.
   */
  get panels(): readonly DevtoolsPanelHandle[] {
    const out: DevtoolsPanelHandle[] = [];
    for (let index = 0; index < this.#order.length; index += 1) {
      const name = this.#order[index];
      if (name !== undefined) {
        out.push(this.panel(name));
      }
    }
    return out;
  }

  /**
   * Opens the overlay. On a headless app — or on any app with no DOM canvas — it is a documented
   * no-op with one debug line (`docs/architecture/07-rendering.md` §6).
   */
  open(): void {
    if (this.#isOpen || this.#disposed) {
      return;
    }
    const target = this.#resolveTarget();
    if (target === null) {
      this.#app.log
        .child("devtools")
        .debug("app.devtools.open() did nothing: this app has no DOM to mount the overlay in.");
      return;
    }
    this.#isOpen = true;
    if (!this.#systemRegistered) {
      this.#systemRegistered = true;
      this.#registerSystem(new DevtoolsSampleSystem(this));
    }
    this.#panels = this.#buildPanels();
    this.#overlay = new DevtoolsOverlay({
      app: this.#app,
      target,
      host: this.#host,
      panels: this.#panels,
      settings: this.#settings,
    });
    for (const [name, visible] of this.#visible) {
      this.#overlay.setPanelVisible(name, visible);
    }
    this.#subscribe();
    this.#sceneReload.setEnabled(this.#reloadScenes);
    this.#index.invalidate();
    this.#overlay.update(0, true);
    this.#opened.emit();
  }

  /** Closes the overlay, disposing its DOM and every subscription it installed. */
  close(): void {
    if (!this.#isOpen) {
      return;
    }
    this.#isOpen = false;
    this.#unsubscribe();
    this.#sceneReload.setEnabled(false);
    this.#overlay?.dispose();
    this.#overlay = null;
    this.#panels = [];
    this.#closed.emit();
  }

  /** Opens the overlay when it is closed and closes it when it is open. */
  toggle(): void {
    if (this.#isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Returns a handle to one panel.
   *
   * @param name - The panel name, one of `DEVTOOLS_PANEL_NAMES`.
   * @returns The handle.
   * @throws IgnifxError with code `IGX-1552` when no panel is registered under the name.
   */
  panel(name: string): DevtoolsPanelHandle {
    const resolved = this.#order.find((candidate: DevtoolsPanelName): boolean => candidate === name);
    if (resolved === undefined) {
      throw devtoolsError(DevtoolsErrorCode.unknownPanel, `${name} is not a devtools panel.`, {
        context: { panel: name },
        hint: `The panels this build carries are ${this.#order.join(", ")}.`,
      });
    }
    const visibility = this.#visible;
    const show = (): void => {
      visibility.set(resolved, true);
      this.#overlay?.showPanel(resolved);
    };
    const hide = (): void => {
      visibility.set(resolved, false);
      this.#overlay?.setPanelVisible(resolved, false);
    };
    return {
      name: resolved,
      title: titleOf(resolved),
      get visible(): boolean {
        return visibility.get(resolved) ?? true;
      },
      show,
      hide,
    };
  }

  /**
   * Selects an entity for the Inspector panel.
   *
   * @param entity - The entity, or `null` to clear the selection.
   */
  select(entity: Entity | null): void {
    const next = entity !== null && entity.isDestroyed ? null : entity;
    if (next === this.#selected) {
      return;
    }
    this.#selected = next;
    this.#selectionChanged.emit(next);
  }

  /**
   * Installs the toggle key and, when the settings ask for it, opens the overlay. The extension's
   * `onStart` calls this.
   *
   * @internal
   */
  start(): void {
    const target = this.#resolveTarget();
    if (target !== null) {
      this.#detachToggle = installToggleKey(target.document, this.#settings.toggleKey, (): void => {
        this.toggle();
      });
    }
    if (this.#settings.openOnStart) {
      this.open();
    }
  }

  /**
   * Samples the frame and refreshes the visible panel. The `PreRender` system calls this; while the
   * overlay is closed it returns on the first line.
   *
   * @internal
   */
  sampleFrame(): void {
    if (!this.#isOpen) {
      return;
    }
    this.#index.refresh();
    this.#sampler.update(this.#index.entityCount, this.#index.componentCount);
    this.#overlay?.update(this.#app.time.unscaledDeltaTime);
  }

  /**
   * Closes the overlay and drops the toggle key. The extension's `dispose` calls this.
   *
   * @internal
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.close();
    this.#disposed = true;
    this.#detachToggle?.();
    this.#detachToggle = null;
    this.#sceneReload.dispose();
    this.#opened.clear();
    this.#closed.clear();
    this.#selectionChanged.clear();
  }

  /**
   * Builds the panel objects in tab order.
   *
   * @returns The panels.
   */
  #buildPanels(): DevtoolsPanel[] {
    const out: DevtoolsPanel[] = [];
    for (let index = 0; index < this.#order.length; index += 1) {
      const name = this.#order[index];
      if (name !== undefined) {
        out.push(createPanel(name));
      }
    }
    return out;
  }

  /** Connects everything the overlay needs while it is up. */
  #subscribe(): void {
    const world = this.#app.world;
    const invalidate = (): void => {
      this.#index.invalidate();
    };
    this.#subscriptions.push(
      world.onEntityCreated.connect(invalidate),
      world.onEntityDestroyed.connect(invalidate),
      world.onSceneLoaded.connect(invalidate),
      world.onSceneUnloaded.connect(invalidate),
      this.#app.onError.connect((report: ErrorReport): void => {
        this.#pushError(report);
      }),
    );
    const hot = this.#hotReload.onApplied((report: HotReloadReportView): void => {
      this.#pushHotReload(report);
    });
    if (hot !== null) {
      this.#subscriptions.push(hot);
    }
  }

  /** Drops every subscription `#subscribe` installed. */
  #unsubscribe(): void {
    for (let index = 0; index < this.#subscriptions.length; index += 1) {
      this.#subscriptions[index]?.();
    }
    this.#subscriptions.length = 0;
  }

  /**
   * Retains one error report for the Console panel.
   *
   * @param report - The report.
   */
  #pushError(report: ErrorReport): void {
    const error = report.error;
    this.#errors.push({
      report,
      message: error instanceof Error ? error.message : String(error),
      timeSeconds: this.#app.time.unscaledTime,
    });
    if (this.#errors.length > DEVTOOLS_ERROR_LIMIT) {
      this.#errors.shift();
    }
  }

  /**
   * Retains one hot-reload report for the Console and Stats panels.
   *
   * @param report - The flattened report.
   */
  #pushHotReload(report: HotReloadReportView): void {
    this.#hotReloads.push({ ...report, timeSeconds: this.#app.time.unscaledTime });
    if (this.#hotReloads.length > DEVTOOLS_HOT_RELOAD_LIMIT) {
      this.#hotReloads.shift();
    }
  }

  /**
   * Reports a devtools failure through `app.onError`, so the overlay never throws into the frame.
   *
   * @param error - The failure.
   */
  #report(error: unknown): void {
    this.#app.onError.emit({ error, source: "extension", phase: null, entity: null, component: null });
  }
}

/**
 * The `PreRender` system the first `open()` registers.
 *
 * @internal
 */
export class DevtoolsSampleSystem implements System {
  /** The name diagnostics and error reports identify the system by. */
  readonly name = "devtools-sample";

  readonly #service: DevtoolsService;

  /**
   * Binds the system to its service.
   *
   * @param service - The service whose overlay it samples for.
   */
  constructor(service: DevtoolsService) {
    this.#service = service;
  }

  /** Samples the frame. Returns immediately while the overlay is closed. */
  update(): void {
    this.#service.sampleFrame();
  }
}

/**
 * Builds one panel by name.
 *
 * @param name - The panel name.
 * @returns The panel.
 */
function createPanel(name: DevtoolsPanelName): DevtoolsPanel {
  switch (name) {
    case "stats": {
      return createStatsPanel();
    }
    case "scene": {
      return createSceneTreePanel();
    }
    case "inspector": {
      return createInspectorPanel();
    }
    case "assets": {
      return createAssetsPanel();
    }
    case "input": {
      return createInputPanel();
    }
    case "audio": {
      return createAudioPanel();
    }
    case "physics": {
      return createPhysicsPanel();
    }
    case "console": {
      return createConsolePanel();
    }
    case "timeline": {
      return createTimelinePanel();
    }
    default: {
      return assertNever(name, "devtools panel");
    }
  }
}

/**
 * The tab label of one panel, without building it.
 *
 * @param name - The panel name.
 * @returns The label.
 */
function titleOf(name: DevtoolsPanelName): string {
  switch (name) {
    case "stats": {
      return "Stats";
    }
    case "scene": {
      return "Scene";
    }
    case "inspector": {
      return "Inspector";
    }
    case "assets": {
      return "Assets";
    }
    case "input": {
      return "Input";
    }
    case "audio": {
      return "Audio";
    }
    case "physics": {
      return "Physics";
    }
    case "console": {
      return "Console";
    }
    case "timeline": {
      return "Timeline";
    }
    default: {
      return assertNever(name, "devtools panel");
    }
  }
}
