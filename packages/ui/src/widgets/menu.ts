import { assertNever, Signal } from "@ignifx/core";
import { UI_CLASS_NAMES } from "../dom/styles.js";
import { formatBindingPath, resolveMenuChoices, resolveMenuLabel, snapToStep } from "./menu-row.js";
import type { MenuLabel, MenuRow, MenuSliderRow, MenuText } from "./menu-row.js";
import type { UiHost } from "../dom/host.js";
import type { SignalLike } from "@ignifx/core";

/**
 * `Menu` — the list widget every game menu is made of: a title, an optional subtitle, and a
 * vertical list of {@link MenuRow}s that keyboard, gamepad and pointer all drive through one
 * selection model.
 *
 * It is a DOM helper in the same family as `Dialog`, `Toast` and `LoadingScreen`
 * (`docs/architecture/13-ui.md` §3: *"plain DOM helper classes with no styling opinions beyond a
 * minimal stylesheet; templates ship their own CSS"*), and it follows the same two rules: with no
 * DOM overlay every method is a no-op and {@link Menu.element} is `null`, and every visible piece
 * carries a `UI_CLASS_NAMES` class that a game restyles.
 *
 * ## Why the widget owns the selection instead of the browser
 *
 * Every row is `tabindex="-1"` and the selected row is chosen by this class rather than by
 * `document.activeElement`. The reason is the gamepad: a pad produces no DOM focus events, so pad
 * navigation needs its own path anyway, and two focus authorities in one screen disagree the first
 * time a row is added or removed. The DOM focus that does exist goes to the **list**, once, which
 * is what lets `aria-activedescendant` tell a screen reader where the selection is and what lets
 * the widget read the keyboard at all. The pointer only *moves* the selection and activates it,
 * because a mouse already has a cursor.
 *
 * ## ARIA
 *
 * The list is `role="menu"` and its rows are `role="menuitem"`, with `role="menuitemcheckbox"` plus
 * `aria-checked` for a `"toggle"` row and `role="separator"` for headings and separators. `menu`
 * was chosen over `listbox`/`option` for two reasons: WAI-ARIA's `option` expresses only *"is in
 * the selection"*, so a toggle's on/off state has nowhere to live, while `menuitemcheckbox` is
 * exactly that state; and a menu is what this is — a list of commands the player runs, not a set of
 * values one of which is chosen. `aria-activedescendant` on the list expresses the roving selection
 * without moving focus, which both roles support.
 *
 * The one compromise is the slider row. ARIA has no `menuitemslider`, and neither `menuitem` nor
 * `option` may contain an interactive descendant, so the native `<input type="range">` is marked
 * `aria-hidden="true"` and `tabindex="-1"`: it is a pointer affordance only, it is not in the
 * accessibility tree, and the value reaches a screen reader through the row's own accessible name
 * (its label plus the formatted value), which is refreshed on every change. Left and Right on the
 * row adjust the value with no pointer at all.
 */

/**
 * What `new Menu(app.ui, options)` accepts.
 *
 * @public
 */
export interface MenuOptions {
  /** A stable id; it becomes the panel's `data-menu` attribute. */
  readonly id: string;
  /** The panel's heading. Re-read on every {@link Menu.refresh}. */
  readonly title?: MenuLabel;
  /** A line of prose under the heading. */
  readonly subtitle?: MenuLabel;
  /** The overlay layer to mount into. Defaults to `"menu"`. */
  readonly layer?: string;
  /** The rows to start with. More usually arrive through {@link Menu.setRows}. */
  readonly rows?: readonly MenuRow[];
  /** Whether the menu starts shown. Defaults to `false`. */
  readonly visible?: boolean;
  /** Whether Escape and {@link Menu.cancel} back out of the menu. Defaults to `true`. */
  readonly cancelable?: boolean;
  /**
   * Whether the widget reads the keyboard itself. Defaults to `true`.
   *
   * @remarks
   * Turn it off when the game drives navigation from its own input actions, or every arrow press
   * moves the selection twice. A {@link MenuStack} built with a navigation
   * source does that for you.
   */
  readonly keyboard?: boolean;
  /** Whether the selection wraps at both ends. Defaults to `true`. */
  readonly wrap?: boolean;
  /** The words the rows use for their states. */
  readonly text?: MenuText;
}

