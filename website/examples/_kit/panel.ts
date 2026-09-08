/**
 * The parameter panel every example shows in its own frame
 * (`website/plan/04-examples-platform.md` §4, `08-execution.md` §4.3).
 *
 * The panel is **inside** the example, not on the viewer page around it, so an example opened
 * standalone is complete and the viewer needs no per-example code. It is built on `@ignifx/ui`'s
 * overlay — `app.ui.layer("panel")` — which is what makes it scale with the canvas, sit inside the
 * safe area on a phone, and route focus through `app.input.uiHasFocus`/`uiHasPointer` so dragging
 * a slider never also orbits the camera.
 *
 * ## Why native form controls
 *
 * Every control is a real `<input>`, `<select>` or `<button>` — inside a `<label>` where a label
 * cannot re-dispatch a click onto the control — and every group is a `<details>`/`<summary>`. That
 * is what buys keyboard operation, screen-reader labelling and
 * touch semantics without a line of code: Tab reaches each control, arrows move a slider, Space
 * toggles a checkbox and opens a group, and the browser's own hit-slop applies. `kit.css` gives
 * them the site's tokens and a 44 px minimum height; nothing here re-implements a widget.
 *
 * `@ignifx/ui`'s `Menu` is the other option and is the wrong one here: it is a vertical
 * single-selection list for title and pause screens, it has no colour or readout row, and a
 * parameter panel is not a menu — a visitor changes several values in any order and reads figures
 * while the game runs.
 */

import { assertNever, UI_CLASS_NAMES } from "ignifx";
import type { App } from "ignifx";

/** A `[min, max]` range with a step, shared by the slider control. */
export interface PanelSliderControl {
  /** The discriminant. */
  readonly kind: "slider";
  /** The visible label. */
  readonly label: string;
  /** The lowest value. */
  readonly min: number;
  /** The highest value. */
  readonly max: number;
  /** The increment; arrows and drags move by this much. */
  readonly step: number;
  /** The value the panel opens at. */
  readonly value: number;
  /**
   * How the value is written next to the label.
   *
   * @param value - The current value.
   * @returns The text to show; the raw number when omitted.
   */
  readonly format?: (value: number) => string;
  /**
   * Called on every change, including while dragging.
   *
   * @param value - The new value.
   */
  readonly change: (value: number) => void;
}

/** An on/off control. */
export interface PanelToggleControl {
  /** The discriminant. */
  readonly kind: "toggle";
  /** The visible label. */
  readonly label: string;
  /** The state the panel opens in. */
  readonly value: boolean;
  /**
   * Called when the state changes.
   *
   * @param value - The new state.
   */
  readonly change: (value: boolean) => void;
}

/** A one-of-several control. */
export interface PanelSelectControl {
  /** The discriminant. */
  readonly kind: "select";
  /** The visible label. */
  readonly label: string;
  /** The choices, in display order; the value handed to `change` is the string itself. */
  readonly options: readonly string[];
  /** The choice the panel opens on; must be one of `options`. */
  readonly value: string;
  /**
   * Called when the choice changes.
   *
   * @param value - The new choice.
   */
  readonly change: (value: string) => void;
}

/** A do-it-now control. */
export interface PanelButtonControl {
  /** The discriminant. */
  readonly kind: "button";
  /** The visible label, which is also the button's accessible name. */
  readonly label: string;
  /** Called on click, on Enter and on Space. */
  readonly press: () => void;
}

/** A colour control, in `#rrggbb`. */
export interface PanelColorControl {
  /** The discriminant. */
  readonly kind: "color";
  /** The visible label. */
  readonly label: string;
  /** The colour the panel opens on, as `#rrggbb`. */
  readonly value: string;
  /**
   * Called when the colour changes.
   *
   * @param value - The new colour, as `#rrggbb`.
   */
  readonly change: (value: string) => void;
}

/** A live figure the panel re-reads for you. */
export interface PanelReadoutControl {
  /** The discriminant. */
  readonly kind: "readout";
  /** The visible label. */
  readonly label: string;
  /**
   * Read on every refresh, four times a second.
   *
   * @returns The text to show.
   */
  readonly read: () => string;
}

