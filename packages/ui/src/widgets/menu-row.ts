/**
 * Rows declare the values they edit through `get` and `set`. The menu handles rendering,
 * clamping, formatting, and input repeat so each settings screen can share that behaviour.
 */

/**
 * Text that is either fixed or re-read on every refresh.
 *
 * @remarks
 * A function is what makes a menu localizable: `label: () => app.i18n.t("menu.resume")` re-renders
 * itself when `app.i18n.locale` changes, because {@link Menu.refresh} calls it again.
 *
 * @public
 */
export type MenuLabel = string | (() => string);

/**
 * The values a `"choice"` row cycles through: a fixed list, or one read per use.
 *
 * @public
 */
export type MenuChoiceValues = readonly string[] | (() => readonly string[]);

/**
 * What every selectable row carries.
 *
 * @public
 */
export interface MenuRowBase {
  /** A stable id. It becomes the row's `data-row` attribute, which is what a test selects on. */
  readonly id: string;
  /** The left-hand text. */
  readonly label: MenuLabel;
  /** Whether the row can be selected. A row that answers `false` is drawn dimmed and skipped. */
  readonly enabled?: () => boolean;
}

/**
 * A row that runs something when it is activated.
 *
 * @public
 */
export interface MenuActionRow extends MenuRowBase {
  /** What kind of row this is. */
  readonly kind: "action";
  /** The right-hand text, when the row shows one. */
  readonly value?: MenuLabel;
  /** What Enter, the pad's south button and a click do. */
  readonly activate?: () => void;
}

/**
 * A row that flips a flag.
 *
 * @public
 */
export interface MenuToggleRow extends MenuRowBase {
  /** What kind of row this is. */
  readonly kind: "toggle";
  /** Reads the flag. */
  readonly get: () => boolean;
  /** Writes the flag. */
  readonly set: (value: boolean) => void;
  /** Renders the flag. Defaults to the menu's `text.on` / `text.off`. */
  readonly format?: (value: boolean) => string;
}

/**
 * A row that edits a number over a range.
 *
 * @remarks
 * Drawn as a native `<input type="range">` plus the formatted value, because dragging a knob is
 * worth having and `@ignifx/ui`'s own focus policy deliberately does not count a slider as a text
 * field (`docs/architecture/13-ui.md` §1), so a slider under the pointer never suppresses gameplay
 * input.
 *
 * @public
 */
export interface MenuSliderRow extends MenuRowBase {
  /** What kind of row this is. */
  readonly kind: "slider";
  /** The lowest value the row may take. */
  readonly min: number;
  /** The highest value the row may take. */
  readonly max: number;
  /** How far one Left or Right press moves the value. */
  readonly step: number;
  /** Reads the current value. */
  readonly get: () => number;
  /** Writes a new value, already clamped and snapped to the step. */
  readonly set: (value: number) => void;
  /** Renders the value. Defaults to the number itself. */
  readonly format?: (value: number) => string;
}

/**
 * A row that cycles through a list of values.
 *
 * @public
 */
export interface MenuChoiceRow extends MenuRowBase {
  /** What kind of row this is. */
  readonly kind: "choice";
  /** The values to cycle through, in order. */
  readonly values: MenuChoiceValues;
  /** Reads the current value. */
  readonly get: () => string;
  /** Writes the new value. */
  readonly set: (value: string) => void;
  /** Renders a value for display. Defaults to the value itself. */
  readonly format?: (value: string) => string;
}

/**
 * A row that shows one input binding and starts a rebind when it is activated.
 *
 * @remarks
 * The row knows nothing about `@ignifx/input`: it is handed the binding's path as a string and a
 * callback that starts whatever rebinding flow the game uses. `@ignifx/input`'s
 * `performInteractiveRebind` is the usual one.
 *
 * @public
 */
export interface MenuBindingRow extends MenuRowBase {
  /** What kind of row this is. */
  readonly kind: "binding";
  /** Reads the binding path, such as `<Keyboard>/arrowUp`, or `""` when nothing is bound. */
  readonly path: () => string;
  /** Starts the rebind. */
  readonly rebind?: () => void;
  /** Whether this row's rebind is listening right now, which changes what the row shows. */
  readonly listening?: () => boolean;
}