/** The elements one row is drawn from. */
interface MenuRowElements {
  /** The row's outermost element. */
  readonly root: HTMLElement;
  /** The left-hand text. */
  readonly label: HTMLElement;
  /** The right-hand text, or `null` for a row that shows none. */
  readonly value: HTMLElement | null;
  /** The range input, or `null` for anything but a `"slider"` row. */
  readonly slider: HTMLInputElement | null;
}

/** The default words a menu uses when {@link MenuOptions.text} does not override them. */
const DEFAULT_TEXT = {
  /** What a `"toggle"` row shows when it is on. */
  on: "On",
  /** What a `"toggle"` row shows when it is off. */
  off: "Off",
  /** What a `"binding"` row shows when nothing is bound. */
  unbound: "—",
  /** What a `"binding"` row shows while it is listening. */
  listening: "Press any key…",
} as const;

/**
 * A panel of selectable rows in an overlay layer.
 *
 * @example
 * ```ts ignore-check
 * const pause = new Menu(app.ui, { id: "pause", title: "Paused" });
 * pause.setRows([
 *   { kind: "action", id: "resume", label: "Resume", activate: () => pause.hide() },
 *   { kind: "slider", id: "music", label: "Music", min: 0, max: 1, step: 0.05,
 *     get: () => music.volume, set: (v) => { music.volume = v; },
 *     format: (v) => `${String(Math.round(v * 100))}%` },
 * ]);
 * pause.show();
 * ```
 *
 * @public
 */
export class Menu {
  /** The id the menu was built with. */
  readonly id: string;

  readonly #options: MenuOptions;

  readonly #panel: HTMLDivElement | null;

  readonly #heading: HTMLElement | null;

  readonly #subtitle: HTMLElement | null;

  readonly #list: HTMLElement | null;

  readonly #cleanups: (() => void)[] = [];

  /** Every range input this menu drew, so the key handler can leave their own keys alone. */
  readonly #sliders = new Set<EventTarget>();

  readonly #selectionChanged = new Signal<MenuRow>();

  readonly #activated = new Signal<MenuRow>();

  readonly #back = new Signal();

  #rows: readonly MenuRow[] = [];

  #elements: readonly MenuRowElements[] = [];

  #index = 0;

  #visible: boolean;

  #cancelable: boolean;

  #keyboard: boolean;

  #disposed = false;

