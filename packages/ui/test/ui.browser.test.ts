import { Camera, Vec3 } from "@ignifx/core";
import { defineInputActions, input } from "@ignifx/input";
import { afterEach, describe, expect, it } from "vitest";
import { UI_CLASS_NAMES, UI_CSS_VARIABLES } from "../src/dom/styles.js";
import { Dialog } from "../src/widgets/dialog.js";
import { Menu } from "../src/widgets/menu.js";
import { Toast } from "../src/widgets/toast.js";
import { VirtualButton } from "../src/widgets/virtual-button.js";
import { VirtualJoystick } from "../src/widgets/virtual-joystick.js";
import { WorldAnchor } from "../src/world/world-anchor.js";
import { createUiBrowserApp } from "./support/browser-harness.js";
import type { UiBrowserApp } from "./support/browser-harness.js";

/**
 * The Chromium half of the UI suite: a real overlay over a real WebGPU canvas
 * (`docs/architecture/13-ui.md` §1-§3).
 *
 * Two of Phase 8's exit criteria live here — *"focus routing test (typing in a field does not fire
 * actions)"* and *"anchor placement visual test"* — and both are asserted as arithmetic rather than
 * against a stored image, so they cannot rot with a font update or a driver change.
 */

let harness: UiBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * The action document the focus test binds.
 *
 * @returns The definition.
 */
function focusActions(): ReturnType<typeof defineInputActions> {
  return defineInputActions({
    controlSchemes: [{ name: "KeyboardMouse", devices: ["Keyboard", "Mouse"] }],
    maps: [
      {
        name: "Player",
        actions: [
          { name: "jump", type: "button", bindings: [{ path: "<Keyboard>/space" }] },
          { name: "touchJump", type: "button", bindings: [{ path: "<Virtual>/jump" }] },
          { name: "move", type: "vector2", bindings: [{ path: "<Virtual>/joystick" }] },
        ],
      },
    ],
  });
}

describe("the overlay host", () => {
  it("mounts a click-through root over the canvas", async () => {
    const running = await createUiBrowserApp({ width: 200, height: 120 });
    harness = running;
    const root = running.app.ui.root;
    expect(root).toBeInstanceOf(HTMLDivElement);
    expect(running.canvas.nextElementSibling).toBe(root);
    expect(root === null ? "" : getComputedStyle(root).pointerEvents).toBe("none");

    const canvasRect = running.canvas.getBoundingClientRect();
    const rootRect = (root as HTMLDivElement).getBoundingClientRect();
    expect(rootRect.left).toBeCloseTo(canvasRect.left, 1);
    expect(rootRect.top).toBeCloseTo(canvasRect.top, 1);
    expect(rootRect.width).toBeCloseTo(canvasRect.width, 1);
  });

  it("stacks its layers by z-index and lets a child opt back into pointer events", async () => {
    const running = await createUiBrowserApp({ options: { layers: ["hud", "menu"] } });
    harness = running;
    const hud = running.app.ui.layer("hud").element;
    const menu = running.app.ui.layer("menu").element;
    expect(hud === null ? "" : getComputedStyle(hud).zIndex).toBe("10");
    expect(menu === null ? "" : getComputedStyle(menu).zIndex).toBe("20");
    expect(hud === null ? "" : getComputedStyle(hud).pointerEvents).toBe("none");

    const button = document.createElement("button");
    button.className = UI_CLASS_NAMES.interactive;
    hud?.append(button);
    expect(getComputedStyle(button).pointerEvents).toBe("auto");
  });

  it("exposes the safe-area insets as resolved custom properties", async () => {
    const running = await createUiBrowserApp();
    harness = running;
    const root = running.app.ui.root;
    const value = root === null ? "" : getComputedStyle(root).getPropertyValue(UI_CSS_VARIABLES.safeTop).trim();
    // A desktop Chromium resolves `env(safe-area-inset-top, 0px)` to the fallback.
    expect(value).toBe("0px");
  });

  it('letterboxes in "fit" mode and follows a canvas resize', async () => {
    const running = await createUiBrowserApp({
      width: 400,
      height: 300,
      options: { scaling: "fit", referenceResolution: [200, 100] },
    });
    harness = running;
    expect(running.app.ui.layout.scale).toBe(2);
    expect(running.app.ui.layout.offsetY).toBe(50);

    running.canvas.style.width = "200px";
    running.canvas.style.height = "200px";
    await running.advance(3);
    expect(running.app.ui.layout.scale).toBe(1);
    expect(running.app.ui.layout.offsetY).toBe(50);
  });

  it("hides the whole overlay and one layer independently", async () => {
    const running = await createUiBrowserApp({ options: { layers: ["hud"] } });
    harness = running;
    const hud = running.app.ui.layer("hud");
    hud.visible = false;
    expect(hud.element === null ? "" : getComputedStyle(hud.element).display).toBe("none");
    hud.visible = true;
    running.app.ui.visible = false;
    const root = running.app.ui.root;
    expect(root === null ? "" : getComputedStyle(root).display).toBe("none");
  });
});