/** One row of the panel. */
export type PanelControl =
  | PanelButtonControl
  | PanelColorControl
  | PanelReadoutControl
  | PanelSelectControl
  | PanelSliderControl
  | PanelToggleControl;

/** A titled, collapsible group of controls. */
export interface PanelGroup {
  /** The group's heading. */
  readonly label: string;
  /** Whether the group starts closed. Groups start open unless this is `true`. */
  readonly collapsed?: boolean;
  /** The rows, in display order. */
  readonly controls: readonly PanelControl[];
}

/** What {@link createPanel} takes. */
export interface PanelOptions {
  /** The panel's own heading, usually the example's title. */
  readonly title: string;
  /** The groups, in display order. */
  readonly groups: readonly PanelGroup[];
  /**
   * Whether the panel mounts collapsed to its title bar.
   *
   * @remarks
   * Omitted, it follows the frame's own size: collapsed below {@link NARROW_WIDTH} wide or
   * {@link SHORT_HEIGHT} tall, expanded otherwise. `boot.ts` passes what `?panel=collapsed` or
   * `?panel=open` asked for, and `?nopanel=1` is a different thing — it mounts no panel at all.
   */
  readonly collapsed?: boolean;
}

/** A mounted panel. */
export interface Panel {
  /** The panel's outermost element, for a test or a caller that wants to place something else. */
  readonly element: HTMLElement;
  /** Whether the panel is showing its controls. */
  readonly isExpanded: boolean;
  /**
   * Expands or collapses the panel.
   *
   * @param expanded - `true` to show the controls, `false` to show the title bar alone.
   */
  setExpanded(expanded: boolean): void;
  /** Re-reads every readout row. Called four times a second while the example runs. */
  refresh(): void;
  /** Removes the panel and stops its refresh timer. */
  dispose(): void;
}

/**
 * Whether a frame this size should open with the panel collapsed.
 *
 * @returns `true` when the frame is narrower than {@link NARROW_WIDTH} or shorter than
 * {@link SHORT_HEIGHT}.
 */
export function prefersCollapsedPanel(): boolean {
  return window.innerWidth < NARROW_WIDTH || window.innerHeight < SHORT_HEIGHT;
}

/** The bounds a {@link slider} needs, as one argument so the call site stays on one line. */
export interface SliderRange {
  /** The lowest value. */
  readonly min: number;
  /** The highest value. */
  readonly max: number;
  /** The increment; arrows and drags move by this much. */
  readonly step: number;
  /**
   * How the value is written next to the label; the raw number when omitted.
   *
   * @param value - The current value.
   * @returns The text to show.
   */
  readonly format?: (value: number) => string;
}

/** What a control reads and writes: the value it opens on, and where a change goes. */
export interface PanelBinding<T> {
  /** The value the panel opens on. */
  readonly value: T;
  /**
   * Called on every change, including while dragging a slider.
   *
   * @param value - The new value.
   */
  readonly change: (value: T) => void;
}

/**
 * Binds a control to one field of a live object.
 *
 * @remarks
 * This is what makes a panel row a line rather than a paragraph, and it is the shape a panel row
 * actually has: a component's serialized fields are plain properties, and its `bloom`, `shadows`
 * and `imageProcessing` records are plain objects, so reading and writing one is all a slider does.
 * A control that needs a conversion — a colour, an enum behind a display label — passes a literal
 * `{ value, change }` instead.
 *
 * @param target - The object holding the field, read once for `value` and written on every change.
 * @param key - The field's name.
 * @returns The binding.
 *
 * @example
 * ```ts
 * slider("Exposure", { min: 0.2, max: 3, step: 0.05 }, bind(sky.imageProcessing, "exposure"));
 * toggle("Shadows", bind(light.shadows, "enabled"));
 * ```
 */