  /**
   * Builds the panel and mounts it, hidden unless `options.visible` says otherwise.
   *
   * @param host - The overlay host, normally `app.ui`.
   * @param options - The id, the heading, the layer, and the starting rows.
   */
  constructor(host: UiHost, options: MenuOptions) {
    this.id = options.id;
    this.#options = options;
    this.#visible = options.visible ?? false;
    this.#cancelable = options.cancelable ?? true;
    this.#keyboard = options.keyboard ?? true;
    const layerElement = host.layer(options.layer ?? "menu").element;
    if (layerElement === null) {
      this.#panel = null;
      this.#heading = null;
      this.#subtitle = null;
      this.#list = null;
      this.setRows(options.rows ?? []);
      return;
    }
    const document = layerElement.ownerDocument;
    const panel = document.createElement("div");
    panel.className = UI_CLASS_NAMES.menu;
    panel.dataset["menu"] = options.id;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.hidden = !this.#visible;

    const heading = document.createElement("h2");
    heading.className = UI_CLASS_NAMES.menuTitle;
    panel.append(heading);

    let subtitle: HTMLElement | null = null;
    if (options.subtitle !== undefined) {
      subtitle = document.createElement("p");
      subtitle.className = UI_CLASS_NAMES.menuSubtitle;
      panel.append(subtitle);
    }

    const list = document.createElement("div");
    list.className = UI_CLASS_NAMES.menuRows;
    list.setAttribute("role", "menu");
    list.tabIndex = -1;
    panel.append(list);
    const onKeyDown = (event: KeyboardEvent): void => {
      this.#onKeyDown(event);
    };
    list.addEventListener("keydown", onKeyDown);
    this.#cleanups.push((): void => {
      list.removeEventListener("keydown", onKeyDown);
    });
    layerElement.append(panel);

    this.#panel = panel;
    this.#heading = heading;
    this.#subtitle = subtitle;
    this.#list = list;
    this.setRows(options.rows ?? []);
  }

  /**
   * The panel element, so a game can restyle it or a test can read it.
   *
   * @returns The element, or `null` under an app with no DOM overlay.
   */
  get element(): HTMLDivElement | null {
    return this.#panel;
  }

  /**
   * Whether the panel is on screen.
   *
   * @returns `true` between {@link Menu.show} and {@link Menu.hide}.
   */
  get isVisible(): boolean {
    return this.#visible;
  }

  /**
   * The rows the menu is drawing.
   *
   * @returns The rows, in draw order.
   */
  get rows(): readonly MenuRow[] {
    return this.#rows;
  }

  /**
   * The selected row.
   *
   * @returns The row under the selection, or `null` when nothing can be selected.
   */
  get selected(): MenuRow | null {
    return this.#rows[this.#index] ?? null;
  }

  /**
   * Where the selection sits.
   *
   * @returns The index into {@link Menu.rows}.
   */
  get selectedIndex(): number {
    return this.#index;
  }

  /**
   * Whether Escape and {@link Menu.cancel} back out of this menu. A title screen sets it `false`.
   *
   * @returns `true` when the menu can be dismissed.
   */
  get cancelable(): boolean {
    return this.#cancelable;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set cancelable(value: boolean) {
    this.#cancelable = value;
  }

  /**
   * Whether the widget reads the keyboard itself.
   *
   * @returns `true` while its own `keydown` handler acts.
   */
  get keyboardEnabled(): boolean {
    return this.#keyboard;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set keyboardEnabled(value: boolean) {
    this.#keyboard = value;
  }

  /**
   * Emitted with the newly selected row whenever the selection moves, from any device. A game
   * connects a click sound to it.
   *
   * @returns The signal.
   */
  get onSelectionChanged(): SignalLike<MenuRow> {
    return this.#selectionChanged;
  }

  /**
   * Emitted with the row that was activated, after its own handler ran.
   *
   * @returns The signal.
   */
  get onActivated(): SignalLike<MenuRow> {
    return this.#activated;
  }

  /**
   * Emitted by {@link Menu.cancel} — Escape, the pad's east button, or a call — when the menu is
   * {@link Menu.cancelable}. A {@link MenuStack} connects `pop` to it.
   *
   * @returns The signal.
   */
  get onBack(): SignalLike {
    return this.#back;
  }

  /**
   * Replaces the rows and rebuilds the panel.
   *
   * @remarks
   * Rebuilding rather than diffing is deliberate: the row list changes when a save appears, when a
   * control scheme changes and when the locale changes, and a menu of at most a few dozen rows is
   * not worth a reconciler. The selection stays on the same row id when that id is still present.
   *
   * @param rows - The rows, in draw order.
   */
  setRows(rows: readonly MenuRow[]): void {
    const previous = this.#rows[this.#index]?.id ?? "";
    this.#rows = rows;
    this.#buildRows();
    const restored = rows.findIndex((row: MenuRow): boolean => row.id === previous);
    this.#index = restored >= 0 ? restored : this.#firstSelectable();
    this.refresh();
  }

  /** Re-reads every label and value and redraws the selection. */
  refresh(): void {
    const title = resolveMenuLabel(this.#options.title, "");
    if (this.#heading !== null) {
      this.#heading.textContent = title;
    }
    this.#panel?.setAttribute("aria-label", title);
    this.#list?.setAttribute("aria-label", title);
    if (this.#subtitle !== null) {
      this.#subtitle.textContent = resolveMenuLabel(this.#options.subtitle, "");
    }
    for (let index = 0; index < this.#rows.length; index += 1) {
      const row = this.#rows[index];
      const elements = this.#elements[index];
      if (row !== undefined && elements !== undefined) {
        this.#refreshRow(row, elements, index);
      }
    }
    this.#applyActiveDescendant();
  }

  /** Shows the panel, puts the selection on the first row that can take it, and focuses the list. */
  show(): void {
    if (this.#disposed) {
      return;
    }
    this.#visible = true;
    this.#index = this.#firstSelectable();
    if (this.#panel !== null) {
      this.#panel.hidden = false;
    }
    this.refresh();
    this.#list?.focus({ preventScroll: true });
  }

  /** Hides the panel. */
  hide(): void {
    if (this.#disposed) {
      return;
    }
    this.#visible = false;
    if (this.#panel !== null) {
      this.#panel.hidden = true;
    }
    this.refresh();
  }

  /**
   * Moves the selection, skipping headings, separators and disabled rows.
   *
   * @param delta - `-1` for up, `1` for down.
   */
  moveSelection(delta: -1 | 1): void {
    const count = this.#rows.length;
    if (count === 0) {
      return;
    }
    const wrap = this.#options.wrap ?? true;
    for (let step = 1; step <= count; step += 1) {
      const raw = this.#index + delta * step;
      if (!wrap && (raw < 0 || raw >= count)) {
        return;
      }
      const candidate = (raw + count * step) % count;
      if (this.#isSelectable(candidate)) {
        this.#select(candidate);
        return;
      }
    }
  }

  /**
   * Puts the selection on a row by id.
   *
   * @param id - The row's {@link MenuRowBase.id}.
   * @returns `true` when a selectable row with that id was found.
   */
  select(id: string): boolean {
    const index = this.#rows.findIndex((row: MenuRow): boolean => row.id === id);
    if (index < 0 || !this.#isSelectable(index)) {
      return false;
    }
    this.#select(index);
    return true;
  }

  /**
   * Runs the selected row's Left or Right behaviour: a slider moves by one step, a toggle flips,
   * and a choice advances.
   *
   * @param direction - `-1` for left, `1` for right.
   */
  adjustSelection(direction: -1 | 1): void {
    const row = this.#rows[this.#index];
    if (row === undefined || !this.#isSelectable(this.#index)) {
      return;
    }
    switch (row.kind) {
      case "slider": {
        row.set(snapToStep(row.get() + direction * row.step, row.min, row.max, row.step));
        break;
      }
      case "toggle": {
        row.set(!row.get());
        break;
      }
      case "choice": {
        const values = resolveMenuChoices(row.values);
        const here = values.indexOf(row.get());
        const next = values[(Math.max(here, 0) + direction + values.length) % values.length];
        if (next !== undefined && next !== row.get()) {
          row.set(next);
        }
        break;
      }
      case "action":
      case "binding":
      case "heading":
      case "separator": {
        break;
      }
    }
    this.refresh();
  }

  /** Runs the selected row's activate behaviour. */
  activateSelection(): void {
    const row = this.#rows[this.#index];
    if (row === undefined || !this.#isSelectable(this.#index)) {
      return;
    }
    switch (row.kind) {
      case "action": {
        row.activate?.();
        break;
      }
      case "binding": {
        row.rebind?.();
        break;
      }
      // A slider, a toggle and a choice all move on by one: Enter on a row whose only content is a
      // value is what a player expects to change that value.
      case "choice":
      case "slider":
      case "toggle": {
        this.adjustSelection(1);
        break;
      }
      // Unreachable: `#isSelectable` already turned these away.
      case "heading":
      case "separator": {
        break;
      }
    }
    this.refresh();
    this.#activated.emit(row);
  }

  /**
   * Backs out of the menu, if it is {@link Menu.cancelable}.
   *
   * @returns `true` when {@link Menu.onBack} was emitted, so the caller knows the press was used.
   */
  cancel(): boolean {
    if (!this.#cancelable || this.#disposed) {
      return false;
    }
    this.#back.emit();
    return true;
  }

  /** Removes the panel from the overlay and unsubscribes everything. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const cleanup of this.#cleanups) {
      cleanup();
    }
    this.#cleanups.length = 0;
    this.#sliders.clear();
    this.#panel?.remove();
    this.#selectionChanged.clear();
    this.#activated.clear();
    this.#back.clear();
  }

  /**
   * Moves the selection and tells everyone.
   *
   * @param index - The row to select.
   */
  #select(index: number): void {
    if (index === this.#index) {
      return;
    }
    this.#index = index;
    this.refresh();
    this.#scrollIntoView();
    const row = this.#rows[index];
    if (row !== undefined) {
      this.#selectionChanged.emit(row);
    }
  }

  /**
   * Handles the keys the widget owns while the list has DOM focus.
   *
   * @param event - The key event.
   */
  #onKeyDown(event: KeyboardEvent): void {
    // A pointer press focuses a range input in most browsers even at `tabindex="-1"`; while it has
    // focus its own arrow keys are the right behaviour, and the `input` event carries the change
    // back here.
    if (!this.#keyboard || (event.target !== null && this.#sliders.has(event.target))) {
      return;
    }
    switch (event.key) {
      case "ArrowUp": {
        this.moveSelection(-1);
        break;
      }
      case "ArrowDown": {
        this.moveSelection(1);
        break;
      }
      case "ArrowLeft": {
        this.adjustSelection(-1);
        break;
      }
      case "ArrowRight": {
        this.adjustSelection(1);
        break;
      }
      case " ":
      case "Enter": {
        this.activateSelection();
        break;
      }
      case "Escape": {
        if (!this.cancel()) {
          return;
        }
        break;
      }
      default: {
        return;
      }
    }
    // Only for a key the menu acted on: an arrow that scrolled the page, or a space that scrolled
    // it, would otherwise move the panel out from under the player.
    event.preventDefault();
  }

  /** Rebuilds every row element from {@link Menu.setRows}'s list. */
  #buildRows(): void {
    const list = this.#list;
    if (list === null) {
      this.#elements = [];
      return;
    }
    const document = list.ownerDocument;
    list.replaceChildren();
    this.#sliders.clear();
    const built: MenuRowElements[] = [];
    for (let index = 0; index < this.#rows.length; index += 1) {
      const row = this.#rows[index];
      if (row !== undefined) {
        built.push(this.#buildRow(document, list, row, index));
      }
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
  #buildRow(document: Document, list: HTMLElement, row: MenuRow, index: number): MenuRowElements {
    const selectable = row.kind !== "heading" && row.kind !== "separator";
    const root = document.createElement(selectable ? "button" : "div");
    root.className = selectable ? UI_CLASS_NAMES.menuRow : rowClassName(row.kind);
    root.id = `${UI_CLASS_NAMES.menu}-${this.id}-${row.id}`;
    root.dataset["row"] = row.id;
    root.dataset["kind"] = row.kind;
    root.setAttribute("role", rowRole(row.kind));
    root.tabIndex = -1;
    if (selectable) {
      root.setAttribute("type", "button");
    }

    const label = document.createElement("span");
    label.className = UI_CLASS_NAMES.menuRowLabel;
    root.append(label);

    let slider: HTMLInputElement | null = null;
    if (row.kind === "slider") {
      slider = document.createElement("input");
      slider.type = "range";
      slider.className = UI_CLASS_NAMES.menuRowSlider;
      slider.tabIndex = -1;
      // Not in the accessibility tree: the row is a `menuitem`, which may not own an interactive
      // element, and the value is announced through the row's own name. See this file's header.
      slider.setAttribute("aria-hidden", "true");
      slider.min = String(row.min);
      slider.max = String(row.max);
      slider.step = String(row.step);
      root.append(slider);
      this.#sliders.add(slider);
    }

    let value: HTMLElement | null = null;
    if (row.kind !== "heading" && row.kind !== "separator") {
      value = document.createElement("span");
      value.className = UI_CLASS_NAMES.menuRowValue;
      root.append(value);
    }

    if (selectable) {
      this.#connectRowPointer(root, index);
    }
    if (slider !== null && row.kind === "slider") {
      this.#connectSlider(slider, row, index);
    }
    list.append(root);
    return { root, label, value, slider };
  }

  /**
   * Wires hover and click on a selectable row.
   *
   * @param root - The row element.
   * @param index - The row's position.
   */
  #connectRowPointer(root: HTMLElement, index: number): void {
    const onEnter = (): void => {
      if (this.#isSelectable(index)) {
        this.#select(index);
      }
    };
    const onClick = (): void => {
      if (!this.#isSelectable(index)) {
        return;
      }
      this.#select(index);
      this.activateSelection();
    };
    root.addEventListener("pointerenter", onEnter);
    root.addEventListener("click", onClick);
    this.#cleanups.push((): void => {
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("click", onClick);
    });
  }

  /**
   * Wires a range input to its row.
   *
   * @param slider - The input element.
   * @param row - The row it belongs to.
   * @param index - The row's position.
   */
  #connectSlider(slider: HTMLInputElement, row: MenuSliderRow, index: number): void {
    const onInput = (): void => {
      this.#index = index;
      row.set(snapToStep(Number(slider.value), row.min, row.max, row.step));
      this.refresh();
    };
    slider.addEventListener("input", onInput);
    // A drag on the knob is a click on the row; without `stopSliderClick` the row would activate —
    // and a menu built out of one slider would advance a step — as soon as the player let go.
    slider.addEventListener("click", stopSliderClick);
    this.#cleanups.push((): void => {
      slider.removeEventListener("input", onInput);
      slider.removeEventListener("click", stopSliderClick);
    });
  }

  /**
   * Re-reads one row and writes it onto its elements.
   *
   * @param row - The row.
   * @param elements - Its elements.
   * @param index - Its position, compared against the selection.
   */
  #refreshRow(row: MenuRow, elements: MenuRowElements, index: number): void {
    elements.label.textContent = row.kind === "separator" ? "" : resolveMenuLabel(row.label, "");
    if (elements.value !== null) {
      elements.value.textContent = this.#rowValueText(row);
    }
    if (elements.slider !== null && row.kind === "slider") {
      elements.slider.value = String(row.get());
    }
    if (row.kind === "toggle") {
      elements.root.setAttribute("aria-checked", row.get() ? "true" : "false");
    }
    const enabled = this.#isSelectable(index);
    const selectable = row.kind !== "heading" && row.kind !== "separator";
    elements.root.toggleAttribute("data-disabled", selectable && !enabled);
    if (selectable) {
      elements.root.setAttribute("aria-disabled", enabled ? "false" : "true");
    }
    elements.root.toggleAttribute("data-focused", enabled && index === this.#index && this.#visible);
  }

  /**
   * The right-hand text of one row.
   *
   * @param row - The row.
   * @returns The text, or `""` when the row shows none.
   */
  #rowValueText(row: MenuRow): string {
    const text = this.#options.text ?? {};
    switch (row.kind) {
      case "action": {
        return resolveMenuLabel(row.value, "");
      }
      case "toggle": {
        const on = row.get();
        return row.format?.(on) ?? resolveMenuLabel(on ? text.on : text.off, on ? DEFAULT_TEXT.on : DEFAULT_TEXT.off);
      }
      case "slider": {
        const value = row.get();
        return row.format?.(value) ?? String(value);
      }
      case "choice": {
        const value = row.get();
        return row.format?.(value) ?? value;
      }
      case "binding": {
        if (row.listening?.() === true) {
          return resolveMenuLabel(text.listening, DEFAULT_TEXT.listening);
        }
        return formatBindingPath(row.path(), resolveMenuLabel(text.unbound, DEFAULT_TEXT.unbound));
      }
      case "heading":
      case "separator": {
        return "";
      }
      default: {
        return assertNever(row, "menu row kind");
      }
    }
  }

  /** Points `aria-activedescendant` at the selected row, or clears it. */
  #applyActiveDescendant(): void {
    const list = this.#list;
    if (list === null) {
      return;
    }
    const active = this.#isSelectable(this.#index) ? this.#elements[this.#index]?.root : undefined;
    if (active === undefined) {
      list.removeAttribute("aria-activedescendant");
      return;
    }
    list.setAttribute("aria-activedescendant", active.id);
  }

  /**
   * Whether a row can take the selection.
   *
   * @param index - The row's position.
   * @returns `true` when the row exists, is selectable, and is enabled.
   */
  #isSelectable(index: number): boolean {
    const row = this.#rows[index];
    if (row === undefined || row.kind === "heading" || row.kind === "separator") {
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
    this.#elements[this.#index]?.root.scrollIntoView({ block: "nearest" });
  }
}

/**
 * Keeps the click that ends a slider drag from reaching the row and activating it.
 *
 * @param event - The click.
 */
function stopSliderClick(event: Event): void {
  event.stopPropagation();
}

/**
 * The ARIA role one row kind is drawn with.
 *
 * @param kind - The row kind.
 * @returns The role attribute value.
 */
function rowRole(kind: MenuRow["kind"]): string {
  switch (kind) {
    case "toggle": {
      return "menuitemcheckbox";
    }
    case "heading":
    case "separator": {
      return "separator";
    }
    case "action":
    case "binding":
    case "choice":
    case "slider": {
      return "menuitem";
    }
    default: {
      return assertNever(kind, "menu row kind");
    }
  }
}

/**
 * The class name a non-selectable row kind is drawn with.
 *
 * @param kind - The row kind.
 * @returns The class name.
 */
function rowClassName(kind: MenuRow["kind"]): string {
  return kind === "heading" ? UI_CLASS_NAMES.menuHeading : UI_CLASS_NAMES.menuSeparator;
}
