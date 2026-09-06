import { element, setText, toggleClass } from "../dom/elements.js";
import { DEVTOOLS_CLASS_NAMES, ensureDevtoolsStyles } from "../dom/styles.js";
import { probeUi } from "../probes.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "./panel.js";
import type { DevtoolsDomTarget } from "../dom/dom-target.js";
import type { DevtoolsPanelName, DevtoolsSettings } from "../settings.js";
import type { App } from "@ignifx/core";

/**
 * The overlay's DOM half (`docs/architecture/15-devtools-and-diagnostics.md` §4).
 *
 * ## Where it mounts
 *
 * In `app.ui.layer("devtools")` when `@ignifx/ui` is registered and its overlay is live
 * (`13-ui.md` §1), because that is where a game already expects DOM to sit and it inherits the
 * host's scaling and safe-area handling. Otherwise the overlay builds its own root as the canvas's
 * **next sibling**, inside the canvas's own parent, which is what `packages/ui/src/dom/host.ts`
 * does and for the same reason: an overlay that moves with the canvas, and one overlay per app
 * rather than one per document (`CONSTITUTION.md` §3.6).
 *
 * ## Refresh rates
 *
 * Text panels refresh at {@link TEXT_REFRESH_HZ}; a panel that declares `perFrame` refreshes every
 * frame. Only the **visible** panel refreshes at all — a hidden tab costs nothing but the tab
 * button.
 */

/**
 * How often a text panel is rewritten, in hertz — §4's *"throttled"* rate. A panel that declares
 * `perFrame` — the Timeline graph — ignores it.
 *
 * @public
 */
export const TEXT_REFRESH_HZ = 10;

/**
 * The `z-index` the `app.ui` devtools layer is created at: above every layer a game is likely to
 * declare, so the overlay is never behind a HUD.
 *
 * @public
 */
export const DEVTOOLS_LAYER_Z_INDEX = 1_000_000;

/**
 * The name of the `app.ui` layer the overlay mounts into when `@ignifx/ui` is registered. A game
 * that wants to style or hide the overlay reaches it as `app.ui.layer(DEVTOOLS_UI_LAYER)`.
 *
 * @public
 */
export const DEVTOOLS_UI_LAYER = "devtools";

/**
 * What {@link DevtoolsOverlay} is constructed with.
 *
 * @internal
 */
export interface DevtoolsOverlayOptions {
  /** The app being inspected. */
  readonly app: App;
  /** The DOM to build in. */
  readonly target: DevtoolsDomTarget;
  /** What the panels are handed. */
  readonly host: DevtoolsPanelHost;
  /** The panels, already in tab order. */
  readonly panels: readonly DevtoolsPanel[];
  /** The resolved settings. */
  readonly settings: DevtoolsSettings;
}

/** One tab's live state. */
interface TabState {
  /** The panel. */
  readonly panel: DevtoolsPanel;
  /** The tab button. */
  readonly tab: HTMLButtonElement;
  /** The panel's container. */
  readonly body: HTMLElement;
  /** Whether the tab appears at all. */
  visible: boolean;
}

/**
 * The overlay: a docked root, a tab strip, and one container per panel.
 *
 * @internal
 */
export class DevtoolsOverlay {
  readonly #options: DevtoolsOverlayOptions;
  readonly #tabs = new Map<DevtoolsPanelName, TabState>();
  readonly #order: DevtoolsPanelName[] = [];
  #root: HTMLElement | null = null;
  #strip: HTMLElement | null = null;
  #body: HTMLElement | null = null;
  #ownsRoot = false;
  #active: DevtoolsPanelName | null = null;
  #sinceRefresh = 0;
  #disposed = false;

  /**
   * Builds the overlay's DOM.
   *
   * @param options - The app, the DOM target, the panel host, the panels and the settings.
   */
  constructor(options: DevtoolsOverlayOptions) {
    this.#options = options;
    this.#build();
  }

  /**
   * The overlay root.
   *
   * @returns The root element, or `null` once the overlay is disposed.
   */
  get root(): HTMLElement | null {
    return this.#root;
  }

  /**
   * Whether the overlay built its own root rather than mounting into an `app.ui` layer.
   *
   * @returns `true` when the root is the canvas's sibling.
   */
  get ownsRoot(): boolean {
    return this.#ownsRoot;
  }

  /**
   * The panel currently shown.
   *
   * @returns Its name, or `null` when every panel is hidden.
   */
  get active(): DevtoolsPanelName | null {
    return this.#active;
  }

  /**
   * Shows or hides the whole overlay without discarding it, so re-opening is one style write.
   *
   * @param visible - Whether the overlay is shown.
   */
  setVisible(visible: boolean): void {
    this.#root?.style.setProperty("display", visible ? "flex" : "none");
  }

  /**
   * Shows or hides one panel's tab.
   *
   * @param name - The panel name.
   * @param visible - Whether the tab appears.
   */
  setPanelVisible(name: DevtoolsPanelName, visible: boolean): void {
    const state = this.#tabs.get(name);
    if (state === undefined) {
      return;
    }
    state.visible = visible;
    state.tab.style.setProperty("display", visible ? "inline-block" : "none");
    if (!visible && this.#active === name) {
      this.#activate(this.#firstVisible());
    }
    if (visible && this.#active === null) {
      this.#activate(name);
    }
  }

  /**
   * Reports whether a panel's tab is shown.
   *
   * @param name - The panel name.
   * @returns `true` when the tab appears.
   */
  isPanelVisible(name: DevtoolsPanelName): boolean {
    return this.#tabs.get(name)?.visible ?? false;
  }

