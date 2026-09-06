import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { UI_CLASS_NAMES } from "../../src/dom/styles.js";
import { UiErrorCode } from "../../src/errors.js";
import { VirtualButton } from "../../src/widgets/virtual-button.js";
import { findVirtualDevice } from "../../src/widgets/virtual-device.js";
import { stickAxis, VirtualJoystick } from "../../src/widgets/virtual-joystick.js";
import { createTestHost } from "../support/host.js";
import type { UiHost } from "../../src/dom/host.js";
import type { FakeElement } from "../support/fake-dom.js";
import type { App } from "@ignifx/core";

/**
 * The touch widgets (`docs/architecture/13-ui.md` §3, `08-input.md` §8). `@ignifx/input` is an
 * optional peer that this package never imports, so the device is a recording double here and the
 * real one only in the Chromium suite.
 */

/** Every write the widgets made, in order. */
interface Recorder {
  /** `set` calls, as `name=value`. */
  readonly scalars: string[];
  /** `setVector` calls, as `name=x,y`. */
  readonly vectors: string[];
}

/**
 * Builds an app stand-in carrying a host and a recording virtual device.
 *
 * @param host - The overlay host.
 * @param withInput - Whether the stand-in has an input extension at all.
 * @returns The app and the recorder.
 */
function createApp(host: UiHost, withInput = true): { app: App; recorder: Recorder } {
  const recorder: Recorder = { scalars: [], vectors: [] };
  const device = {
    set: (name: string, value: number): void => {
      recorder.scalars.push(`${name}=${String(value)}`);
    },
    setVector: (name: string, x: number, y: number): void => {
      recorder.vectors.push(`${name}=${x.toFixed(3)},${y.toFixed(3)}`);
    },
  };
  const app = { ui: host, ...(withInput ? { input: { devices: { virtual: device } } } : {}) } as unknown as App;
  return { app, recorder };
}

/**
 * Finds the first descendant carrying a class.
 *
 * @param root - The element to search under.
 * @param className - The class to find.
 * @returns The element, or `undefined`.
 */
function findByClass(root: unknown, className: string): FakeElement | undefined {
  return (root as FakeElement).descendants().find((node: FakeElement): boolean => node.className === className);
}

describe("stickAxis", () => {
  it("reads zero inside the dead zone and one at full deflection", () => {
    expect(stickAxis(0, 0, 44, 0.15)).toBe(0);
    expect(stickAxis(4, 4, 44, 0.15)).toBe(0);
    expect(stickAxis(44, 44, 44, 0.15)).toBeCloseTo(1, 10);
    expect(stickAxis(-44, 44, 44, 0.15)).toBeCloseTo(-1, 10);
  });

  it("rescales so the value leaves the dead zone at zero", () => {
    const justOutside = stickAxis(44 * 0.16, 44 * 0.16, 44, 0.15);
    expect(justOutside).toBeGreaterThan(0);
    expect(justOutside).toBeLessThan(0.02);
  });

  it("saturates beyond the radius and refuses a zero radius", () => {
    expect(stickAxis(100, 100, 44, 0)).toBeCloseTo(1, 10);
    expect(stickAxis(1, 1, 0, 0.15)).toBe(0);
  });
});

describe("findVirtualDevice", () => {
  it("finds the device, and reports its absence rather than guessing", () => {
    const { host } = createTestHost();
    expect(findVirtualDevice(createApp(host).app)).not.toBeNull();
    expect(findVirtualDevice(createApp(host, false).app)).toBeNull();
    expect(findVirtualDevice({ input: null } as unknown as App)).toBeNull();
    expect(findVirtualDevice({ input: { devices: null } } as unknown as App)).toBeNull();
    expect(findVirtualDevice({ input: { devices: { virtual: {} } } } as unknown as App)).toBeNull();
  });
});