describe("focus routing", () => {
  it("stops keyboard actions while a field in a layer has focus, and lets them fire again on blur", async () => {
    const running = await createUiBrowserApp({ extensions: [input()], options: { layers: ["hud"] } });
    harness = running;
    running.app.input.loadActions(focusActions());
    await running.advance(2);

    const field = document.createElement("input");
    field.type = "text";
    field.className = UI_CLASS_NAMES.interactive;
    running.app.ui.layer("hud").element?.append(field);

    field.focus();
    await running.advance(2);
    expect(running.app.ui.keyboardHasFocus).toBe(true);
    expect(running.app.input.uiHasFocus).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    await running.advance(2);
    expect(running.app.input.actions.get("jump").wasPressedThisFrame).toBe(false);
    expect(running.app.input.actions.get("jump").isPressed).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    await running.advance(2);

    field.blur();
    await running.advance(2);
    expect(running.app.input.uiHasFocus).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    await running.advance(4);
    expect(running.app.input.actions.get("jump").isPressed).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
  }, 60_000);

  it("leaves the keyboard alone when a plain button in a layer takes focus", async () => {
    const running = await createUiBrowserApp({ extensions: [input()], options: { layers: ["hud"] } });
    harness = running;
    const button = document.createElement("button");
    running.app.ui.layer("hud").element?.append(button);
    button.focus();
    await running.advance(2);
    expect(running.app.input.uiHasFocus).toBe(false);
  }, 60_000);
});

describe("WorldAnchor", () => {
  it("puts an 8x8 element over the projected point, within one CSS pixel", async () => {
    const running = await createUiBrowserApp({ width: 256, height: 256, options: { layers: ["hud"] } });
    harness = running;
    const eye = running.app.world.createEntity("camera");
    eye.transform.localPosition.set(0, 0, -6);
    eye.addComponent(Camera, { near: 0.1, far: 100 });

    const marker = document.createElement("div");
    marker.style.width = "8px";
    marker.style.height = "8px";
    marker.style.background = "#f00";
    running.app.ui.layer("hud").element?.append(marker);

    const target = running.app.world.createEntity("target");
    target.transform.localPosition.set(0.7, 0.4, 0);
    const anchor = target.addComponent(WorldAnchor);
    anchor.element = marker;
    await running.advance(3);

    const camera = running.app.world.mainCamera;
    expect(camera).not.toBeNull();
    const projected = new Vec3();
    const inFront = camera?.worldToScreen({ x: 0.7, y: 0.4, z: 0 }, projected) ?? false;
    expect(inFront).toBe(true);

    const canvasRect = running.canvas.getBoundingClientRect();
    const cssPerDeviceX = canvasRect.width / running.canvas.width;
    const cssPerDeviceY = canvasRect.height / running.canvas.height;
    const expectedX = canvasRect.left + projected.x * cssPerDeviceX;
    const expectedY = canvasRect.top + projected.y * cssPerDeviceY;

    const markerRect = marker.getBoundingClientRect();
    expect(markerRect.left + markerRect.width / 2).toBeCloseTo(expectedX, 0);
    expect(markerRect.top + markerRect.height / 2).toBeCloseTo(expectedY, 0);
    expect(Math.abs(markerRect.left + markerRect.width / 2 - expectedX)).toBeLessThanOrEqual(1);
    expect(Math.abs(markerRect.top + markerRect.height / 2 - expectedY)).toBeLessThanOrEqual(1);
  }, 60_000);

  it("hides the element when the entity moves behind the camera", async () => {
    const running = await createUiBrowserApp({ width: 128, height: 128, options: { layers: ["hud"] } });
    harness = running;
    const eye = running.app.world.createEntity("camera");
    eye.transform.localPosition.set(0, 0, -6);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    const marker = document.createElement("div");
    marker.style.width = "8px";
    marker.style.height = "8px";
    running.app.ui.layer("hud").element?.append(marker);
    const target = running.app.world.createEntity("target");
    const anchor = target.addComponent(WorldAnchor);
    anchor.element = marker;
    await running.advance(3);
    expect(getComputedStyle(marker).display).toBe("block");

    target.transform.localPosition.set(0, 0, -20);
    await running.advance(3);
    expect(getComputedStyle(marker).display).toBe("none");
  }, 60_000);
});