/**
 * A non-selectable label that groups the rows under it.
 *
 * @public
 */
export interface MenuHeadingRow {
  /** What kind of row this is. */
  readonly kind: "heading";
  /** A stable id, which becomes the row's `data-row` attribute. */
  readonly id: string;
  /** The heading text. */
  readonly label: MenuLabel;
}

/**
 * A non-selectable rule between groups of rows.
 *
 * @public
 */
export interface MenuSeparatorRow {
  /** What kind of row this is. */
  readonly kind: "separator";
  /** A stable id, which becomes the row's `data-row` attribute. */
  readonly id: string;
}

/**
 * One row of a {@link Menu}.
 *
 * @public
 */
export type MenuRow =
  | MenuActionRow
  | MenuBindingRow
  | MenuChoiceRow
  | MenuHeadingRow
  | MenuSeparatorRow
  | MenuSliderRow
  | MenuToggleRow;

/**
 * The words a menu uses for the states its rows can be in, so a localized game sets them once per
 * menu rather than on every row.
 *
 * @public
 */
export interface MenuText {
  /** What a `"toggle"` row shows when it is on. Defaults to `"On"`. */
  readonly on?: MenuLabel;
  /** What a `"toggle"` row shows when it is off. Defaults to `"Off"`. */
  readonly off?: MenuLabel;
  /** What a `"binding"` row shows when nothing is bound. Defaults to `"—"`. */
  readonly unbound?: MenuLabel;
  /** What a `"binding"` row shows while it is listening. Defaults to `"Press any key…"`. */
  readonly listening?: MenuLabel;
}

/**
 * Reads a {@link MenuLabel}.
 *
 * @param label - The fixed string, the function, or nothing.
 * @param fallback - What to answer when `label` is `undefined`.
 * @returns The text to draw.
 *
 * @public
 */
export function resolveMenuLabel(label: MenuLabel | undefined, fallback: string): string {
  if (label === undefined) {
    return fallback;
  }
  return typeof label === "string" ? label : label();
}

/**
 * Reads a {@link MenuChoiceValues}.
 *
 * @param values - The fixed list or the function.
 * @returns The values, in order.
 *
 * @public
 */
export function resolveMenuChoices(values: MenuChoiceValues): readonly string[] {
  return typeof values === "function" ? values() : values;
}

/**
 * Clamps a number into a range and snaps it to the step.
 *
 * @remarks
 * Snapping rather than accumulating is what stops a slider from drifting by floating-point error
 * after a few hundred key presses: every value is recomputed from `min` and a whole number of
 * steps.
 *
 * @param value - The raw value.
 * @param min - The lowest allowed value.
 * @param max - The highest allowed value.
 * @param step - The grid the value is snapped to. A step of `0` or less disables snapping.
 * @returns The clamped, snapped value.
 *
 * @example
 * ```ts
 * snapToStep(0.37, 0, 1, 0.05); // 0.35
 * ```
 *
 * @public
 */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) {
    return clamped;
  }
  const steps = Math.round((clamped - min) / step);
  return Math.min(max, Math.max(min, min + steps * step));
}

/**
 * Renders an `@ignifx/input` binding path the way a player reads it.
 *
 * @param path - The binding path, such as `<Keyboard>/arrowUp`, or `""` for none.
 * @param unbound - What to answer for an empty path.
 * @returns The label, such as `Keyboard: Arrow up`.
 *
 * @example
 * ```ts
 * formatBindingPath("<Keyboard>/arrowUp", "—"); // "Keyboard: Arrow up"
 * formatBindingPath("", "—"); // "—"
 * ```
 *
 * @public
 */
export function formatBindingPath(path: string, unbound: string): string {
  if (path === "") {
    return unbound;
  }
  const slash = path.indexOf("/");
  const device = slash > 0 ? path.slice(1, slash - 1) : "";
  const control = slash > 0 ? path.slice(slash + 1) : path;
  const spaced = control.replaceAll("/", " ").replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>");
  const pretty = spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  return device === "" ? pretty : `${device}: ${pretty}`;
}
