import { Signal } from "@ignifx/core";
import { UI_LAYER_Z_STEP } from "../settings.js";
import { UiFocusWatcher } from "./focus.js";
import { UiLayer } from "./layer.js";
import { computeUiLayout, layoutsEqual, pixelMapping } from "./scaling.js";
import { ensureUiStyles, UI_CLASS_NAMES, UI_CSS_VARIABLES } from "./styles.js";
import type { UiDomTarget } from "./dom-target.js";
import type { UiLayerOptions } from "./layer.js";
import type { UiLayout, UiPixelMapping, UiSurfaceMetrics } from "./scaling.js";
import type { UiScalingMode, UiSettings } from "../settings.js";
import type { Logger, SignalLike } from "@ignifx/core";

/**
 * The overlay host behind `app.ui` (`docs/architecture/13-ui.md` §1).
 *
 * ## What it is
 *
 * One absolutely-positioned `<div>` laid over the canvas, `pointer-events: none`, holding one
 * `<div>` per named layer. Everything a game mounts goes inside a layer. The host owns four things
 * and nothing else: the root's geometry (the three scaling modes), the safe-area custom properties,
 * the layer stack, and the focus flag it writes into `@ignifx/input`.
 *
 * ## Headless
 *
 * `07-rendering.md` §6 says a headless app's render objects are inert rather than absent. The host
 * follows the same rule: with no DOM canvas — a headless app, an `OffscreenCanvas`, a canvas that
 * is not in a document — {@link UiHost.root} is `null`, every layer's `element` is `null`, every
 * mutation is a no-op, and one debug line is logged at construction. Nothing throws, so a script
 * that puts a name tag on a monster is the same script in a test and in a browser.
 *
 * ## When the root is built
 *
 * Not in the extension's `register`: `AppImpl.initialize` registers every extension **before** it
 * creates the Lite engine, so `app.renderer.surface` throws `IGX-0107` there
 * (`packages/core/src/app/app.ts` 416-424). The host is therefore constructed inert and
 * {@link UiHost.mount}ed from `UiSystem.onWorldCreated`, which fires later inside the same
 * `createApp` call — the same hook `@ignifx/2d` uses for the same reason. By the time
 * `await createApp(...)` resolves, `app.ui.root` is an element.
 *
 * ## Where the root is attached
 *
 * As the canvas's next sibling, inside the canvas's own parent, rather than on `document.body`. A
 * game that puts its canvas inside a positioned wrapper — every template does — then gets an
 * overlay that moves with the canvas, and two apps in one document get one overlay each
 * (`CONSTITUTION.md` §3.6). When the canvas has no parent element the root is appended to the
 * document body instead, which is what a bare test page looks like.
 */

/** The `ResizeObserver` shape the host uses, duck-typed so a node test can inject a fake. */
interface ResizeObserverLike {
  /** Starts observing an element. */
  observe(target: Element): void;
  /** Stops observing everything. */
  disconnect(): void;
}

/** The constructor of {@link ResizeObserverLike}, as it appears on a window. */
type ResizeObserverConstructor = new (callback: () => void) => ResizeObserverLike;

/**
 * Reads a `ResizeObserver` constructor off a window, if it has one.
 *
 * @param view - The window.
 * @returns The constructor, or `null` on a platform without one.
 */
function resizeObserverOf(view: Window): ResizeObserverConstructor | null {
  const candidate: unknown = Reflect.get(view, "ResizeObserver");
  if (typeof candidate !== "function") {
    return null;
  }
  // The platform either has the constructor the spec
  // defines or it has nothing, and a fake injected by a test declares the same two methods.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return candidate as ResizeObserverConstructor;
}

/**
 * What {@link UiHost} is constructed with.
 *
 * @internal
 */
export interface UiHostOptions {
  /**
   * Finds the DOM to build the overlay in, or answers `null` for a headless app. Called once, from
   * {@link UiHost.mount}, because the render surface does not exist while extensions register.
   */
  readonly resolveTarget: () => UiDomTarget | null;
  /** The resolved `ui` settings section, already merged with the extension's options. */
  readonly settings: UiSettings;
  /** The extension's logger. */
  readonly log: Logger;
  /**
   * Writes `app.input.uiHasFocus`. The extension supplies a setter that duck-types the input
   * service, so `@ignifx/ui` never imports `@ignifx/input` and the peer stays genuinely optional.
   */
  readonly setInputFocus: (value: boolean) => void;
  /**
   * Writes `app.input.uiHasPointer`: `true` while at least one pointer is pressed on the overlay,
   * so pointing-device actions read as released during a drag that began on UI. Same duck-typing
   * as {@link UiHostOptions.setInputFocus}.
   */
  readonly setInputPointer: (value: boolean) => void;
}