export function bind<T extends object, K extends keyof T>(target: T, key: K): PanelBinding<T[K]> {
  return {
    value: target[key],
    change: (value: T[K]): void => {
      target[key] = value;
    },
  };
}

/**
 * A slider row.
 *
 * @remarks
 * The six factories below exist for one reason: an example's panel is the part of it a visitor is
 * most likely to read, and a declaration is easier to read than an object literal with a `kind`
 * discriminant in it. The literal forms stay exported, so an example that needs something the
 * factories do not take can still write one.
 *
 * @param label - The visible label.
 * @param range - The bounds, the step and an optional formatter.
 * @param binding - What the slider reads and writes.
 * @returns The control.
 *
 * @example
 * ```ts
 * slider("Spin", { min: 0, max: 240, step: 5 }, bind(spinner, "speed"));
 * ```
 */
export function slider(label: string, range: SliderRange, binding: PanelBinding<number>): PanelSliderControl {
  return { kind: "slider", label, ...range, ...binding };
}

/**
 * An on/off row.
 *
 * @param label - The visible label.
 * @param binding - What the toggle reads and writes.
 * @returns The control.
 */
export function toggle(label: string, binding: PanelBinding<boolean>): PanelToggleControl {
  return { kind: "toggle", label, ...binding };
}

/**
 * A one-of-several row.
 *
 * @param label - The visible label.
 * @param options - The choices, in display order.
 * @param binding - What the select reads and writes; the value is always one of `options`.
 * @returns The control.
 */
export function select(label: string, options: readonly string[], binding: PanelBinding<string>): PanelSelectControl {
  return { kind: "select", label, options, ...binding };
}

/**
 * A do-it-now row.
 *
 * @param label - The visible label, which is also the button's accessible name.
 * @param press - Called on click, on Enter and on Space.
 * @returns The control.
 */
export function button(label: string, press: () => void): PanelButtonControl {
  return { kind: "button", label, press };
}

/**
 * A colour row.
 *
 * @param label - The visible label.
 * @param binding - What the swatch reads and writes, as `#rrggbb`.
 * @returns The control.
 */
export function color(label: string, binding: PanelBinding<string>): PanelColorControl {
  return { kind: "color", label, ...binding };
}

/**
 * A live figure the panel re-reads four times a second.
 *
 * @param label - The visible label.
 * @param read - Read on every refresh.
 * @returns The control.
 */
export function readout(label: string, read: () => string): PanelReadoutControl {
  return { kind: "readout", label, read };
}

/** The `@ignifx/ui` layer the panel mounts into, above the HUD and below a dialog. */
const PANEL_LAYER = "panel";

/** The layer's `z-index`, chosen to sit above `hud`/`menu`/`overlay`'s 10/20/30. */
const PANEL_Z_INDEX = 40;

/** How often readout rows are re-read, in milliseconds. Four times a second reads as live. */
const REFRESH_INTERVAL_MS = 250;

/**
 * The frame width below which the panel starts collapsed, in CSS pixels.
 *
 * @remarks
 * The viewer's frame is the page's width on a phone: 390 px across and 219 px tall at 16:9, where an
 * expanded 248 px panel covers most of the canvas. Below this the panel mounts as its title bar and
 * an expand button, so the visitor sees the game first and asks for the controls.
 */
const NARROW_WIDTH = 720;

/**
 * The frame height below which the panel starts collapsed, in CSS pixels.
 *
 * @remarks
 * Height matters on its own: a 16:9 frame on a laptop is wide and short, and a full-height panel in
 * a 400 px-tall frame is the same problem as a full-width one in a 390 px-wide frame.
 */
const SHORT_HEIGHT = 480;

/**
 * Formats a slider's value.
 *
 * @param control - The slider.
 * @param value - The value to write.
 * @returns The text for the value cell.
 */
function sliderText(control: PanelSliderControl, value: number): string {
  return control.format?.(value) ?? String(value);
}

/**
 * Builds the label and value cells every row starts with.
 *
 * @param label - The row's label text.
 * @returns The row element and its value cell.
 */