describe("the touch widgets", () => {
  it("drives a virtual vector control from a real pointer sequence", async () => {
    const running = await createUiBrowserApp({
      width: 256,
      height: 256,
      extensions: [input()],
      options: { layers: ["hud"] },
    });
    harness = running;
    running.app.input.loadActions(focusActions());
    await running.advance(2);

    const stick = new VirtualJoystick(running.app, { radius: 40, deadZone: 0 });
    const pad = stick.element;
    expect(pad).not.toBeNull();
    if (pad === null) {
      return;
    }
    pad.style.position = "absolute";
    pad.style.left = "0px";
    pad.style.top = "0px";
    pad.style.width = "80px";
    pad.style.height = "80px";
    await running.advance(1);

    const box = pad.getBoundingClientRect();
    const centreX = box.left + box.width / 2;
    const centreY = box.top + box.height / 2;
    pad.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, clientX: centreX, clientY: centreY, bubbles: true }),
    );
    pad.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: centreX + 40, clientY: centreY, bubbles: true }),
    );
    await running.advance(2);
    expect(running.app.input.actions.get("move").vector.x).toBeCloseTo(1, 2);

    pad.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    await running.advance(2);
    expect(running.app.input.actions.get("move").vector.x).toBe(0);
    stick.dispose();
  }, 60_000);

  it("drives a virtual button control, and its press never reaches the canvas", async () => {
    const running = await createUiBrowserApp({
      width: 256,
      height: 256,
      extensions: [input()],
      options: { layers: ["hud"] },
    });
    harness = running;
    running.app.input.loadActions(focusActions());
    await running.advance(2);

    let canvasPresses = 0;
    running.canvas.addEventListener("pointerdown", () => {
      canvasPresses += 1;
    });

    const button = new VirtualButton(running.app, { control: "jump", label: "A" });
    const element = button.element;
    expect(element).not.toBeNull();
    element?.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, bubbles: true }));
    await running.advance(2);
    expect(running.app.input.actions.get("touchJump").isPressed).toBe(true);
    expect(canvasPresses).toBe(0);
    expect(running.app.ui.pointerOverUi).toBe(true);

    element?.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2 }));
    await running.advance(2);
    expect(running.app.input.actions.get("touchJump").isPressed).toBe(false);
    expect(running.app.ui.pointerOverUi).toBe(false);
    button.dispose();
  }, 60_000);
});

describe("the dialog helpers", () => {
  it("mounts a dialog hidden, shows it, reports the button, and dismisses", async () => {
    const running = await createUiBrowserApp({ options: { layers: ["hud", "menu"] } });
    harness = running;
    const dialog = new Dialog(running.app.ui, {
      title: "Paused",
      buttons: [{ id: "resume", label: "Resume" }],
    });
    const element = dialog.element;
    expect(element).not.toBeNull();
    expect(element === null ? "" : getComputedStyle(element).display).toBe("none");

    dialog.show();
    running.app.pause();
    expect(running.app.time.paused).toBe(true);
    expect(element === null ? "" : getComputedStyle(element).display).toBe("flex");

    const chosen: string[] = [];
    dialog.onChosen.connect((id: string): void => {
      chosen.push(id);
    });
    let dismissed = false;
    dialog.onDismissed.connect((): void => {
      dismissed = true;
    });
    element?.querySelector("button")?.click();
    dialog.hide();
    running.app.resume();
    expect(chosen).toEqual(["resume"]);
    expect(dismissed).toBe(true);
    expect(running.app.time.paused).toBe(false);
    dialog.dispose();
    expect(element?.isConnected).toBe(false);
  });

  it("stacks toasts and removes them on the game clock", async () => {
    const running = await createUiBrowserApp({ options: { layers: ["overlay"] } });
    harness = running;
    const toasts = new Toast(running.app.ui, { duration: 1 });
    toasts.show("Checkpoint");
    expect(toasts.element?.children).toHaveLength(1);
    expect(toasts.element?.textContent).toContain("Checkpoint");
    toasts.advance(1);
    expect(toasts.element?.children).toHaveLength(0);
    toasts.dispose();
  });
});

