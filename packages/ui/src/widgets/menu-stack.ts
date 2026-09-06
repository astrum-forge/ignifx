import { Signal } from "@ignifx/core";
import type { MenuRow } from "./menu-row.js";
import type { Menu } from "./menu.js";
import type { Disconnect, SignalLike, Vec2Like } from "@ignifx/core";

/**
 * `MenuStack` — screen navigation for {@link Menu}: push a screen on top, pop back to the one
 * underneath, and drive the whole stack from one place.
 *
 * Every front end that has more than one screen needs the same three things, and they are the
 * three things games get wrong: exactly one screen is visible at a time; Escape (or the pad's east
 * button) unwinds exactly one level; and a held direction repeats on the **unscaled** clock, so
 * navigation still works while `app.pause()` has stopped the game.
 *
 * ## Why the input is an interface and not `@ignifx/input`
 *
 * `@ignifx/input` is an optional peer of `@ignifx/ui` (`docs/architecture/13-ui.md` header), and a
 * menu is exactly the kind of thing a game builds without it. {@link MenuNavigation} is therefore a
 * structural shape that an `InputAction` already satisfies — pass the actions of a `UI` action map
 * straight in — while a game with no input extension passes its own objects, or nothing at all and
 * uses the widget's own keyboard handling.
 *
 * ```ts ignore-check
 * const ui = app.input.actions.maps.get("UI") ?? null;
 * const stack = new MenuStack({
 *   navigation: {
 *     move: ui?.actions.get("menuMove") ?? null,
 *     submit: ui?.actions.get("menuSubmit") ?? null,
 *     back: ui?.actions.get("menuBack") ?? null,
 *   },
 * });
 * ```
 *
 * A stack built with a navigation source turns each pushed menu's own keyboard handling **off**
 * while the menu is on the stack, and restores it on the way out: otherwise a keyboard bound to
 * `menuMove` would move the selection twice per press, once through the action and once through
 * the DOM.
 */

/**
 * Anything with a two-dimensional value, which `@ignifx/input`'s `InputAction` is.
 *
 * @public
 */
export interface MenuVectorSource {
  /** The direction, `-1` to `1` on each axis. Positive `y` is up. */
  readonly vector: Vec2Like;
}

/**
 * Anything with a press edge, which `@ignifx/input`'s `InputAction` is.
 *
 * @public
 */
export interface MenuButtonSource {
  /** Whether the control went down this frame. */
  readonly wasPressedThisFrame: boolean;
}

/**
 * The three controls a menu stack reads.
 *
 * @public
 */
export interface MenuNavigation {
  /** Moves the selection (`y`) and adjusts the selected row (`x`). */
  readonly move?: MenuVectorSource | null;
  /** Activates the selected row. */
  readonly submit?: MenuButtonSource | null;
  /** Backs out one screen. */
  readonly back?: MenuButtonSource | null;
}

/**
 * What `new MenuStack(options)` accepts.
 *
 * @public
 */
export interface MenuStackOptions {
  /** The controls to read in {@link MenuStack.update}. Omit to drive the stack by hand. */
  readonly navigation?: MenuNavigation;
  /** How long the first repeat of a held direction waits, in seconds. Defaults to `0.35`. */
  readonly repeatDelay?: number;
  /** How long each following repeat waits, in seconds. Defaults to `0.12`. */
  readonly repeatInterval?: number;
  /** How far an axis must move before it counts as a direction. Defaults to `0.5`. */
  readonly threshold?: number;
}

/** What the stack remembers about one menu it pushed. */
interface StackEntry {
  /** The menu. */
  readonly menu: Menu;
  /** The subscriptions to drop when it is popped. */
  readonly disconnects: readonly Disconnect[];
  /** What the menu's `keyboardEnabled` was before the stack turned it off. */
  readonly keyboard: boolean;
}

/**
 * A stack of {@link Menu} screens, innermost last.
 *
 * @example
 * ```ts ignore-check
 * const stack = new MenuStack({ navigation });
 * stack.push(title);
 * // in a script that runs while paused:
 * stack.update(app.time.unscaledDeltaTime);
 * ```
 *
 * @public
 */
