import { describe, expect, it } from "vitest";
import { UI_CLASS_NAMES } from "../../src/dom/styles.js";
import { formatBindingPath, resolveMenuChoices, resolveMenuLabel, snapToStep } from "../../src/widgets/menu-row.js";
import { Menu } from "../../src/widgets/menu.js";
import { createTestHost } from "../support/host.js";
import type { MenuRow } from "../../src/widgets/menu-row.js";
import type { FakeElement } from "../support/fake-dom.js";

/**
 * `Menu` over the fake DOM: the row vocabulary, the selection model, the three input paths, and the
 * ARIA the widget writes (`docs/architecture/13-ui.md` §3).
 */

/**
 * The menu's list element.
 *
 * @param menu - The menu under test.
 * @returns The `role="menu"` container.
 */
function list(menu: Menu): FakeElement {
  const panel = menu.element as unknown as FakeElement;
  const found = panel.descendants().find((node: FakeElement): boolean => node.className === UI_CLASS_NAMES.menuRows);
  expect(found).toBeDefined();
  return found as FakeElement;
}

/**
 * One row's outermost element.
 *
 * @param menu - The menu under test.
 * @param id - The row id.
 * @returns The row element.
 */
function row(menu: Menu, id: string): FakeElement {
  const found = list(menu).children.find((node: FakeElement): boolean => node.dataset["row"] === id);
  expect(found, `no row ${id}`).toBeDefined();
  return found as FakeElement;
}

/**
 * The text drawn in a row's value span.
 *
 * @param menu - The menu under test.
 * @param id - The row id.
 * @returns The value text.
 */
function valueOf(menu: Menu, id: string): string {
  const value = row(menu, id).children.find(
    (node: FakeElement): boolean => node.className === UI_CLASS_NAMES.menuRowValue,
  );
  return value?.textContent ?? "";
}

/** A settings-shaped row list over a mutable state object. */
function settingsRows(state: { volume: number; shadows: boolean; locale: string }): readonly MenuRow[] {
  return [
    { kind: "heading", id: "audio", label: "Audio" },
    {
      kind: "slider",
      id: "volume",
      label: "Volume",
      min: 0,
      max: 1,
      step: 0.05,
      get: (): number => state.volume,
      set: (value: number): void => {
        state.volume = value;
      },
      format: (value: number): string => `${String(Math.round(value * 100))}%`,
    },
    { kind: "separator", id: "rule" },
    {
      kind: "toggle",
      id: "shadows",
      label: "Shadows",
      get: (): boolean => state.shadows,
      set: (value: boolean): void => {
        state.shadows = value;
      },
    },
    {
      kind: "choice",
      id: "locale",
      label: "Language",
      values: ["en", "fr", "de"],
      get: (): string => state.locale,
      set: (value: string): void => {
        state.locale = value;
      },
      format: (value: string): string => value.toUpperCase(),
    },
  ];
}

describe("menu row helpers", () => {
  it("snaps a value to its step and clamps it to the range", () => {
    expect(snapToStep(0.37, 0, 1, 0.05)).toBeCloseTo(0.35, 10);
    expect(snapToStep(-4, 0, 1, 0.05)).toBe(0);
    expect(snapToStep(4, 0, 1, 0.05)).toBe(1);
    // A step of zero is "no grid", not a division by zero.
    expect(snapToStep(0.37, 0, 1, 0)).toBe(0.37);
  });

  it("does not drift after a few hundred steps", () => {
    let value = 0;
    for (let index = 0; index < 400; index += 1) {
      value = snapToStep(value + 0.05, 0, 1, 0.05);
      value = snapToStep(value - 0.05, 0, 1, 0.05);
    }
    expect(value).toBe(0);
  });

  it("renders a binding path the way a player reads it", () => {
    expect(formatBindingPath("<Keyboard>/arrowUp", "—")).toBe("Keyboard: Arrow up");
    expect(formatBindingPath("<Gamepad>/leftStick/x", "—")).toBe("Gamepad: Left stick x");
    expect(formatBindingPath("space", "—")).toBe("Space");
    expect(formatBindingPath("", "—")).toBe("—");
  });

  it("resolves labels and choice lists in both forms", () => {
    expect(resolveMenuLabel("Resume", "?")).toBe("Resume");
    expect(resolveMenuLabel((): string => "Reprendre", "?")).toBe("Reprendre");
    expect(resolveMenuLabel(undefined, "?")).toBe("?");
    expect(resolveMenuChoices(["a", "b"])).toEqual(["a", "b"]);
    expect(resolveMenuChoices((): readonly string[] => ["c"])).toEqual(["c"]);
  });
});

