import { describe, expect, it } from "vitest";
import { UI_CLASS_NAMES } from "../../src/dom/styles.js";
import { Dialog } from "../../src/widgets/dialog.js";
import { LoadingScreen, progressFraction } from "../../src/widgets/loading-screen.js";
import { Toast } from "../../src/widgets/toast.js";
import { createTestHost } from "../support/host.js";
import type { FakeElement } from "../support/fake-dom.js";
import type { AssetProgress, Assets, SignalLike } from "@ignifx/core";

/**
 * The DOM helpers (`docs/architecture/13-ui.md` §3), over the fake DOM.
 */

/**
 * Finds the first descendant of the overlay carrying a class.
 *
 * @param root - The overlay root, as the fake models it.
 * @param className - The class to find.
 * @returns The element, or `undefined`.
 */
function findByClass(root: unknown, className: string): FakeElement | undefined {
  const element = root as FakeElement;
  return element.descendants().find((node: FakeElement): boolean => node.className === className);
}

describe("Dialog", () => {
  it("mounts hidden into the menu layer with a title, a message, and buttons", () => {
    const { host } = createTestHost();
    const dialog = new Dialog(host, {
      title: "Paused",
      message: "The game is paused.",
      buttons: [
        { id: "resume", label: "Resume" },
        { id: "quit", label: "Quit" },
      ],
    });
    expect(dialog.element?.parentElement).toBe(host.layer("menu").element);
    expect(dialog.isVisible).toBe(false);
    expect(dialog.element?.style.getPropertyValue("display")).toBe("none");
    expect(findByClass(dialog.element, UI_CLASS_NAMES.dialogTitle)?.textContent).toBe("Paused");
    expect(findByClass(dialog.element, UI_CLASS_NAMES.dialogMessage)?.textContent).toBe("The game is paused.");
    expect(findByClass(dialog.element, UI_CLASS_NAMES.dialogButtons)?.children).toHaveLength(2);
  });

  it("reports the pressed button's id without hiding itself", () => {
    const { host } = createTestHost();
    const dialog = new Dialog(host, { buttons: [{ id: "resume", label: "Resume" }], visible: true });
    const chosen: string[] = [];
    dialog.onChosen.connect((id: string): void => {
      chosen.push(id);
    });
    const button = findByClass(dialog.element, UI_CLASS_NAMES.dialogButton);
    button?.dispatch("click");
    expect(chosen).toEqual(["resume"]);
    expect(dialog.isVisible).toBe(true);
    expect(button?.dataset["ignifxDialogButton"]).toBe("resume");
  });

  it("shows, hides, and emits onDismissed exactly once per hide", () => {
    const { host } = createTestHost();
    const dialog = new Dialog(host);
    let dismissals = 0;
    dialog.onDismissed.connect((): void => {
      dismissals += 1;
    });
    dialog.show();
    dialog.show();
    expect(dialog.element?.style.getPropertyValue("display")).toBe("flex");
    dialog.hide();
    dialog.hide();
    expect(dismissals).toBe(1);
  });

  it("dismisses on a backdrop press only when asked to", () => {
    const { host } = createTestHost();
    const plain = new Dialog(host, { visible: true });
    findByClass(plain.element, UI_CLASS_NAMES.dialogBackdrop)?.dispatch("pointerdown");
    expect(plain.isVisible).toBe(true);

    const dismissible = new Dialog(host, { visible: true, dismissOnBackdrop: true });
    findByClass(dismissible.element, UI_CLASS_NAMES.dialogBackdrop)?.dispatch("pointerdown");
    expect(dismissible.isVisible).toBe(false);
  });

  it("replaces its title and message", () => {
    const { host } = createTestHost();
    const dialog = new Dialog(host, { title: "a", message: "b" });
    dialog.setTitle("A");
    dialog.setMessage("B");
    expect(findByClass(dialog.element, UI_CLASS_NAMES.dialogTitle)?.textContent).toBe("A");
    expect(findByClass(dialog.element, UI_CLASS_NAMES.dialogMessage)?.textContent).toBe("B");
  });

  it("removes itself and stops responding once disposed", () => {
    const { host } = createTestHost();
    const dialog = new Dialog(host, { buttons: [{ id: "x", label: "X" }], visible: true });
    const button = findByClass(dialog.element, UI_CLASS_NAMES.dialogButton);
    dialog.dispose();
    dialog.dispose();
    dialog.show();
    dialog.hide();
    button?.dispatch("click");
    expect(dialog.element?.parentElement).toBeNull();
  });

  it("is inert under a headless app", () => {
    const { host } = createTestHost({ headless: true });
    const dialog = new Dialog(host, { title: "a", message: "b", buttons: [{ id: "x", label: "X" }] });
    expect(dialog.element).toBeNull();
    dialog.show();
    expect(dialog.isVisible).toBe(true);
    dialog.setTitle("A");
    dialog.setMessage("B");
    dialog.hide();
    dialog.dispose();
  });
});