export class MenuStack {
  readonly #entries: StackEntry[] = [];

  readonly #navigation: MenuNavigation | null;

  readonly #repeatDelay: number;

  readonly #repeatInterval: number;

  readonly #threshold: number;

  readonly #changed = new Signal<Menu | null>();

  readonly #selectionChanged = new Signal<MenuRow>();

  readonly #activated = new Signal<MenuRow>();

  #heldX: -1 | 0 | 1 = 0;

  #heldY: -1 | 0 | 1 = 0;

  #repeatIn = 0;

  #suspended = false;

  /**
   * Builds an empty stack.
   *
   * @param options - The controls to read, and the repeat timings.
   */
  constructor(options: MenuStackOptions = {}) {
    this.#navigation = options.navigation ?? null;
    this.#repeatDelay = options.repeatDelay ?? 0.35;
    this.#repeatInterval = options.repeatInterval ?? 0.12;
    this.#threshold = options.threshold ?? 0.5;
  }

  /**
   * The menus on the stack, outermost first.
   *
   * @returns The menus, in push order.
   */
  get menus(): readonly Menu[] {
    return this.#entries.map((entry: StackEntry): Menu => entry.menu);
  }

  /**
   * The menu on top, which is the visible one.
   *
   * @returns The top menu, or `null` when the stack is empty.
   */
  get top(): Menu | null {
    return this.#entries.at(-1)?.menu ?? null;
  }

  /**
   * The menu at the bottom, which is the one the stack was opened with.
   *
   * @returns The first menu pushed, or `null` when the stack is empty.
   */
  get bottom(): Menu | null {
    return this.#entries[0]?.menu ?? null;
  }

  /**
   * How deep the stack is.
   *
   * @returns The number of menus on it.
   */
  get depth(): number {
    return this.#entries.length;
  }

  /**
   * Whether any menu is open.
   *
   * @returns `true` while the stack is not empty.
   */
  get isOpen(): boolean {
    return this.#entries.length > 0;
  }

  /**
   * Whether {@link MenuStack.update} is reading its controls.
   *
   * @remarks
   * Set it while something modal is on top of the menu — a confirmation `Dialog`, or a rebind that
   * is listening for the next key — so that the same press does not reach both.
   *
   * @returns `true` while navigation is suspended.
   */
  get suspended(): boolean {
    return this.#suspended;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set suspended(value: boolean) {
    this.#suspended = value;
    if (value) {
      this.#releaseHeld();
    }
  }

  /**
   * Emitted with the new top menu — `null` when the stack empties — whenever the stack changes. A
   * game connects its audio ducking and its pause state to it.
   *
   * @returns The signal.
   */
  get onChanged(): SignalLike<Menu | null> {
    return this.#changed;
  }

  /**
   * Emitted with the newly selected row whenever the selection moves on the top menu.
   *
   * @returns The signal.
   */
  get onSelectionChanged(): SignalLike<MenuRow> {
    return this.#selectionChanged;
  }

  /**
   * Emitted with the row that was activated on the top menu.
   *
   * @returns The signal.
   */
  get onActivated(): SignalLike<MenuRow> {
    return this.#activated;
  }

