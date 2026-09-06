import { describe, expect, it } from "vitest";
import { MenuStack } from "../../src/widgets/menu-stack.js";
import { Menu } from "../../src/widgets/menu.js";
import { createTestHost } from "../support/host.js";
import type { MenuRow } from "../../src/widgets/menu-row.js";
import type { MenuNavigation } from "../../src/widgets/menu-stack.js";

/**
 * `MenuStack`: screen navigation, the unscaled repeat, and the guarantee that exactly one screen is
 * visible at a time.
 */

/** A navigation source a test drives by hand, shaped like three `@ignifx/input` actions. */
interface FakeNavigation {
  /** The stick or composite direction, positive `y` up. Mutated by the test. */
  readonly vector: { x: number; y: number };
  /** The press edges, mutated by the test. */
  readonly flags: { submit: boolean; back: boolean };
  /** The source as `MenuStack` reads it. */
  readonly source: MenuNavigation;
}

/**
 * Builds a navigation source whose three controls read live from one object.
 *
 * @returns The fake.
 */
function createNavigation(): FakeNavigation {
  const vector = { x: 0, y: 0 };
  const flags = { submit: false, back: false };
  return {
    vector,
    flags,
    source: {
      move: { vector },
      submit: {
        get wasPressedThisFrame(): boolean {
          return flags.submit;
        },
      },
      back: {
        get wasPressedThisFrame(): boolean {
          return flags.back;
        },
      },
    },
  };
}

/**
 * Three rows, so a move is observable.
 *
 * @param runs - Collects every activation.
 * @returns The rows.
 */
function rows(runs: string[]): readonly MenuRow[] {
  return ["a", "b", "c"].map((id: string): MenuRow => ({
    kind: "action",
    id,
    label: id.toUpperCase(),
    activate: (): void => {
      runs.push(id);
    },
  }));
}