/** The metrics a headless host reports, so every conversion degenerates predictably. */
const HEADLESS_METRICS: UiSurfaceMetrics = Object.freeze({
  cssWidth: 1,
  cssHeight: 1,
  deviceWidth: 1,
  deviceHeight: 1,
});

/**
 * The DOM overlay host, reached as `app.ui`.
 *
 * @example
 * ```ts
 * const hud = app.ui.layer("hud");
 * app.ui.scaling = "fit";
 * app.ui.referenceResolution = [640, 360];
 * ```
 *
 * @public
 */
export class UiHost {
  readonly #resolveTarget: () => UiDomTarget | null;

  readonly #log: Logger;

  readonly #setInputFocus: (value: boolean) => void;
  readonly #setInputPointer: (value: boolean) => void;

  #target: UiDomTarget | null = null;

  #root: HTMLDivElement | null = null;

  readonly #layers = new Map<string, UiLayer>();

  readonly #layerOrder: UiLayer[] = [];

  #focus: UiFocusWatcher | null = null;

  readonly #layoutChanged = new Signal<UiLayout>();

  readonly #metrics: { cssWidth: number; cssHeight: number; deviceWidth: number; deviceHeight: number } = {
    cssWidth: 1,
    cssHeight: 1,
    deviceWidth: 1,
    deviceHeight: 1,
  };

  #observer: ResizeObserverLike | null = null;

  #scaling: UiScalingMode;

  #reference: readonly number[];

  #visible: boolean;

  #layout: UiLayout;

  #mapping: UiPixelMapping;

  #pointerCount = 0;

  #mounted = false;

  #disposed = false;

  readonly #onResize = (): void => {
    this.refresh();
  };

  readonly #onPointerDown = (): void => {
    this.#pointerCount += 1;
    if (this.#pointerCount === 1) {
      this.#setInputPointer(true);
    }
  };

  readonly #onPointerUp = (): void => {
    if (this.#pointerCount === 0) {
      return;
    }
    this.#pointerCount -= 1;
    if (this.#pointerCount === 0) {
      this.#setInputPointer(false);
    }
  };

  /**
   * Builds the host and, when there is a DOM, the root and the declared layers.
   *
   * @param options - The DOM target, the settings, the logger, and the focus setter.
   *
   * @internal
   */
  constructor(options: UiHostOptions) {
    const { settings, log } = options;
    this.#resolveTarget = options.resolveTarget;
    this.#log = log;
    this.#setInputFocus = options.setInputFocus;
    this.#setInputPointer = options.setInputPointer;
    this.#scaling = settings.scaling;
    this.#reference = [...settings.referenceResolution];
    this.#visible = settings.visible;
    this.#layout = computeUiLayout(this.#scaling, HEADLESS_METRICS, this.#reference);
    this.#mapping = pixelMapping(this.#layout, HEADLESS_METRICS);
    for (const name of settings.layers) {
      this.#createLayer(name, {});
    }
  }

  /**
   * Builds the root, the layer elements, the focus watcher, and the resize subscriptions. Called
   * once, from `UiSystem.onWorldCreated`; calling it again does nothing.
   *
   * @internal
   */
  mount(): void {
    if (this.#mounted || this.#disposed) {
      return;
    }
    this.#mounted = true;
    const target = this.#resolveTarget();
    if (target === null) {
      this.#log.debug("No DOM canvas: app.ui.root is null and every overlay member is a no-op.");
      return;
    }
    this.#target = target;
    ensureUiStyles(target.document);
    const root = this.#createRoot(target);
    this.#root = root;
    this.#focus = new UiFocusWatcher({ document: target.document, onChanged: this.#setInputFocus });
    this.#focus.attach();
    for (const layer of this.#layerOrder) {
      const element = target.document.createElement("div");
      layer.attach(element);
      root.append(element);
    }
    this.#observe(target);
    this.refresh();
  }

  /**
   * The overlay root: an absolutely positioned `<div>` covering the canvas, `pointer-events: none`.
   *
   * @returns The root, or `null` when the app has no DOM overlay.
   */
  get root(): HTMLDivElement | null {
    return this.#root;
  }

  /**
   * Whether there is a DOM overlay at all. `false` under a headless app, an `OffscreenCanvas`, or a
   * detached canvas — the three cases in which every other member is a no-op.
   *
   * @returns `true` when {@link UiHost.root} is an element.
   */
  get isActive(): boolean {
    return this.#root !== null;
  }

  /**
   * How the overlay's coordinate system relates to the canvas. Writing it recomputes the layout
   * immediately.
   *
   * @returns The current mode.
   */
  get scaling(): UiScalingMode {
    return this.#scaling;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set scaling(value: UiScalingMode) {
    if (this.#scaling === value) {
      return;
    }
    this.#scaling = value;
    this.refresh();
  }

  /**
   * The `[width, height]` the `"fit"` mode scales to. Writing it recomputes the layout.
   *
   * @returns A copy of the current reference resolution.
   */
  get referenceResolution(): readonly number[] {
    return this.#reference;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set referenceResolution(value: readonly number[]) {
    this.#reference = [...value];
    this.refresh();
  }

  /**
   * Whether the whole overlay is shown. Per-layer visibility is `app.ui.layer(name).visible`.
   *
   * @returns `true` while the overlay is shown.
   */
  get visible(): boolean {
    return this.#visible;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set visible(value: boolean) {
    if (this.#visible === value) {
      return;
    }
    this.#visible = value;
    this.#root?.style.setProperty("display", value ? "block" : "none");
  }

  /**
   * The root's current size, scale, and offset, in the units the scaling mode chose.
   *
   * @returns The layout last computed.
   */
  get layout(): UiLayout {
    return this.#layout;
  }

  /**
   * The conversion from render-target pixels — the space `Camera.worldToScreen`, `HudText`, and
   * `app.renderer.captureScreenshot()` work in — to UI units.
   *
   * @returns The mapping last computed.
   */
  get pixelMapping(): UiPixelMapping {
    return this.#mapping;
  }

  /**
   * Every layer, back to front.
   *
   * @returns The layers, ordered by `zIndex`.
   */
  get layers(): readonly UiLayer[] {
    return this.#layerOrder;
  }

  /**
   * Whether a pointer is currently pressed on an interactive element of the overlay.
   *
   * @remarks
   * A click on a UI element never reaches gameplay in the first place: `@ignifx/input` reads
   * `pointerdown` and `wheel` from the **canvas** (`packages/input/src/dom/pointer-source.ts`), and
   * the overlay root is the canvas's sibling rather than its child, so a press that lands on a
   * `pointer-events: auto` element is not on the canvas and is never queued. This flag covers the
   * remaining case: `pointermove` and `pointerup` are read from the **window**, so a drag that
   * started on a slider still moves `<Pointer>/delta`. A camera script that must ignore that reads
   * this flag.
   *
   * @returns `true` while at least one pointer is down on the overlay.
   */
  get pointerOverUi(): boolean {
    return this.#pointerCount > 0;
  }

  /**
   * Whether a text field currently owns the keyboard — the same value the host writes into
   * `app.input.uiHasFocus`.
   *
   * @returns `true` while typing must not fire keyboard actions.
   */
  get keyboardHasFocus(): boolean {
    return this.#focus?.hasFocus ?? false;
  }

  /**
   * Emitted after every recomputation that changed the layout: a canvas resize, a device-pixel-ratio
   * change, or a write to {@link UiHost.scaling} or {@link UiHost.referenceResolution}.
   *
   * @returns The signal.
   */
  get onLayoutChanged(): SignalLike<UiLayout> {
    return this.#layoutChanged;
  }

  /**
   * Returns the named layer, creating it the first time it is asked for.
   *
   * @param name - The layer name.
   * @param options - The stacking order and the initial visibility, used only on creation.
   * @returns The layer.
   *
   * @example
   * ```ts
   * const menu = app.ui.layer("menu", { zIndex: 100 });
   * ```
   */
  layer(name: string, options?: UiLayerOptions): UiLayer {
    const existing = this.#layers.get(name);
    if (existing !== undefined) {
      if (options?.zIndex !== undefined) {
        existing.zIndex = options.zIndex;
        this.#sortLayers();
      }
      return existing;
    }
    return this.#createLayer(name, options ?? {});
  }

  /**
   * Re-measures the canvas and rewrites the root's geometry.
   *
   * @remarks
   * Called by the `ResizeObserver`, by the window's `resize` event — which is what a
   * device-pixel-ratio change fires — and by every write to a scaling property. Games call it after
   * changing the canvas's size by hand. A recomputation that produces the same layout writes
   * nothing and emits nothing.
   */
  refresh(): void {
    const target = this.#target;
    const root = this.#root;
    if (target === null || root === null || this.#disposed) {
      return;
    }
    const rect = target.canvas.getBoundingClientRect();
    this.#metrics.cssWidth = rect.width;
    this.#metrics.cssHeight = rect.height;
    this.#metrics.deviceWidth = target.canvas.width;
    this.#metrics.deviceHeight = target.canvas.height;
    const layout = computeUiLayout(this.#scaling, this.#metrics, this.#reference);
    this.#mapping = pixelMapping(layout, this.#metrics);
    if (layoutsEqual(this.#layout, layout)) {
      return;
    }
    this.#layout = layout;
    const style = root.style;
    style.setProperty("width", `${String(layout.width)}px`);
    style.setProperty("height", `${String(layout.height)}px`);
    style.setProperty(
      "transform",
      `translate(${String(layout.offsetX)}px, ${String(layout.offsetY)}px) scale(${String(layout.scale)})`,
    );
    style.setProperty(UI_CSS_VARIABLES.scale, String(layout.scale));
    this.#layoutChanged.emit(layout);
  }

  /**
   * Removes the overlay from the document and unsubscribes from everything.
   *
   * @internal
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#mounted = true;
    this.#observer?.disconnect();
    this.#observer = null;
    this.#focus?.detach();
    const target = this.#target;
    const root = this.#root;
    if (target !== null && root !== null) {
      target.window.removeEventListener("resize", this.#onResize);
      root.removeEventListener("pointerdown", this.#onPointerDown);
      target.window.removeEventListener("pointerup", this.#onPointerUp);
      target.window.removeEventListener("pointercancel", this.#onPointerUp);
      root.remove();
    }
    this.#layers.clear();
    this.#layerOrder.length = 0;
    this.#layoutChanged.clear();
  }

  /**
   * Builds the root element, sets the safe-area variables, and puts it over the canvas.
   *
   * @param target - The DOM target.
   * @returns The root.
   */
  #createRoot(target: UiDomTarget): HTMLDivElement {
    const root = target.document.createElement("div");
    root.className = UI_CLASS_NAMES.root;
    const style = root.style;
    style.setProperty("display", this.#visible ? "block" : "none");
    // `env()` is resolved by the browser against the actual display, so the four variables are set
    // once and never recomputed; a game reads them with `var(--ignifx-safe-top)`. The `0px`
    // fallback is what a desktop browser and the node fake both report.
    style.setProperty(UI_CSS_VARIABLES.safeTop, "env(safe-area-inset-top, 0px)");
    style.setProperty(UI_CSS_VARIABLES.safeRight, "env(safe-area-inset-right, 0px)");
    style.setProperty(UI_CSS_VARIABLES.safeBottom, "env(safe-area-inset-bottom, 0px)");
    style.setProperty(UI_CSS_VARIABLES.safeLeft, "env(safe-area-inset-left, 0px)");
    const parent = target.canvas.parentElement;
    if (parent === null) {
      target.document.body.append(root);
    } else {
      target.canvas.after(root);
    }
    return root;
  }

  /**
   * Subscribes to the canvas's size and the window's resize event.
   *
   * @param target - The DOM target.
   */
  #observe(target: UiDomTarget): void {
    const Observer = resizeObserverOf(target.window);
    if (Observer !== null) {
      const observer = new Observer(this.#onResize);
      observer.observe(target.canvas);
      this.#observer = observer;
    }
    // The window's `resize` is the one event a device-pixel-ratio change reliably fires; a
    // `ResizeObserver` on the canvas sees the CSS box, which does not change when the ratio does.
    target.window.addEventListener("resize", this.#onResize);
    this.#root?.addEventListener("pointerdown", this.#onPointerDown);
    target.window.addEventListener("pointerup", this.#onPointerUp);
    target.window.addEventListener("pointercancel", this.#onPointerUp);
  }

  /**
   * Creates one layer and inserts it in stacking order.
   *
   * @param name - The layer name.
   * @param options - The stacking order and the initial visibility.
   * @returns The new layer.
   */
  #createLayer(name: string, options: UiLayerOptions): UiLayer {
    const zIndex = options.zIndex ?? (this.#layerOrder.length + 1) * UI_LAYER_Z_STEP;
    const element = this.#target === null ? null : this.#target.document.createElement("div");
    const layer = new UiLayer(name, element, zIndex, options.visible ?? true);
    this.#layers.set(name, layer);
    this.#layerOrder.push(layer);
    if (element !== null) {
      this.#root?.append(element);
    }
    this.#sortLayers();
    return layer;
  }

  /** Re-sorts the layer list by `zIndex`; the DOM order follows the `z-index` property itself. */
  #sortLayers(): void {
    this.#layerOrder.sort((left: UiLayer, right: UiLayer): number => left.zIndex - right.zIndex);
  }
}