describe("Toast", () => {
  it("stacks messages and removes them when their time runs out", () => {
    const { host } = createTestHost();
    const toasts = new Toast(host, { duration: 2 });
    const gone: string[] = [];
    toasts.onDismissed.connect((text: string): void => {
      gone.push(text);
    });
    toasts.show("first");
    toasts.show("second", 5);
    expect(toasts.messages).toEqual(["first", "second"]);
    expect(toasts.element?.children).toHaveLength(2);

    toasts.advance(2);
    expect(toasts.messages).toEqual(["second"]);
    expect(gone).toEqual(["first"]);
    toasts.advance(3);
    expect(toasts.messages).toEqual([]);
    expect(toasts.element?.children).toHaveLength(0);
  });

  it("drops the oldest message once the stack is full", () => {
    const { host } = createTestHost();
    const toasts = new Toast(host, { maxVisible: 2 });
    toasts.show("a");
    toasts.show("b");
    toasts.show("c");
    expect(toasts.messages).toEqual(["b", "c"]);
  });

  it("clears every message at once", () => {
    const { host } = createTestHost();
    const toasts = new Toast(host);
    toasts.show("a");
    toasts.show("b");
    toasts.clear();
    expect(toasts.messages).toEqual([]);
  });

  it("removes its stack once disposed and shows nothing after", () => {
    const { host } = createTestHost();
    const toasts = new Toast(host);
    const stack = toasts.element;
    toasts.dispose();
    toasts.dispose();
    toasts.show("ignored");
    expect(toasts.messages).toEqual([]);
    expect(stack?.parentElement).toBeNull();
  });

  it("is inert under a headless app but still tracks its messages", () => {
    const { host } = createTestHost({ headless: true });
    const toasts = new Toast(host, { duration: 1 });
    toasts.show("a");
    expect(toasts.element).toBeNull();
    expect(toasts.messages).toEqual(["a"]);
    toasts.advance(1);
    expect(toasts.messages).toEqual([]);
  });
});

describe("progressFraction", () => {
  it("prefers bytes, falls back to handle counts, and calls an empty batch done", () => {
    expect(progressFraction({ loaded: 1, total: 4, bytesLoaded: 30, bytesTotal: 100 })).toBe(0.3);
    expect(progressFraction({ loaded: 1, total: 4, bytesLoaded: 0, bytesTotal: 0 })).toBe(0.25);
    expect(progressFraction({ loaded: 0, total: 0, bytesLoaded: 0, bytesTotal: 0 })).toBe(1);
  });
});

describe("LoadingScreen", () => {
  it("mounts shown, with a label and a bar at zero", () => {
    const { host } = createTestHost();
    const screen = new LoadingScreen(host, { label: "Loading…" });
    expect(screen.isVisible).toBe(true);
    expect(screen.element?.style.getPropertyValue("display")).toBe("flex");
    expect(findByClass(screen.element, UI_CLASS_NAMES.loadingLabel)?.textContent).toBe("Loading…");
    expect(screen.element?.getAttribute("aria-valuenow")).toBe("0");
  });

  it("clamps the progress it is given and writes the bar's width", () => {
    const { host } = createTestHost();
    const screen = new LoadingScreen(host);
    screen.progress = 0.5;
    expect(findByClass(screen.element, UI_CLASS_NAMES.loadingBar)?.style.getPropertyValue("width")).toBe("50%");
    screen.progress = 5;
    expect(screen.progress).toBe(1);
    screen.progress = 1;
    screen.progress = -1;
    expect(screen.progress).toBe(0);
  });

  it("follows an asset service's aggregate progress until it is unbound", () => {
    const { host } = createTestHost();
    const screen = new LoadingScreen(host);
    const handlers: ((value: AssetProgress) => void)[] = [];
    const assets = {
      onProgress: {
        connect: (handler: (value: AssetProgress) => void): (() => void) => {
          handlers.push(handler);
          return (): void => {
            handlers.splice(handlers.indexOf(handler), 1);
          };
        },
      } as unknown as SignalLike<AssetProgress>,
    } as unknown as Assets;

    const disconnect = screen.bindTo(assets);
    handlers[0]?.({ loaded: 1, total: 4, bytesLoaded: 0, bytesTotal: 0 });
    expect(screen.progress).toBe(0.25);
    screen.bindTo(assets);
    expect(handlers).toHaveLength(1);
    disconnect();
    screen.dispose();
  });

  it("hides, emits onDismissed once, and replaces its label", () => {
    const { host } = createTestHost();
    const screen = new LoadingScreen(host);
    let dismissals = 0;
    screen.onDismissed.connect((): void => {
      dismissals += 1;
    });
    screen.setLabel("Almost there");
    screen.hide();
    screen.hide();
    screen.show();
    screen.show();
    expect(dismissals).toBe(1);
    expect(findByClass(screen.element, UI_CLASS_NAMES.loadingLabel)?.textContent).toBe("Almost there");
  });

  it("removes itself once disposed and does nothing after", () => {
    const { host } = createTestHost();
    const screen = new LoadingScreen(host);
    const element = screen.element;
    screen.dispose();
    screen.dispose();
    screen.show();
    screen.hide();
    expect(element?.parentElement).toBeNull();
  });

  it("is inert under a headless app", () => {
    const { host } = createTestHost({ headless: true });
    const screen = new LoadingScreen(host, { visible: false });
    expect(screen.element).toBeNull();
    screen.progress = 0.5;
    screen.setLabel("x");
    screen.show();
    screen.hide();
    screen.dispose();
    expect(screen.progress).toBe(0.5);
  });
});