describe("VirtualJoystick", () => {
  it("refuses to build without the input extension", () => {
    const { host } = createTestHost();
    let code: string | null = null;
    try {
      const stick = new VirtualJoystick(createApp(host, false).app);
      stick.dispose();
    } catch (error: unknown) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe(UiErrorCode.inputExtensionMissing);
  });

  it("mounts a pad in the hud layer and centres its control", () => {
    const { host } = createTestHost();
    const { app, recorder } = createApp(host);
    const stick = new VirtualJoystick(app, { style: { left: "2rem" } });
    expect(stick.element?.parentElement).toBe(host.layer("hud").element);
    expect(stick.control).toBe("joystick");
    expect(stick.element?.style.getPropertyValue("left")).toBe("2rem");
    expect(recorder.vectors).toEqual(["joystick=0.000,0.000"]);
  });

  it("writes the deflection on a pointer drag and negates the vertical axis", () => {
    const { host } = createTestHost();
    const { app, recorder } = createApp(host);
    const stick = new VirtualJoystick(app, { radius: 40, deadZone: 0 });
    const pad = stick.element as unknown as FakeElement;
    pad.rect = { left: 0, top: 0, width: 80, height: 80 };
    // Centre is (40, 40); dragging up-right by 40 px reads as (+1, +1) after normalisation.
    pad.dispatch("pointerdown", { pointerId: 3, clientX: 40, clientY: 40 });
    expect(stick.isActive).toBe(true);
    expect(pad.pointerCaptures).toEqual([3]);
    pad.dispatch("pointermove", { pointerId: 3, clientX: 80, clientY: 40 });
    expect(recorder.vectors.at(-1)).toBe("joystick=1.000,0.000");
    pad.dispatch("pointermove", { pointerId: 3, clientX: 40, clientY: 0 });
    expect(recorder.vectors.at(-1)).toBe("joystick=0.000,1.000");
    pad.dispatch("pointermove", { pointerId: 3, clientX: 40, clientY: 80 });
    expect(recorder.vectors.at(-1)).toBe("joystick=0.000,-1.000");
  });

  it("ignores a second pointer while one holds the stick", () => {
    const { host } = createTestHost();
    const { app, recorder } = createApp(host);
    const stick = new VirtualJoystick(app, { radius: 40, deadZone: 0 });
    const pad = stick.element as unknown as FakeElement;
    pad.rect = { left: 0, top: 0, width: 80, height: 80 };
    pad.dispatch("pointerdown", { pointerId: 1, clientX: 40, clientY: 40 });
    pad.dispatch("pointerdown", { pointerId: 2, clientX: 80, clientY: 40 });
    pad.dispatch("pointermove", { pointerId: 2, clientX: 80, clientY: 40 });
    expect(recorder.vectors.at(-1)).toBe("joystick=0.000,0.000");
  });

  it("recentres on pointerup and on pointercancel", () => {
    const { host } = createTestHost();
    const { app, recorder } = createApp(host);
    const stick = new VirtualJoystick(app, { radius: 40, deadZone: 0 });
    const pad = stick.element as unknown as FakeElement;
    pad.rect = { left: 0, top: 0, width: 80, height: 80 };
    pad.dispatch("pointerdown", { pointerId: 1, clientX: 80, clientY: 40 });
    pad.dispatch("pointerup", { pointerId: 1 });
    expect(stick.isActive).toBe(false);
    expect(recorder.vectors.at(-1)).toBe("joystick=0.000,0.000");

    pad.dispatch("pointerdown", { pointerId: 2, clientX: 80, clientY: 40 });
    pad.dispatch("pointercancel", { pointerId: 2 });
    expect(recorder.vectors.at(-1)).toBe("joystick=0.000,0.000");
    pad.dispatch("pointerup", { pointerId: 99 });
    expect(recorder.vectors.at(-1)).toBe("joystick=0.000,0.000");
  });

  it("moves its knob so the player sees the deflection", () => {
    const { host } = createTestHost();
    const stick = new VirtualJoystick(createApp(host).app, { radius: 40, deadZone: 0 });
    const pad = stick.element as unknown as FakeElement;
    pad.rect = { left: 0, top: 0, width: 80, height: 80 };
    pad.dispatch("pointerdown", { pointerId: 1, clientX: 60, clientY: 40 });
    expect(findByClass(pad, UI_CLASS_NAMES.joystickKnob)?.style.getPropertyValue("transform")).toBe(
      "translate(20px, 0px)",
    );
  });

  it("removes itself and centres the control once disposed", () => {
    const { host } = createTestHost();
    const { app, recorder } = createApp(host);
    const stick = new VirtualJoystick(app);
    const pad = stick.element;
    stick.dispose();
    stick.dispose();
    expect(pad?.parentElement).toBeNull();
    expect(recorder.vectors).toHaveLength(2);
  });

  it("is inert under a headless app", () => {
    const { host } = createTestHost({ headless: true });
    const stick = new VirtualJoystick(createApp(host).app);
    expect(stick.element).toBeNull();
    expect(stick.isActive).toBe(false);
    stick.dispose();
  });
});