function buildRow(label: string): { row: HTMLElement; value: HTMLElement } {
  const row = document.createElement("div");
  row.className = "igx-row";
  const head = document.createElement("div");
  head.className = "igx-row-head";
  const labelText = document.createElement("span");
  labelText.className = "igx-row-label";
  labelText.textContent = label;
  const value = document.createElement("span");
  value.className = "igx-row-value";
  head.append(labelText, value);
  row.append(head);
  return { row, value };
}

/**
 * Builds one slider row.
 *
 * @param control - The slider.
 * @returns The row element.
 */
function buildSlider(control: PanelSliderControl): HTMLElement {
  const { row, value } = buildRow(control.label);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(control.min);
  input.max = String(control.max);
  input.step = String(control.step);
  input.value = String(control.value);
  value.textContent = sliderText(control, control.value);
  // `aria-label` rather than wrapping the row in a `<label>`: a label element that contains both
  // the text and the range input re-dispatches a click on the text to the input, which nudges the
  // value when a visitor only meant to read it.
  input.setAttribute("aria-label", control.label);
  input.addEventListener("input", (): void => {
    const next = Number(input.value);
    value.textContent = sliderText(control, next);
    control.change(next);
  });
  row.append(input);
  return row;
}

/**
 * Builds one toggle row.
 *
 * @param control - The toggle.
 * @returns The row element.
 */
function buildToggle(control: PanelToggleControl): HTMLElement {
  const row = document.createElement("label");
  row.className = "igx-row igx-row-inline";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = control.value;
  const text = document.createElement("span");
  text.className = "igx-row-label";
  text.textContent = control.label;
  input.addEventListener("change", (): void => {
    control.change(input.checked);
  });
  row.append(input, text);
  return row;
}

/**
 * Builds one select row.
 *
 * @param control - The select.
 * @returns The row element.
 */
function buildSelect(control: PanelSelectControl): HTMLElement {
  const row = document.createElement("label");
  row.className = "igx-row";
  const head = document.createElement("span");
  head.className = "igx-row-label";
  head.textContent = control.label;
  const list = document.createElement("select");
  for (const option of control.options) {
    const element = document.createElement("option");
    element.value = option;
    element.textContent = option;
    element.selected = option === control.value;
    list.append(element);
  }
  list.addEventListener("change", (): void => {
    control.change(list.value);
  });
  row.append(head, list);
  return row;
}

/**
 * Builds one button row.
 *
 * @param control - The button.
 * @returns The row element.
 */
function buildButton(control: PanelButtonControl): HTMLElement {
  const row = document.createElement("div");
  row.className = "igx-row";
  const element = document.createElement("button");
  element.type = "button";
  element.className = "igx-button";
  element.textContent = control.label;
  element.addEventListener("click", (): void => {
    control.press();
  });
  row.append(element);
  return row;
}

/**
 * Builds one colour row.
 *
 * @param control - The colour control.
 * @returns The row element.
 */
function buildColor(control: PanelColorControl): HTMLElement {
  const row = document.createElement("label");
  row.className = "igx-row igx-row-inline";
  const input = document.createElement("input");
  input.type = "color";
  input.value = control.value;
  const text = document.createElement("span");
  text.className = "igx-row-label";
  text.textContent = control.label;
  input.addEventListener("input", (): void => {
    control.change(input.value);
  });
  row.append(input, text);
  return row;
}

/**
 * Builds one readout row.
 *
 * @param control - The readout.
 * @returns The row element and the cell {@link Panel.refresh} rewrites.
 */
function buildReadout(control: PanelReadoutControl): { row: HTMLElement; value: HTMLElement } {
  const { row, value } = buildRow(control.label);
  row.classList.add("igx-row-readout");
  value.textContent = control.read();
  return { row, value };
}

