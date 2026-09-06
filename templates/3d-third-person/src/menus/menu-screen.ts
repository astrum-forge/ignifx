import type { App } from "@ignifx/core";

/**
 * A menu screen: a panel of rows in `app.ui.layer("menu")` that keyboard, gamepad and pointer all
 * drive through the same code path.
 *
 * ## Why this is hand-written DOM and not a `Dialog`
 *
 * `@ignifx/ui` ships `Dialog`, `Toast`, `LoadingScreen` and the two touch widgets, and nothing
 * else: there is no list, no slider, no settings widget and no focus manager. A title screen with
 * a "Continue" entry, a settings screen with volume sliders and a rebinding list is therefore
 * template code, built into `app.ui.layer("menu")` — which is exactly what the UI skill says the
 * overlay is for: *"Use the DOM for menus, HUDs, dialogs and touch controls."*
 *
 * ## Why focus is owned here rather than by the browser
 *
 * Every row is `tabindex="-1"` and the focused row is chosen by this class. The reason is the
 * gamepad: a pad produces no DOM focus events, so pad navigation would need its own path anyway,
 * and two focus authorities in one screen disagree the first time a row is added or removed.
 * Keyboard and pad therefore share one path — the `UI` action map, read by the menu controller
 * script — while the pointer only *moves* the selection and activates it.
 *
 * A native `<input type="range">` is still used for the sliders, because dragging one is worth
 * having and `@ignifx/ui`'s `isEditableElement` deliberately does not count a slider as a text
 * field, so a focused one does not suppress the keyboard.
 *
 * ## Headless
 *
 * With no DOM overlay (`app.ui.layer(name).element === null`, which is what a headless app has)
 * every method here is a no-op and the screen keeps its state, so the same code runs in a test.
 */

/** What a {@link MenuRow} is, which decides how it is drawn and what Left and Right do. */
export type MenuRowKind = "action" | "slider" | "toggle" | "choice" | "binding" | "heading";

/** The range and the accessors of a `"slider"` row. */
export interface MenuSliderRange {
  /** The lowest value the slider may take. */
  readonly min: number;
  /** The highest value the slider may take. */
  readonly max: number;
  /** How far one Left or Right press moves the value. */
  readonly step: number;
  /** Reads the current value. */
  readonly get: () => number;
  /** Writes a new value. Called with a number already clamped to the range. */
  readonly set: (value: number) => void;
  /** Renders the value as the text drawn beside the slider. */
  readonly format: (value: number) => string;
}

/** One row of a menu screen. */
export interface MenuRow {
  /** A stable id. It becomes the row's `data-row` attribute, which is what the tests select on. */
  readonly id: string;
  /** What kind of row this is. */
  readonly kind: MenuRowKind;
  /** The left-hand text. Re-read on every {@link MenuScreen.refresh}, so a locale change re-renders it. */
  readonly label: () => string;
  /** The right-hand text, for `"toggle"`, `"choice"` and `"binding"` rows. */
  readonly value?: () => string;
  /** The range and accessors, for `"slider"` rows. */
  readonly range?: MenuSliderRange;
  /** What Enter, the pad's south button and a click do. */
  readonly activate?: () => void;
  /** What Left and Right do. `direction` is `-1` or `1`. */
  readonly adjust?: (direction: -1 | 1) => void;
  /** Whether the row can be selected. A row that answers `false` is drawn dimmed and skipped. */
  readonly enabled?: () => boolean;
}

/** How {@link MenuScreen} is built. */
export interface MenuScreenOptions {
  /** A stable id; it becomes the panel's `data-menu` attribute. */
  readonly id: string;
  /** The panel's heading. Re-read on every refresh. */
  readonly title: () => string;
  /** A line of prose under the heading, or `null` for none. */
  readonly subtitle?: () => string;
  /** The overlay layer to mount into. Defaults to `"menu"`. */
  readonly layer?: string;
}