describe("VirtualButton", () => {
  it("mounts a real button and writes one and zero", () => {
    const { host } = createTestHost();
    const { app, recorder } = createApp(host);
    const button = new VirtualButton(app, { control: "jump", label: "A", style: { right: "1rem" } });
    const element = button.element as unknown as FakeElement;
    expect(element.tagName).toBe("BUTTON");
    expect(element.textContent).toBe("A");
    expect(element.getAttribute("aria-label")).toBe("jump");
    expect(button.control).toBe("jump");

    element.dispatch("pointerdown", { pointerId: 1 });
    expect(button.isPressed).toBe(true);
    expect(recorder.scalars.at(-1)).toBe("jump=1");
    element.dispatch("pointerdown", { pointerId: 1 });
    expect(recorder.scalars.filter((call) => call === "jump=1")).toHaveLength(1);
    element.dispatch("pointerup", { pointerId: 1 });
    expect(recorder.scalars.at(-1)).toBe("jump=0");
  });

  it("releases on blur, so a keyboard press cannot stick", () => {
    const { host } = createTestHost();
    const { app, recorder } = createApp(host);
    const button = new VirtualButton(app, { control: "jump" });
    const element = button.element as unknown as FakeElement;
    element.dispatch("pointerdown", { pointerId: 1 });
    element.dispatch("blur");
    expect(button.isPressed).toBe(false);
    expect(recorder.scalars.at(-1)).toBe("jump=0");
  });

  it("labels itself with the control name when no label is given", () => {
    const { host } = createTestHost();
    const button = new VirtualButton(createApp(host).app, { control: "interact" });
    expect(button.element?.textContent).toBe("interact");
  });

  it("refuses to build without the input extension", () => {
    const { host } = createTestHost();
    let code: string | null = null;
    try {
      const button = new VirtualButton(createApp(host, false).app, { control: "jump" });
      button.dispose();
    } catch (error: unknown) {
      code = isIgnifxError(error) ? error.code : null;
    }
    expect(code).toBe(UiErrorCode.inputExtensionMissing);
  });

  it("removes itself and releases the control once disposed", () => {
    const { host } = createTestHost();
    const { app, recorder } = createApp(host);
    const button = new VirtualButton(app, { control: "jump" });
    const element = button.element;
    button.dispose();
    button.dispose();
    expect(element?.parentElement).toBeNull();
    expect(recorder.scalars).toEqual(["jump=0", "jump=0"]);
  });

  it("is inert under a headless app", () => {
    const { host } = createTestHost({ headless: true });
    const button = new VirtualButton(createApp(host).app, { control: "jump" });
    expect(button.element).toBeNull();
    expect(button.isPressed).toBe(false);
    button.dispose();
  });
});