  /**
   * Brings a panel to the front, showing its tab first when it was hidden.
   *
   * @param name - The panel name.
   */
  showPanel(name: DevtoolsPanelName): void {
    const state = this.#tabs.get(name);
    if (state === undefined) {
      return;
    }
    if (!state.visible) {
      this.setPanelVisible(name, true);
    }
    this.#activate(name);
  }

  /**
   * Refreshes the visible panel: every frame when it declares `perFrame`, otherwise at
   * {@link TEXT_REFRESH_HZ}.
   *
   * @param deltaSeconds - Unscaled seconds since the previous frame.
   * @param force - Refresh regardless of the throttle, which is what opening does.
   */
  update(deltaSeconds: number, force = false): void {
    const active = this.#active;
    if (active === null || this.#disposed) {
      return;
    }
    const state = this.#tabs.get(active);
    if (state === undefined) {
      return;
    }
    this.#sinceRefresh += deltaSeconds;
    const due = force || state.panel.perFrame || this.#sinceRefresh >= 1 / TEXT_REFRESH_HZ;
    if (!due) {
      return;
    }
    this.#sinceRefresh = 0;
    try {
      state.panel.update(this.#options.host);
    } catch (error: unknown) {
      this.#options.host.report(error);
    }
  }

  /** Removes the overlay from the document and disposes every panel. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const state of this.#tabs.values()) {
      state.panel.dispose();
    }
    this.#tabs.clear();
    this.#order.length = 0;
    const root = this.#root;
    if (root !== null) {
      root.remove();
    }
    this.#root = null;
    this.#strip = null;
    this.#body = null;
    this.#active = null;
  }

  /** Builds the root, the tab strip, and every panel's container. */
  #build(): void {
    const { app, target, panels, settings, host } = this.#options;
    ensureDevtoolsStyles(target.document);
    const root = element(target.document, "div", DEVTOOLS_CLASS_NAMES.root);
    root.style.setProperty("opacity", String(settings.opacity));
    this.#dock(root, settings.position);
    const ui = probeUi(app);
    const layer = ui?.layer(DEVTOOLS_UI_LAYER, { zIndex: DEVTOOLS_LAYER_Z_INDEX }).element ?? null;
    if (layer === null) {
      this.#ownsRoot = true;
      const parent = target.canvas.parentElement;
      if (parent === null) {
        target.document.body.append(root);
      } else {
        target.canvas.after(root);
      }
    } else {
      layer.append(root);
    }
    const strip = element(target.document, "div", DEVTOOLS_CLASS_NAMES.tabs);
    const body = element(target.document, "div", DEVTOOLS_CLASS_NAMES.body);
    root.append(strip, body);
    this.#root = root;
    this.#strip = strip;
    this.#body = body;
    for (let index = 0; index < panels.length; index += 1) {
      const panel = panels[index];
      if (panel !== undefined) {
        this.#addPanel(panel, host);
      }
    }
    this.#activate(this.#firstVisible());
  }

  /**
   * Positions the root against one edge of the canvas.
   *
   * @param root - The root element.
   * @param position - The edge to dock to.
   */
  #dock(root: HTMLElement, position: DevtoolsSettings["position"]): void {
    const style = root.style;
    const horizontal = position === "left" || position === "right";
    style.setProperty("top", position === "bottom" ? "auto" : "0");
    style.setProperty("bottom", position === "top" ? "auto" : "0");
    style.setProperty("left", position === "right" ? "auto" : "0");
    style.setProperty("right", position === "left" ? "auto" : "0");
    style.setProperty("width", horizontal ? "380px" : "100%");
    style.setProperty("height", horizontal ? "auto" : "40%");
  }

  /**
   * Adds one panel's tab and container and mounts it.
   *
   * @param panel - The panel.
   * @param host - What the panel is handed.
   */
  #addPanel(panel: DevtoolsPanel, host: DevtoolsPanelHost): void {
    const document = this.#options.host.document;
    const tab = element(document, "button", DEVTOOLS_CLASS_NAMES.tab);
    tab.type = "button";
    setText(tab, panel.title);
    tab.addEventListener("click", (): void => {
      this.#activate(panel.name);
    });
    const body = element(document, "div", DEVTOOLS_CLASS_NAMES.panel);
    body.style.setProperty("display", "none");
    this.#strip?.append(tab);
    this.#body?.append(body);
    const state: TabState = { panel, tab, body, visible: true };
    this.#tabs.set(panel.name, state);
    this.#order.push(panel.name);
    try {
      panel.mount(body, host);
    } catch (error: unknown) {
      host.report(error);
    }
  }

  /**
   * Makes one panel the visible one.
   *
   * @param name - The panel, or `null` when none can be shown.
   */
  #activate(name: DevtoolsPanelName | null): void {
    this.#active = name;
    this.#sinceRefresh = Number.POSITIVE_INFINITY;
    for (const [key, state] of this.#tabs) {
      const on = key === name;
      state.body.style.setProperty("display", on ? "flex" : "none");
      toggleClass(state.tab, DEVTOOLS_CLASS_NAMES.tabActive, on);
    }
  }

  /**
   * Finds the first tab that is still visible.
   *
   * @returns Its name, or `null` when every tab is hidden.
   */
  #firstVisible(): DevtoolsPanelName | null {
    for (let index = 0; index < this.#order.length; index += 1) {
      const name = this.#order[index];
      if (name !== undefined && this.#tabs.get(name)?.visible === true) {
        return name;
      }
    }
    return null;
  }
}