describe("the menu widget", () => {
  it("shows, takes focus, and is driven by real key events", async () => {
    const running = await createUiBrowserApp({ options: { layers: ["hud", "menu"] } });
    harness = running;
    let volume = 0.5;
    const runs: string[] = [];
    const menu = new Menu(running.app.ui, {
      id: "pause",
      title: "Paused",
      rows: [
        { kind: "action", id: "resume", label: "Resume", activate: (): void => void runs.push("resume") },
        {
          kind: "slider",
          id: "music",
          label: "Music",
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
    const panel = menu.element;
    expect(panel).not.toBeNull();
    // `hidden` really hides it: the package rule is `.ignifx-ui-menu[hidden]`, which outranks the
    // single-class rule a game writes.
    expect(panel === null ? "" : getComputedStyle(panel).display).toBe("none");

    menu.show();
    expect(panel === null ? "" : getComputedStyle(panel).display).not.toBe("none");
    const list = panel?.querySelector(`.${UI_CLASS_NAMES.menuRows}`);
    expect(document.activeElement).toBe(list);
    // A focused list is not a text field, so gameplay input keeps flowing.
    expect(running.app.ui.keyboardHasFocus).toBe(false);

    list?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(menu.selected?.id).toBe("music");
    list?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(volume).toBeCloseTo(0.6, 10);

    let backs = 0;
    menu.onBack.connect((): void => {
      backs += 1;
    });
    list?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(backs).toBe(1);

    // The pointer path: a click on a row runs it.
    panel?.querySelector<HTMLElement>('[data-row="resume"]')?.click();
    expect(runs).toEqual(["resume"]);

    // The range input carries the drag back, snapped to the step.
    const slider = panel?.querySelector<HTMLInputElement>(`.${UI_CLASS_NAMES.menuRowSlider}`);
    expect(slider?.type).toBe("range");
    if (slider !== null && slider !== undefined) {
      slider.value = "0.83";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(volume).toBeCloseTo(0.8, 10);

    menu.dispose();
    expect(panel?.isConnected).toBe(false);
  }, 60_000);

  it("lets a page stylesheet of equal specificity win, because the package rules go first", async () => {
    const sheet = document.createElement("style");
    sheet.textContent = `.${UI_CLASS_NAMES.menuRow}{color:rgb(1, 2, 3);}`;
    document.head.append(sheet);
    try {
      const running = await createUiBrowserApp({ options: { layers: ["menu"] } });
      harness = running;
      const menu = new Menu(running.app.ui, { id: "m", rows: [{ kind: "action", id: "a", label: "A" }] });
      menu.show();
      const rowElement = menu.element?.querySelector<HTMLElement>('[data-row="a"]');
      expect(rowElement === null || rowElement === undefined ? "" : getComputedStyle(rowElement).color).toBe(
        "rgb(1, 2, 3)",
      );
      menu.dispose();
    } finally {
      sheet.remove();
    }
  }, 60_000);

  it("draws a dialog above a menu built after it in the same layer", async () => {
    const running = await createUiBrowserApp({ options: { layers: ["hud", "menu"] } });
    harness = running;
    // Built first, so with no stacking rule it would paint underneath and swallow every click.
    const dialog = new Dialog(running.app.ui, { title: "Sure?", buttons: [{ id: "yes", label: "Yes" }] });
    const menu = new Menu(running.app.ui, {
      id: "settings",
      title: "Settings",
      rows: [{ kind: "action", id: "delete", label: "Delete save" }],
    });
    menu.show();
    dialog.show();
    const root = dialog.element;
    expect(root === null ? "" : getComputedStyle(root).zIndex).toBe("1000");

    const panel = root?.querySelector(`.${UI_CLASS_NAMES.dialogPanel}`);
    const rect = panel?.getBoundingClientRect();
    const hit =
      rect === undefined ? null : document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(hit === null ? false : root?.contains(hit)).toBe(true);

    dialog.dispose();
    menu.dispose();
  }, 60_000);
});