describe("MenuStack", () => {
  it("shows exactly one screen at a time and unwinds on pop", () => {
    const { host } = createTestHost();
    const title = new Menu(host, { id: "title", cancelable: false, rows: rows([]) });
    const settings = new Menu(host, { id: "settings", rows: rows([]) });
    const stack = new MenuStack();
    const tops: (string | null)[] = [];
    stack.onChanged.connect((menu): void => {
      tops.push(menu?.id ?? null);
    });

    expect(stack.isOpen).toBe(false);
    stack.push(title);
    expect(title.isVisible).toBe(true);
    stack.push(settings);
    expect(title.isVisible).toBe(false);
    expect(settings.isVisible).toBe(true);
    expect(stack.depth).toBe(2);
    expect(stack.top?.id).toBe("settings");
    expect(stack.bottom?.id).toBe("title");
    expect(stack.menus.map((menu) => menu.id)).toEqual(["title", "settings"]);

    expect(stack.pop()?.id).toBe("settings");
    expect(settings.isVisible).toBe(false);
    expect(title.isVisible).toBe(true);
    stack.closeAll();
    expect(title.isVisible).toBe(false);
    expect(stack.isOpen).toBe(false);
    expect(tops).toEqual(["title", "settings", "title", null]);
    // Popping an empty stack is not an error, and does not re-announce anything.
    expect(stack.pop()).toBeNull();
    stack.closeAll();
    expect(tops).toHaveLength(4);
  });

  it("pops when a menu cancels, and leaves a title screen alone", () => {
    const { host } = createTestHost();
    const title = new Menu(host, { id: "title", cancelable: false, rows: rows([]) });
    const pause = new Menu(host, { id: "pause", rows: rows([]) });
    const stack = new MenuStack();
    stack.push(title);
    title.cancel();
    expect(stack.depth).toBe(1);
    stack.push(pause);
    pause.cancel();
    expect(stack.depth).toBe(1);
    expect(stack.top?.id).toBe("title");
    // Once popped, the menu no longer drives the stack it left.
    pause.cancel();
    expect(stack.depth).toBe(1);
  });

  it("turns a pushed menu's own keyboard handling off while it is driven by actions", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, { id: "m", rows: rows([]) });
    const plain = new MenuStack();
    plain.push(menu);
    expect(menu.keyboardEnabled).toBe(true);
    plain.pop();

    const driven = new MenuStack({ navigation: createNavigation().source });
    driven.push(menu);
    expect(menu.keyboardEnabled).toBe(false);
    driven.pop();
    expect(menu.keyboardEnabled).toBe(true);
  });

  it("moves the selection on a held direction, with a delay then a repeat", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, { id: "m", rows: rows([]) });
    const navigation = createNavigation();
    const stack = new MenuStack({ navigation: navigation.source, repeatDelay: 0.3, repeatInterval: 0.1 });
    stack.push(menu);
    expect(menu.selected?.id).toBe("a");

    // Positive y is up, and up is towards the top of the list.
    navigation.vector.y = -1;
    stack.update(0.016);
    expect(menu.selected?.id).toBe("b");
    // Held, but not long enough.
    stack.update(0.2);
    expect(menu.selected?.id).toBe("b");
    stack.update(0.2);
    expect(menu.selected?.id).toBe("c");
    stack.update(0.1);
    expect(menu.selected?.id).toBe("a");
    // Released and pressed again: one move, no repeat carried over.
    navigation.vector.y = 0;
    stack.update(0.016);
    navigation.vector.y = 1;
    stack.update(0.016);
    expect(menu.selected?.id).toBe("c");
    // Below the threshold is not a direction at all.
    navigation.vector.y = 0.4;
    stack.update(1);
    expect(menu.selected?.id).toBe("c");
  });

  it("adjusts the selected row on the horizontal axis", () => {
    const { host } = createTestHost();
    let volume = 0.5;
    const menu = new Menu(host, {
      id: "m",
      rows: [
        {
          kind: "slider",
          id: "volume",
          label: "Volume",
          min: 0,
          max: 1,
          step: 0.1,
          get: (): number => volume,
          set: (value: number): void => {
            volume = value;
          },
        },
      ],
    });
    const navigation = createNavigation();
    const stack = new MenuStack({ navigation: navigation.source });
    stack.push(menu);
    navigation.vector.x = 1;
    stack.update(0.016);
    expect(volume).toBeCloseTo(0.6, 10);
    navigation.vector.x = 0;
    stack.update(0.016);
    navigation.vector.x = -1;
    stack.update(0.016);
    expect(volume).toBeCloseTo(0.5, 10);
  });

  it("submits and backs out, and forwards both signals", () => {
    const { host } = createTestHost();
    const runs: string[] = [];
    const activated: string[] = [];
    const moved: string[] = [];
    const menu = new Menu(host, { id: "m", rows: rows(runs) });
    const navigation = createNavigation();
    const stack = new MenuStack({ navigation: navigation.source });
    stack.onActivated.connect((row): void => {
      activated.push(row.id);
    });
    stack.onSelectionChanged.connect((row): void => {
      moved.push(row.id);
    });
    stack.push(menu);

    navigation.vector.y = -1;
    stack.update(0.016);
    navigation.vector.y = 0;
    navigation.flags.submit = true;
    stack.update(0.016);
    expect(runs).toEqual(["b"]);
    expect(activated).toEqual(["b"]);
    expect(moved).toEqual(["b"]);

    navigation.flags.submit = false;
    navigation.flags.back = true;
    stack.update(0.016);
    expect(stack.isOpen).toBe(false);
  });

  it("reads nothing while it is suspended", () => {
    const { host } = createTestHost();
    const runs: string[] = [];
    const menu = new Menu(host, { id: "m", rows: rows(runs) });
    const navigation = createNavigation();
    const stack = new MenuStack({ navigation: navigation.source });
    stack.push(menu);
    stack.suspended = true;
    navigation.vector.y = -1;
    navigation.flags.submit = true;
    stack.update(0.016);
    expect(menu.selected?.id).toBe("a");
    expect(runs).toEqual([]);
    stack.suspended = false;
    // The held direction was released while suspended, so this counts as a fresh press.
    stack.update(0.016);
    expect(menu.selected?.id).toBe("b");
    expect(stack.suspended).toBe(false);
  });

  it("does nothing on update with no navigation source or no menu", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, { id: "m", rows: rows([]) });
    const byHand = new MenuStack();
    byHand.update(0.016);
    byHand.push(menu);
    byHand.update(0.016);
    expect(menu.selected?.id).toBe("a");
  });

  it("refreshes every screen on the stack, which is what a locale change needs", () => {
    const { host } = createTestHost();
    let locale = "en";
    const label = (): string => (locale === "en" ? "Back" : "Retour");
    const under = new Menu(host, { id: "under", rows: [{ kind: "action", id: "a", label }] });
    const over = new Menu(host, { id: "over", rows: [{ kind: "action", id: "a", label }] });
    const stack = new MenuStack();
    stack.push(under);
    stack.push(over);
    locale = "fr";
    stack.refresh();
    for (const menu of [under, over]) {
      const panel = menu.element as unknown as { descendants: () => { textContent: string }[] };
      expect(panel.descendants().some((node) => node.textContent === "Retour")).toBe(true);
    }
  });

  it("drops its subscriptions on dispose without disposing the menus", () => {
    const { host } = createTestHost();
    const menu = new Menu(host, { id: "m", rows: rows([]) });
    const stack = new MenuStack({ navigation: createNavigation().source });
    let changes = 0;
    stack.onChanged.connect((): void => {
      changes += 1;
    });
    stack.push(menu);
    stack.dispose();
    expect(stack.isOpen).toBe(false);
    expect(menu.keyboardEnabled).toBe(true);
    expect(menu.element).not.toBeNull();
    menu.cancel();
    expect(changes).toBe(1);
  });

  it("works with no DOM overlay at all", () => {
    const { host } = createTestHost({ headless: true });
    const runs: string[] = [];
    const menu = new Menu(host, { id: "m", rows: rows(runs) });
    const navigation = createNavigation();
    const stack = new MenuStack({ navigation: navigation.source });
    stack.push(menu);
    navigation.flags.submit = true;
    stack.update(0.016);
    expect(runs).toEqual(["a"]);
    stack.closeAll();
    expect(stack.isOpen).toBe(false);
  });
});