/**
 * Mounts the parameter panel.
 *
 * @remarks
 * Returns `null` on an app with no DOM overlay — a headless app, or one whose `ui()` extension is
 * not registered — so an example needs no branch of its own. `?nopanel=1` is handled by the caller
 * in `boot.ts`, which simply does not call this.
 *
 * @param app - The running app, for `app.ui`.
 * @param options - The title and the groups.
 * @returns The panel, or `null` when there is no overlay to mount into.
 *
 * @example
 * ```ts
 * const panel = createPanel(app, {
 *   title: "Hello cube",
 *   groups: [{ label: "Cube", controls: [{ kind: "toggle", label: "Shadows", value: true,
 *     change: (on) => { light.shadows.enabled = on; } }] }],
 * });
 * ```
 */
export function createPanel(app: App, options: PanelOptions): Panel | null {
  const host = app.ui.layer(PANEL_LAYER, { zIndex: PANEL_Z_INDEX }).element;
  if (host === null) {
    return null;
  }

  const element = document.createElement("section");
  // `ignifx-ui-interactive` is what turns pointer events back on: the overlay root and its layers
  // are `pointer-events: none` so a click reaches the canvas (`@ignifx/ui`'s stylesheet).
  element.className = `${UI_CLASS_NAMES.interactive} igx-panel`;
  element.setAttribute("aria-label", `${options.title} parameters`);

  // The title bar is a `<button>`, not a heading with a button in it: the whole bar is the target,
  // which is what makes it comfortably over 44 px on a phone, and a button is keyboard-operable and
  // announced with its `aria-expanded` state for nothing.
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "igx-panel-title";
  const heading = document.createElement("h2");
  heading.className = "igx-panel-heading";
  heading.textContent = options.title;
  const chevron = document.createElement("span");
  chevron.className = "igx-panel-chevron";
  chevron.setAttribute("aria-hidden", "true");
  toggleButton.append(heading, chevron);
  element.append(toggleButton);

  const body = document.createElement("div");
  body.className = "igx-panel-body";
  element.append(body);

  const readouts: { readonly read: () => string; readonly cell: HTMLElement }[] = [];

  for (const group of options.groups) {
    const details = document.createElement("details");
    details.className = "igx-group";
    details.open = group.collapsed !== true;
    const summary = document.createElement("summary");
    summary.className = "igx-group-title";
    summary.textContent = group.label;
    details.append(summary);
    for (const control of group.controls) {
      switch (control.kind) {
        case "slider": {
          details.append(buildSlider(control));
          break;
        }
        case "toggle": {
          details.append(buildToggle(control));
          break;
        }
        case "select": {
          details.append(buildSelect(control));
          break;
        }
        case "button": {
          details.append(buildButton(control));
          break;
        }
        case "color": {
          details.append(buildColor(control));
          break;
        }
        case "readout": {
          const built = buildReadout(control);
          details.append(built.row);
          readouts.push({ read: control.read, cell: built.value });
          break;
        }
        default: {
          // Every member of the union is handled above; this branch makes adding a kind a type
          // error rather than a silently missing row (coding standards §5.2).
          assertNever(control, "panel control kind");
        }
      }
    }
    body.append(details);
  }

  const startCollapsed = options.collapsed ?? prefersCollapsedPanel();
  let expanded = !startCollapsed;
  const setExpanded = (next: boolean): void => {
    expanded = next;
    element.classList.toggle("igx-panel-collapsed", !next);
    toggleButton.setAttribute("aria-expanded", String(next));
    // `hidden` rather than a CSS-only hide: a collapsed control must be out of the tab order and
    // out of the accessibility tree, not merely invisible.
    body.hidden = !next;
  };
  setExpanded(expanded);
  toggleButton.addEventListener("click", (): void => {
    setExpanded(!expanded);
  });

  host.append(element);

  const refresh = (): void => {
    for (const live of readouts) {
      live.cell.textContent = live.read();
    }
  };
  const timer = readouts.length === 0 ? null : window.setInterval(refresh, REFRESH_INTERVAL_MS);

  return {
    element,
    get isExpanded(): boolean {
      return expanded;
    },
    setExpanded,
    refresh,
    dispose(): void {
      if (timer !== null) {
        window.clearInterval(timer);
      }
      element.remove();
    },
  };
}