describe("Menu", () => {
  it("mounts hidden into the menu layer with a title, a subtitle and its rows", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, {
      id: "title",
      title: "ignifx",
      subtitle: "a small game",
      rows: [{ kind: "action", id: "play", label: "Play" }],
    });
    const panel = menu.element as unknown as FakeElement;
    expect(panel.parentElement).toBe(host.layer("menu").element);
    expect(panel.dataset["menu"]).toBe("title");
    expect(panel.hidden).toBe(true);
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-label")).toBe("ignifx");
    expect(list(menu).getAttribute("role")).toBe("menu");
    expect(list(menu).tabIndex).toBe(-1);
    expect(row(menu, "play").getAttribute("role")).toBe("menuitem");
  });

  it("gives each row kind its own role, class and data attributes", () => {
    const { host } = createTestHost();
    const state = { volume: 0.5, shadows: true, locale: "en" };
    const menu = new Menu(host, { id: "settings", rows: settingsRows(state) });
    expect(row(menu, "audio").getAttribute("role")).toBe("separator");
    expect(row(menu, "audio").className).toBe(UI_CLASS_NAMES.menuHeading);
    expect(row(menu, "rule").className).toBe(UI_CLASS_NAMES.menuSeparator);
    expect(row(menu, "shadows").getAttribute("role")).toBe("menuitemcheckbox");
    expect(row(menu, "shadows").getAttribute("aria-checked")).toBe("true");
    expect(row(menu, "volume").getAttribute("role")).toBe("menuitem");
    expect(row(menu, "volume").dataset["kind"]).toBe("slider");
    const slider = row(menu, "volume").children.find(
      (node: FakeElement): boolean => node.className === UI_CLASS_NAMES.menuRowSlider,
    );
    // The range input is a pointer affordance only: it is out of the accessibility tree, because a
    // `menuitem` may not own an interactive element.
    expect(slider?.getAttribute("aria-hidden")).toBe("true");
    expect(slider?.tabIndex).toBe(-1);
    expect(slider?.min).toBe("0");
    expect(slider?.max).toBe("1");
    expect(slider?.step).toBe("0.05");
    expect(slider?.value).toBe("0.5");
    expect(valueOf(menu, "volume")).toBe("50%");
    expect(valueOf(menu, "shadows")).toBe("On");
    expect(valueOf(menu, "locale")).toBe("EN");
  });

  it("selects the first selectable row and skips headings, separators and disabled rows", () => {
    const { host } = createTestHost();
    let unlocked = false;
    const menu = new Menu(host, {
      id: "title",
      rows: [
        { kind: "heading", id: "head", label: "Head" },
        { kind: "action", id: "continue", label: "Continue", enabled: (): boolean => unlocked },
        { kind: "action", id: "new", label: "New" },
        { kind: "separator", id: "rule" },
        { kind: "action", id: "quit", label: "Quit" },
      ],
    });
    menu.show();
    expect(menu.selected?.id).toBe("new");
    menu.moveSelection(1);
    expect(menu.selected?.id).toBe("quit");
    // Wraps past the end, back over the separator and the disabled row.
    menu.moveSelection(1);
    expect(menu.selected?.id).toBe("new");
    unlocked = true;
    menu.refresh();
    menu.moveSelection(-1);
    expect(menu.selected?.id).toBe("continue");
    expect(row(menu, "continue").getAttribute("data-disabled")).toBeNull();
    expect(row(menu, "rule").getAttribute("data-disabled")).toBeNull();
  });

  it("stops at the ends when wrapping is off", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, {
      id: "m",
      wrap: false,
      rows: [
        { kind: "action", id: "a", label: "A" },
        { kind: "action", id: "b", label: "B" },
      ],
    });
    menu.show();
    menu.moveSelection(-1);
    expect(menu.selected?.id).toBe("a");
    menu.moveSelection(1);
    menu.moveSelection(1);
    expect(menu.selected?.id).toBe("b");
  });

  it("adjusts a slider, a toggle and a choice with Left and Right", () => {
    const { host } = createTestHost();
    const state = { volume: 0.5, shadows: true, locale: "en" };
    const menu = new Menu(host, { id: "settings", rows: settingsRows(state) });
    menu.show();
    expect(menu.selected?.id).toBe("volume");
    menu.adjustSelection(1);
    expect(state.volume).toBeCloseTo(0.55, 10);
    expect(valueOf(menu, "volume")).toBe("55%");
    for (let index = 0; index < 20; index += 1) {
      menu.adjustSelection(1);
    }
    expect(state.volume).toBe(1);
    menu.select("shadows");
    menu.adjustSelection(-1);
    expect(state.shadows).toBe(false);
    expect(row(menu, "shadows").getAttribute("aria-checked")).toBe("false");
    menu.select("locale");
    menu.adjustSelection(1);
    expect(state.locale).toBe("fr");
    menu.adjustSelection(-1);
    menu.adjustSelection(-1);
    expect(state.locale).toBe("de");
  });

  it("activates an action, a binding, and the value rows", () => {
    const { host } = createTestHost();
    const state = { volume: 0.5, shadows: false, locale: "en" };
    const runs: string[] = [];
    const activated: string[] = [];
    const menu = new Menu(host, {
      id: "m",
      text: { unbound: "none", listening: "…" },
      rows: [
        {
          kind: "action",
          id: "play",
          label: "Play",
          activate: (): void => {
            runs.push("play");
          },
        },
        {
          kind: "binding",
          id: "jump",
          label: "Jump",
          path: (): string => "<Keyboard>/space",
          rebind: (): void => {
            runs.push("rebind");
          },
        },
        ...settingsRows(state).slice(1),
      ],
    });
    menu.onActivated.connect((activeRow): void => {
      activated.push(activeRow.id);
    });
    menu.show();
    menu.activateSelection();
    expect(runs).toEqual(["play"]);
    expect(valueOf(menu, "jump")).toBe("Keyboard: Space");
    menu.select("jump");
    menu.activateSelection();
    expect(runs).toEqual(["play", "rebind"]);
    menu.select("shadows");
    menu.activateSelection();
    expect(state.shadows).toBe(true);
    expect(activated).toEqual(["play", "jump", "shadows"]);
  });

  it("does nothing on a disabled row", () => {
    const { host } = createTestHost();
    let ran = 0;
    const menu = new Menu(host, {
      id: "m",
      rows: [
        {
          kind: "action",
          id: "locked",
          label: "Locked",
          enabled: (): boolean => false,
          activate: (): void => {
            ran += 1;
          },
        },
      ],
    });
    menu.show();
    menu.activateSelection();
    expect(ran).toBe(0);
    expect(row(menu, "locked").getAttribute("data-disabled")).toBe("");
    expect(row(menu, "locked").getAttribute("aria-disabled")).toBe("true");
    // Nothing is selectable, so no row is announced as active.
    expect(list(menu).getAttribute("aria-activedescendant")).toBeNull();
  });

  it("shows a binding row's unbound and listening text", () => {
    const { host } = createTestHost();
    let listening = false;
    let path = "";
    const menu = new Menu(host, {
      id: "b",
      text: { unbound: "Unbound", listening: "Press a key" },
      rows: [
        {
          kind: "binding",
          id: "fire",
          label: "Fire",
          path: (): string => path,
          listening: (): boolean => listening,
        },
      ],
    });
    expect(valueOf(menu, "fire")).toBe("Unbound");
    listening = true;
    menu.refresh();
    expect(valueOf(menu, "fire")).toBe("Press a key");
    listening = false;
    path = "<Mouse>/leftButton";
    menu.refresh();
    expect(valueOf(menu, "fire")).toBe("Mouse: Left button");
  });

  it("re-reads every label on refresh, which is what a locale change needs", () => {
    const { host } = createTestHost();
    let locale = "en";
    const menu = new Menu(host, {
      id: "m",
      title: (): string => (locale === "en" ? "Paused" : "En pause"),
      subtitle: (): string => (locale === "en" ? "take a break" : "une pause"),
      text: { on: (): string => (locale === "en" ? "On" : "Oui"), off: "Off" },
      rows: [
        {
          kind: "toggle",
          id: "shadows",
          label: (): string => (locale === "en" ? "Shadows" : "Ombres"),
          get: (): boolean => true,
          set: (): void => {},
        },
      ],
    });
    locale = "fr";
    menu.refresh();
    const panel = menu.element as unknown as FakeElement;
    const heading = panel.descendants().find((node) => node.className === UI_CLASS_NAMES.menuTitle);
    const subtitle = panel.descendants().find((node) => node.className === UI_CLASS_NAMES.menuSubtitle);
    expect(heading?.textContent).toBe("En pause");
    expect(subtitle?.textContent).toBe("une pause");
    expect(panel.getAttribute("aria-label")).toBe("En pause");
    expect(valueOf(menu, "shadows")).toBe("Oui");
  });

  it("keeps the selection on the same row id when the rows are rebuilt", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, {
      id: "m",
      rows: [
        { kind: "action", id: "a", label: "A" },
        { kind: "action", id: "b", label: "B" },
      ],
    });
    menu.show();
    menu.moveSelection(1);
    expect(menu.selected?.id).toBe("b");
    menu.setRows([
      { kind: "action", id: "a", label: "A" },
      { kind: "action", id: "extra", label: "Extra" },
      { kind: "action", id: "b", label: "B" },
    ]);
    expect(menu.selected?.id).toBe("b");
    expect(menu.selectedIndex).toBe(2);
    expect(list(menu).children).toHaveLength(3);
  });

  it("points aria-activedescendant at the selected row and marks it focused", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, {
      id: "m",
      rows: [
        { kind: "action", id: "a", label: "A" },
        { kind: "action", id: "b", label: "B" },
      ],
    });
    menu.show();
    expect(list(menu).getAttribute("aria-activedescendant")).toBe(row(menu, "a").id);
    expect(row(menu, "a").getAttribute("data-focused")).toBe("");
    menu.moveSelection(1);
    expect(list(menu).getAttribute("aria-activedescendant")).toBe(row(menu, "b").id);
    expect(row(menu, "a").getAttribute("data-focused")).toBeNull();
    menu.hide();
    // Hidden, nothing is drawn focused.
    expect(row(menu, "b").getAttribute("data-focused")).toBeNull();
  });

  it("focuses the list on show and scrolls the selected row into view", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, {
      id: "m",
      rows: [
        { kind: "action", id: "a", label: "A" },
        { kind: "action", id: "b", label: "B" },
      ],
    });
    menu.show();
    expect(list(menu).focusCount).toBe(1);
    menu.moveSelection(1);
    expect(row(menu, "b").scrollCount).toBe(1);
  });

  it("moves the selection on hover and activates on click", () => {
    const { host } = createTestHost();
    const runs: string[] = [];
    const moves: string[] = [];
    const menu = new Menu(host, {
      id: "m",
      rows: [
        { kind: "action", id: "a", label: "A" },
        {
          kind: "action",
          id: "b",
          label: "B",
          activate: (): void => {
            runs.push("b");
          },
        },
      ],
    });
    menu.onSelectionChanged.connect((selected): void => {
      moves.push(selected.id);
    });
    menu.show();
    row(menu, "b").dispatch("pointerenter");
    expect(menu.selected?.id).toBe("b");
    expect(moves).toEqual(["b"]);
    row(menu, "b").dispatch("click");
    expect(runs).toEqual(["b"]);
  });

  it("writes a dragged slider back through the row and does not activate the row", () => {
    const { host } = createTestHost();
    const state = { volume: 0.5, shadows: true, locale: "en" };
    const menu = new Menu(host, { id: "s", rows: settingsRows(state) });
    menu.show();
    const slider = row(menu, "volume").children.find(
      (node: FakeElement): boolean => node.className === UI_CLASS_NAMES.menuRowSlider,
    );
    expect(slider).toBeDefined();
    (slider as FakeElement).value = "0.72";
    (slider as FakeElement).dispatch("input");
    // Snapped to the step, not the raw drag value.
    expect(state.volume).toBeCloseTo(0.7, 10);
    // The click that ends a drag stops at the slider: the row must not advance a step as well.
    (slider as FakeElement).dispatch("click");
    expect(state.volume).toBeCloseTo(0.7, 10);
  });

  it("reads the keyboard itself while it has focus", () => {
    const { host } = createTestHost();
    const state = { volume: 0.5, shadows: true, locale: "en" };
    const backs: number[] = [];
    const menu = new Menu(host, { id: "s", rows: settingsRows(state) });
    menu.onBack.connect((): void => {
      backs.push(1);
    });
    menu.show();
    expect(list(menu).dispatch("keydown", { key: "ArrowDown" })).toBe(false);
    expect(menu.selected?.id).toBe("shadows");
    list(menu).dispatch("keydown", { key: "ArrowUp" });
    expect(menu.selected?.id).toBe("volume");
    list(menu).dispatch("keydown", { key: "ArrowRight" });
    expect(state.volume).toBeCloseTo(0.55, 10);
    list(menu).dispatch("keydown", { key: "ArrowLeft" });
    expect(state.volume).toBeCloseTo(0.5, 10);
    list(menu).dispatch("keydown", { key: "Enter" });
    expect(state.volume).toBeCloseTo(0.55, 10);
    list(menu).dispatch("keydown", { key: "Escape" });
    expect(backs).toHaveLength(1);
    // A key the menu does not own is left alone.
    expect(list(menu).dispatch("keydown", { key: "F5" })).toBe(true);
  });

  it("leaves the keyboard alone when keyboard handling is off", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, {
      id: "m",
      keyboard: false,
      rows: [
        { kind: "action", id: "a", label: "A" },
        { kind: "action", id: "b", label: "B" },
      ],
    });
    menu.show();
    list(menu).dispatch("keydown", { key: "ArrowDown" });
    expect(menu.selected?.id).toBe("a");
    menu.keyboardEnabled = true;
    list(menu).dispatch("keydown", { key: "ArrowDown" });
    expect(menu.selected?.id).toBe("b");
  });

  it("leaves a focused range input's own arrow keys to the browser", () => {
    const { host } = createTestHost();
    const state = { volume: 0.5, shadows: true, locale: "en" };
    const menu = new Menu(host, { id: "s", rows: settingsRows(state) });
    menu.show();
    const slider = row(menu, "volume").children.find(
      (node: FakeElement): boolean => node.className === UI_CLASS_NAMES.menuRowSlider,
    );
    // The event bubbles to the list, but the target is the input, so the widget stands back and the
    // native range handles it (and reports back through `input`).
    (slider as FakeElement).dispatch("keydown", { key: "ArrowRight" });
    expect(state.volume).toBe(0.5);
  });

  it("only cancels when it is cancelable", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, { id: "title", cancelable: false, rows: [{ kind: "action", id: "a", label: "A" }] });
    let backs = 0;
    menu.onBack.connect((): void => {
      backs += 1;
    });
    expect(menu.cancel()).toBe(false);
    expect(backs).toBe(0);
    menu.cancelable = true;
    expect(menu.cancel()).toBe(true);
    expect(backs).toBe(1);
  });

  it("removes its panel and drops its signals on dispose", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, { id: "m", rows: [{ kind: "action", id: "a", label: "A" }] });
    const layer = host.layer("menu").element as unknown as FakeElement;
    expect(layer.children).toHaveLength(1);
    menu.dispose();
    expect(layer.children).toHaveLength(0);
    // Every method stays safe afterwards.
    menu.show();
    menu.hide();
    expect(menu.cancel()).toBe(false);
    menu.dispose();
  });

  it("keeps its whole state with no DOM overlay", () => {
    const { host } = createTestHost({ headless: true });
    const state = { volume: 0.5, shadows: true, locale: "en" };
    const menu = new Menu(host, { id: "s", rows: settingsRows(state) });
    expect(host.isActive).toBe(false);
    expect(menu.element).toBeNull();
    menu.show();
    expect(menu.isVisible).toBe(true);
    expect(menu.selected?.id).toBe("volume");
    menu.adjustSelection(1);
    expect(state.volume).toBeCloseTo(0.55, 10);
    menu.moveSelection(1);
    expect(menu.selected?.id).toBe("shadows");
    menu.activateSelection();
    expect(state.shadows).toBe(false);
    menu.refresh();
    menu.hide();
    menu.dispose();
  });
});