  /**
   * Hides whatever is on top and shows `menu` over it.
   *
   * @param menu - The menu to open.
   */
  push(menu: Menu): void {
    this.top?.hide();
    const keyboard = menu.keyboardEnabled;
    if (this.#navigation !== null) {
      menu.keyboardEnabled = false;
    }
    this.#entries.push({
      menu,
      keyboard,
      disconnects: [
        menu.onBack.connect((): void => {
          this.pop();
        }),
        menu.onSelectionChanged.connect((row: MenuRow): void => {
          this.#selectionChanged.emit(row);
        }),
        menu.onActivated.connect((row: MenuRow): void => {
          this.#activated.emit(row);
        }),
      ],
    });
    menu.show();
    this.#releaseHeld();
    this.#changed.emit(menu);
  }

  /**
   * Closes the top menu and shows the one underneath.
   *
   * @returns The menu that was closed, or `null` when the stack was already empty.
   */
  pop(): Menu | null {
    const entry = this.#entries.pop();
    if (entry === undefined) {
      return null;
    }
    this.#release(entry);
    entry.menu.hide();
    this.top?.show();
    this.#releaseHeld();
    this.#changed.emit(this.top);
    return entry.menu;
  }

  /** Closes every menu on the stack. */
  closeAll(): void {
    if (this.#entries.length === 0) {
      return;
    }
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index];
      if (entry !== undefined) {
        this.#release(entry);
        entry.menu.hide();
      }
    }
    this.#entries.length = 0;
    this.#releaseHeld();
    this.#changed.emit(null);
  }

  /** Re-reads every label on every menu on the stack, for a locale change. */
  refresh(): void {
    for (const entry of this.#entries) {
      entry.menu.refresh();
    }
  }

  /**
   * Reads the navigation controls and applies them to the top menu.
   *
   * @remarks
   * Call it from a script that declares `static updateWhenPaused = true`, with
   * `app.time.unscaledDeltaTime`: a menu that repeats a held direction has to keep time while the
   * game is stopped, and scaled time is pinned at zero while it is.
   *
   * @param unscaledDelta - Seconds since the last call, on the unscaled clock.
   */
  update(unscaledDelta: number): void {
    const top = this.top;
    const navigation = this.#navigation;
    if (top === null || navigation === null || this.#suspended) {
      this.#releaseHeld();
      return;
    }
    const move = navigation.move ?? null;
    const x = this.#direction(move === null ? 0 : move.vector.x);
    const y = this.#direction(move === null ? 0 : move.vector.y);
    if (x !== this.#heldX || y !== this.#heldY) {
      this.#heldX = x;
      this.#heldY = y;
      this.#repeatIn = this.#repeatDelay;
      this.#applyDirection(top, x, y);
    } else if (x !== 0 || y !== 0) {
      this.#repeatIn -= unscaledDelta;
      if (this.#repeatIn <= 0) {
        this.#repeatIn = this.#repeatInterval;
        this.#applyDirection(top, x, y);
      }
    }
    if (navigation.submit?.wasPressedThisFrame === true) {
      top.activateSelection();
      return;
    }
    if (navigation.back?.wasPressedThisFrame === true) {
      top.cancel();
    }
  }

  /** Drops every subscription. The menus themselves belong to the game and are not disposed. */
  dispose(): void {
    for (const entry of this.#entries) {
      this.#release(entry);
    }
    this.#entries.length = 0;
    this.#changed.clear();
    this.#selectionChanged.clear();
    this.#activated.clear();
  }

  /**
   * Applies one direction to the top menu.
   *
   * @param top - The menu on top.
   * @param x - `-1`, `0` or `1` on the horizontal axis.
   * @param y - `-1`, `0` or `1` on the vertical axis, positive up.
   */
  #applyDirection(top: Menu, x: -1 | 0 | 1, y: -1 | 0 | 1): void {
    if (y !== 0) {
      top.moveSelection(y > 0 ? -1 : 1);
    }
    if (x !== 0) {
      top.adjustSelection(x);
    }
  }

  /**
   * Turns an axis into a direction, so a stick and a keyboard composite read the same.
   *
   * @param value - The axis value.
   * @returns `-1`, `0` or `1`.
   */
  #direction(value: number): -1 | 0 | 1 {
    if (value >= this.#threshold) {
      return 1;
    }
    return value <= -this.#threshold ? -1 : 0;
  }

  /** Forgets the held direction, so the next frame starts a fresh press. */
  #releaseHeld(): void {
    this.#heldX = 0;
    this.#heldY = 0;
    this.#repeatIn = 0;
  }

  /**
   * Drops one entry's subscriptions and gives its menu its keyboard handling back.
   *
   * @param entry - The entry being removed.
   */
  #release(entry: StackEntry): void {
    for (const disconnect of entry.disconnects) {
      disconnect();
    }
    entry.menu.keyboardEnabled = entry.keyboard;
  }
}