/** The elements one row is drawn from. */
interface RowElements {
  /** The row's outermost element. */
  readonly root: HTMLElement;
  /** The left-hand text. */
  readonly label: HTMLElement;
  /** The right-hand text, or `null` for an `"action"` or `"heading"` row. */
  readonly value: HTMLElement | null;
  /** The slider, or `null` for anything but a `"slider"` row. */
  readonly slider: HTMLInputElement | null;
}

/**
 * Clamps a number into a range and snaps it to a step, so a slider cannot drift by floating-point
 * error after a few hundred presses.
 *
 * @param value - The raw value.
 * @param range - The range to clamp into.
 * @returns The clamped, snapped value.
 */
function snap(value: number, range: MenuSliderRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const steps = Math.round((clamped - range.min) / range.step);
  return Math.min(range.max, Math.max(range.min, range.min + steps * range.step));
}

/** A panel of rows in the overlay's `menu` layer. */
export class MenuScreen {
  /** The app, for the overlay host. */
  readonly #app: App;

  /** How the screen was built. */
  readonly #options: MenuScreenOptions;

  /** The panel, or `null` under an app with no DOM overlay. */
  readonly #panel: HTMLDivElement | null;

  /** The heading element, or `null` headless. */
  readonly #heading: HTMLElement | null;

  /** The subtitle element, or `null` headless or when the screen has no subtitle. */
  readonly #subtitle: HTMLElement | null;

  /** The list the rows are appended to, or `null` headless. */
  readonly #list: HTMLElement | null;

  /** The rows, in draw order. */
  #rows: readonly MenuRow[] = [];

  /** One entry per row, in the same order; empty headless. */
  #elements: readonly RowElements[] = [];

  /** Which row is selected. Kept in range by {@link MenuScreen.setRows}. */
  #index = 0;

  /** Whether the panel is on screen. */
  #visible = false;

  /** What Escape and the pad's east button do, or `null` when the screen cannot be backed out of. */
  #onCancel: (() => void) | null = null;

  /**
   * Builds the panel and mounts it hidden.
   *
   * @param app - The running app. `app.ui` is mounted by the time `createApp` resolves.
   * @param options - The id, the heading and the layer.
   */
  constructor(app: App, options: MenuScreenOptions) {
    this.#app = app;
    this.#options = options;
    const layer = app.ui.layer(options.layer ?? "menu").element;
    if (layer === null) {
      this.#panel = null;
      this.#heading = null;
      this.#subtitle = null;
      this.#list = null;
      return;
    }
    const document = layer.ownerDocument;
    const panel = document.createElement("div");
    panel.className = "menu";
    panel.dataset["menu"] = options.id;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.hidden = true;

    const heading = document.createElement("h2");
    heading.className = "menu-title";
    panel.append(heading);
    panel.setAttribute("aria-label", options.title());

    let subtitle: HTMLElement | null = null;
    if (options.subtitle !== undefined) {
      subtitle = document.createElement("p");
      subtitle.className = "menu-subtitle";
      panel.append(subtitle);
    }

    const list = document.createElement("div");
    list.className = "menu-rows";
    list.setAttribute("role", "group");
    panel.append(list);
    layer.append(panel);

    this.#panel = panel;
    this.#heading = heading;
    this.#subtitle = subtitle;
    this.#list = list;
  }

  /**
   * Whether the panel is on screen.
   *
   * @returns `true` between {@link MenuScreen.show} and {@link MenuScreen.hide}.
   */
  get isVisible(): boolean {
    return this.#visible;
  }

  /**
   * The id the screen was built with.
   *
   * @returns The id, which is also the panel's `data-menu` attribute.
   */
  get id(): string {
    return this.#options.id;
  }

  /**
   * The selected row, or `null` when nothing can be selected.
   *
   * @returns The row under the selection.
   */
  get selected(): MenuRow | null {
    return this.#rows[this.#index] ?? null;
  }

  /**
   * The panel element, so a template can restyle it or read it from a test.
   *
   * @returns The element, or `null` under an app with no DOM overlay.
   */
  get element(): HTMLDivElement | null {
    return this.#panel;
  }

  /**
   * Sets what Escape and the pad's east button do.
   *
   * @param handler - What to run, or `null` when the screen cannot be backed out of.
   */
  setCancelHandler(handler: (() => void) | null): void {
    this.#onCancel = handler;
  }

  /**
   * Replaces the rows and rebuilds the panel.
   *
   * @remarks
   * Rebuilding rather than diffing is deliberate: the row list changes when a save appears, when a
   * control scheme changes and when the locale changes, and a menu of at most a dozen rows is not
   * worth a reconciler. The selection is kept on the same row id when that id is still present.
   *
   * @param rows - The rows, in draw order.
   */
  setRows(rows: readonly MenuRow[]): void {
    const previous = this.#rows[this.#index]?.id ?? "";
    this.#rows = rows;
    this.#buildRows();
    const restored = rows.findIndex((row) => row.id === previous);
    this.#index = restored >= 0 ? restored : this.#firstSelectable();
    this.refresh();
  }

  /** Re-reads every label and value, and redraws the selection. */
  refresh(): void {
    if (this.#heading !== null) {
      this.#heading.textContent = this.#options.title();
    }
    if (this.#subtitle !== null && this.#options.subtitle !== undefined) {
      this.#subtitle.textContent = this.#options.subtitle();
    }
    for (let index = 0; index < this.#rows.length; index += 1) {
      const row = this.#rows[index];
      const elements = this.#elements[index];
      if (row === undefined || elements === undefined) {
        continue;
      }
      elements.label.textContent = row.label();
      if (elements.value !== null) {
        elements.value.textContent =
          row.value?.() ?? (row.range === undefined ? "" : row.range.format(row.range.get()));
      }
      if (elements.slider !== null && row.range !== undefined) {
        elements.slider.value = String(row.range.get());
      }
      const enabled = row.enabled?.() ?? true;
      elements.root.toggleAttribute("data-disabled", !enabled);
      elements.root.toggleAttribute("data-focused", enabled && index === this.#index && this.#visible);
    }
  }

  /** Shows the panel and puts the selection on the first row that can take it. */
  show(): void {
    this.#visible = true;
    this.#index = this.#firstSelectable();
    if (this.#panel !== null) {
      this.#panel.hidden = false;
    }
    this.refresh();
  }

  /** Hides the panel. */
  hide(): void {
    this.#visible = false;
    if (this.#panel !== null) {
      this.#panel.hidden = true;
    }
    this.refresh();
  }

  /**
   * Moves the selection, skipping headings and disabled rows, and wrapping at both ends.
   *
   * @param delta - `-1` for up, `1` for down.
   */
  moveSelection(delta: -1 | 1): void {
    const count = this.#rows.length;
    if (count === 0) {
      return;
    }
    for (let step = 1; step <= count; step += 1) {
      const candidate = (this.#index + delta * step + count * step) % count;
      if (this.#isSelectable(candidate)) {
        this.#index = candidate;
        this.refresh();
        this.#scrollIntoView();
        return;
      }
    }
  }

  /**
   * Runs the selected row's Left or Right handler: a slider moves by one step, a toggle flips and a
   * choice advances.
   *
   * @param direction - `-1` for left, `1` for right.
   */
  adjustSelection(direction: -1 | 1): void {
    const row = this.#rows[this.#index];
    if (row === undefined || !(row.enabled?.() ?? true)) {
      return;
    }
    if (row.range !== undefined) {
      row.range.set(snap(row.range.get() + direction * row.range.step, row.range));
      this.refresh();
      return;
    }
    row.adjust?.(direction);
    this.refresh();
  }

  /** Runs the selected row's activate handler. */
  activateSelection(): void {
    const row = this.#rows[this.#index];
    if (row === undefined || !(row.enabled?.() ?? true)) {
      return;
    }
    if (row.activate === undefined) {
      // A slider with no activate handler: Enter nudges it right, which is what a player expects
      // when the only thing on the row is a slider.
      this.adjustSelection(1);
      return;
    }
    row.activate();
  }

  /**
   * Runs the cancel handler, if the screen has one.
   *
   * @returns `true` when a handler ran, so the caller knows the press was consumed.
   */
  cancel(): boolean {
    if (this.#onCancel === null) {
      return false;
    }
    this.#onCancel();
    return true;
  }

  /** Removes the panel from the overlay. */
  dispose(): void {
    this.#panel?.remove();
  }

  /** Rebuilds the row elements from {@link MenuScreen.setRows}'s list. */
  #buildRows(): void {
    const list = this.#list;
    if (list === null) {
      this.#elements = [];
      return;
    }
    const document = list.ownerDocument;
    list.replaceChildren();
    const built: RowElements[] = [];
    for (let index = 0; index < this.#rows.length; index += 1) {
      const row = this.#rows[index];
      if (row === undefined) {
        continue;
      }
      built.push(this.#buildRow(document, list, row, index));
    }
    this.#elements = built;
  }

  /**
   * Builds one row's elements and connects its pointer handlers.
   *
   * @param document - The overlay's document.
   * @param list - The element to append to.
   * @param row - The row being drawn.
   * @param index - The row's position, captured by the pointer handlers.
   * @returns The row's elements.
   */
  #buildRow(document: Document, list: HTMLElement, row: MenuRow, index: number): RowElements {
    const isHeading = row.kind === "heading";
    const root = document.createElement(isHeading ? "div" : "button");
    root.className = isHeading ? "menu-heading" : "menu-row";
    root.dataset["row"] = row.id;
    root.dataset["kind"] = row.kind;
    if (root instanceof HTMLButtonElement) {
      root.type = "button";
      root.tabIndex = -1;
    }

    const label = document.createElement("span");
    label.className = "menu-row-label";
    root.append(label);

    let value: HTMLElement | null = null;
    let slider: HTMLInputElement | null = null;
    if (row.range !== undefined) {
      slider = document.createElement("input");
      slider.type = "range";
      slider.className = "menu-row-slider";
      slider.tabIndex = -1;
      slider.min = String(row.range.min);
      slider.max = String(row.range.max);
      slider.step = String(row.range.step);
      slider.setAttribute("aria-label", row.label());
      root.append(slider);
    }
    if (row.range !== undefined || row.value !== undefined) {
      value = document.createElement("span");
      value.className = "menu-row-value";
      root.append(value);
    }

    if (!isHeading) {
      root.addEventListener("pointerenter", () => {
        if (this.#isSelectable(index)) {
          this.#index = index;
          this.refresh();
        }
      });
      root.addEventListener("click", () => {
        if (!this.#isSelectable(index)) {
          return;
        }
        this.#index = index;
        this.activateSelection();
      });
    }
    const range = row.range;
    if (slider !== null && range !== undefined) {
      const input = slider;
      input.addEventListener("input", () => {
        this.#index = index;
        range.set(snap(Number(input.value), range));
        this.refresh();
      });
      // A drag on the slider is a click on the row; without this the row would activate as soon as
      // the player let go of the knob.
      input.addEventListener("click", (event: Event) => {
        event.stopPropagation();
      });
    }

    list.append(root);
    return { root, label, value, slider };
  }

  /**
   * Whether a row can take the selection.
   *
   * @param index - The row's position.
   * @returns `true` when the row exists, is not a heading, and is enabled.
   */
  #isSelectable(index: number): boolean {
    const row = this.#rows[index];
    if (row === undefined || row.kind === "heading") {
      return false;
    }
    return row.enabled?.() ?? true;
  }

  /**
   * The first row that can take the selection.
   *
   * @returns Its index, or `0` when there is none.
   */
  #firstSelectable(): number {
    for (let index = 0; index < this.#rows.length; index += 1) {
      if (this.#isSelectable(index)) {
        return index;
      }
    }
    return 0;
  }

  /** Brings the selected row into view in a scrolling list. */
  #scrollIntoView(): void {
    const element = this.#elements[this.#index]?.root;
    // `scrollIntoView` exists on every element in a browser and on none in a headless test, where
    // the whole panel is `null` and this line is never reached. `app` is read so that the field is
    // used, which keeps the class honest about what it needs.
    if (element !== undefined && !this.#app.isHeadless) {
      element.scrollIntoView({ block: "nearest" });
    }
  }
}
