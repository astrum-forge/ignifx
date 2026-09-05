import { afterEach, describe, expect, it } from "vitest";
import { defineInputActions } from "../../src/index.js";
import { createInputApp, demoActions } from "../support/app.js";
import type { GamepadLike } from "../../src/index.js";
import type { InputAppHarness } from "../support/app.js";

/** A reader that fails the test if the poll ever reaches it. */
function refusingReader(): readonly (GamepadLike | null)[] {
  throw new Error("must not poll");
}

let harness: InputAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Builds a headless app with the demo document installed. */
async function withDemo(): Promise<InputAppHarness> {
  const built = await createInputApp();
  built.app.input.loadActions(demoActions());
  harness = built;
  return built;
}

describe("simulated input", () => {
  it("holds a simulated value until it is changed again", async () => {
    const { app, step } = await withDemo();
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    step();
    expect(app.input.actions.get("jump").isPressed).toBe(true);
    app.input.simulate({ "<Keyboard>/space": 0 });
    step();
    expect(app.input.actions.get("jump").isPressed).toBe(false);
  });

  it("accepts booleans, numbers, and vectors", async () => {
    const { app, step } = await withDemo();
    app.input.simulate({ "<Keyboard>/space": true, "<Gamepad>/leftStick": { x: 0.5, y: -0.5 } });
    step();
    expect(app.input.actions.get("jump").isPressed).toBe(true);
    expect(app.input.actions.get("move").vector.x).toBeGreaterThan(0);
  });

  it("connects a gamepad slot that a simulated path names", async () => {
    const { app } = await withDemo();
    expect(app.input.gamepads[0]?.isConnected).toBe(false);
    app.input.simulate({ "<Gamepad>/buttonSouth": 1 });
    expect(app.input.gamepads[0]?.isConnected).toBe(true);
  });

  it("drives a raw event through the same pipeline", async () => {
    const { app, step } = await withDemo();
    app.input.simulateEvent({ type: "pointermove", x: 12, y: 34, deltaX: 5, deltaY: -5 });
    step();
    expect(app.input.devices.mouse.valueAt(app.input.devices.mouse.control("position")?.offset ?? 0)).toBe(12);
    expect(app.input.actions.get("look").vector.x).toBeCloseTo(0.5, 6);
  });

  it("writes mouse buttons from pointer events", async () => {
    const { app, step } = await withDemo();
    app.input.simulateEvent({ type: "pointerdown", button: 2, x: 1, y: 1 });
    step();
    const right = app.input.devices.mouse.control("rightButton");
    expect(right).not.toBeNull();
    if (right !== null) {
      expect(app.input.devices.mouse.valueAt(right.offset)).toBe(1);
    }
    app.input.simulateEvent({ type: "pointerup", button: 2, x: 1, y: 1 });
    step();
    if (right !== null) {
      expect(app.input.devices.mouse.valueAt(right.offset)).toBe(0);
    }
  });

  it("accumulates wheel deltas and clears them next frame", async () => {
    const { app, step } = await withDemo();
    app.input.simulateEvent({ type: "wheel", deltaY: 3 });
    app.input.simulateEvent({ type: "wheel", deltaY: 4 });
    step();
    const scroll = app.input.devices.mouse.control("scroll");
    expect(scroll).not.toBeNull();
    if (scroll !== null) {
      expect(app.input.devices.mouse.valueAt(scroll.offset + 1)).toBe(7);
      step();
      expect(app.input.devices.mouse.valueAt(scroll.offset + 1)).toBe(0);
    }
  });

  it("routes touch pointers into slots and counts them", async () => {
    const { app, step } = await withDemo();
    app.input.simulateEvent({ type: "pointerdown", pointerType: "touch", pointerId: 7, x: 5, y: 6 });
    app.input.simulateEvent({ type: "pointerdown", pointerType: "touch", pointerId: 8, x: 9, y: 9 });
    step();
    const touch = app.input.devices.touch;
    expect(touch.valueAt(touch.control("touchCount")?.offset ?? 0)).toBe(2);
    expect(touch.valueAt(touch.control("touch0/press")?.offset ?? 0)).toBe(1);
    expect(touch.valueAt(touch.control("primaryTouch/position")?.offset ?? 0)).toBe(5);
    app.input.simulateEvent({ type: "pointerup", pointerType: "touch", pointerId: 7, x: 5, y: 6 });
    step();
    expect(touch.valueAt(touch.control("touchCount")?.offset ?? 0)).toBe(1);
  });

  it("tracks anyKey while any key is held", async () => {
    const { app, step } = await withDemo();
    const anyKey = app.input.devices.keyboard.control("anyKey");
    expect(anyKey).not.toBeNull();
    if (anyKey === null) {
      return;
    }
    app.input.simulateEvent({ type: "keydown", code: "w" });
    app.input.simulateEvent({ type: "keydown", code: "a" });
    step();
    expect(app.input.devices.keyboard.valueAt(anyKey.offset)).toBe(1);
    app.input.simulateEvent({ type: "keyup", code: "w" });
    step();
    expect(app.input.devices.keyboard.valueAt(anyKey.offset)).toBe(1);
    app.input.simulateEvent({ type: "keyup", code: "a" });
    step();
    expect(app.input.devices.keyboard.valueAt(anyKey.offset)).toBe(0);
  });

  it("ignores a key event whose code names no control", async () => {
    const { app, step } = await withDemo();
    app.input.simulateEvent({ type: "keydown", code: "" });
    app.input.simulateEvent({ type: "keydown", code: "hyperspace" });
    step();
    expect(app.input.events).toHaveLength(2);
  });
});

describe("the raw event stream", () => {
  it("publishes the frame's events in arrival order", async () => {
    const { app, step } = await withDemo();
    app.input.simulateEvent({ type: "keydown", code: "space", key: " " });
    app.input.simulateEvent({ type: "pointermove", x: 3, y: 4 });
    step();
    expect(app.input.events.map((event) => event.type)).toEqual(["keydown", "pointermove"]);
    expect(app.input.events[0]?.key).toBe(" ");
    expect(app.input.events[1]?.x).toBe(3);
    expect(app.input.events[0]?.sequence).toBeLessThan(app.input.events[1]?.sequence ?? 0);
  });

  it("clears the list on the next frame", async () => {
    const { app, step } = await withDemo();
    app.input.simulateEvent({ type: "keydown", code: "space" });
    step();
    expect(app.input.events).toHaveLength(1);
    step();
    expect(app.input.events).toHaveLength(0);
  });

  it("does not publish simulated control writes or focus releases", async () => {
    const { app, step } = await withDemo();
    app.input.simulate({ "<Keyboard>/space": 1 });
    step();
    expect(app.input.events).toHaveLength(0);
  });

  it("stabilises its record pool over hundreds of frames", async () => {
    const { app, step } = await withDemo();
    for (let frame = 0; frame < 20; frame += 1) {
      app.input.simulateEvent({ type: "pointermove", x: frame, y: frame });
      app.input.simulateEvent({ type: "keydown", code: "space" });
      app.input.simulateEvent({ type: "keyup", code: "space" });
      step();
    }
    const settled = app.input.eventPoolSize;
    for (let frame = 0; frame < 600; frame += 1) {
      app.input.simulateEvent({ type: "pointermove", x: frame, y: frame });
      app.input.simulateEvent({ type: "keydown", code: "space" });
      app.input.simulateEvent({ type: "keyup", code: "space" });
      step();
    }
    expect(app.input.eventPoolSize).toBe(settled);
    expect(settled).toBeGreaterThan(0);
  });
});

describe("control schemes", () => {
  it("starts on the first declared scheme", async () => {
    const { app } = await withDemo();
    expect(app.input.currentScheme).toBe("KeyboardMouse");
    expect(app.input.controlSchemes).toHaveLength(3);
  });

  it("switches to the scheme of the device that produced input last", async () => {
    const built = await withDemo();
    const seen: string[] = [];
    built.app.input.onControlSchemeChanged.connect((scheme: string) => seen.push(scheme));
    built.app.input.simulateEvent({ type: "pointerdown", pointerType: "touch", pointerId: 1 });
    built.step();
    expect(built.app.input.currentScheme).toBe("Touch");
    built.app.input.simulateEvent({ type: "keydown", code: "space" });
    built.step();
    expect(built.app.input.currentScheme).toBe("KeyboardMouse");
    expect(seen).toEqual(["Touch", "KeyboardMouse"]);
  });

  it("switches to Gamepad when a polled pad is actuated", async () => {
    let pressed = 0;
    const reader = (): readonly (GamepadLike | null)[] => [
      {
        id: "Standard",
        mapping: "standard",
        connected: true,
        buttons: Array.from({ length: 18 }, (_unused, index) => (index === 0 ? pressed : 0)).map((value) => ({
          value,
        })),
        axes: [0, 0, 0, 0],
      },
      null,
      null,
      null,
    ];
    const built = await createInputApp({ options: { gamepadReader: reader } });
    harness = built;
    built.app.input.loadActions(demoActions());
    built.step();
    expect(built.app.input.currentScheme).toBe("KeyboardMouse");
    pressed = 1;
    built.step();
    expect(built.app.input.currentScheme).toBe("Gamepad");
  });

  it("still resolves a binding tagged with another scheme by default", async () => {
    const { app, step } = await withDemo();
    app.input.simulateEvent({ type: "keydown", code: "space" });
    step();
    expect(app.input.currentScheme).toBe("KeyboardMouse");
    app.input.simulate({ "<Gamepad>/leftStick": { x: 1, y: 0 } });
    step();
    expect(app.input.actions.get("move").vector.x).toBeGreaterThan(0.9);
  });

  it("filters bindings by scheme when strictSchemes is on", async () => {
    const built = await createInputApp({ options: { strictSchemes: true } });
    harness = built;
    built.app.input.loadActions(demoActions());
    built.app.input.simulate({ "<Gamepad>/leftStick": { x: 1, y: 0 } });
    built.step();
    expect(built.app.input.currentScheme).toBe("KeyboardMouse");
    expect(built.app.input.actions.get("move").vector.x).toBe(0);
  });

  it("honours the defaultScheme setting when the document declares it", async () => {
    const built = await createInputApp({ settings: { input: { defaultScheme: "Gamepad" } } });
    harness = built;
    built.app.input.loadActions(demoActions());
    expect(built.app.input.currentScheme).toBe("Gamepad");
  });

  it("leaves the scheme alone when no scheme lists the device", async () => {
    const built = await createInputApp();
    harness = built;
    built.app.input.loadActions(defineInputActions({ maps: [] }));
    built.app.input.simulateEvent({ type: "keydown", code: "space" });
    built.step();
    expect(built.app.input.currentScheme).toBe("");
  });
});

describe("UI focus", () => {
  it("reads keyboard actions as released while the UI owns the keyboard", async () => {
    const { app, step } = await withDemo();
    app.input.simulate({ "<Keyboard>/space": 1, "<Keyboard>/d": 1 });
    step();
    expect(app.input.actions.get("jump").isPressed).toBe(true);
    app.input.uiHasFocus = true;
    step();
    expect(app.input.uiHasFocus).toBe(true);
    expect(app.input.actions.get("jump").isPressed).toBe(false);
    expect(app.input.actions.get("move").vector.x).toBe(0);
  });

  it("keeps pointer actions working and keeps publishing key events", async () => {
    const { app, step } = await withDemo();
    app.input.uiHasFocus = true;
    app.input.simulateEvent({ type: "keydown", code: "space", key: " " });
    app.input.simulateEvent({ type: "pointermove", x: 0, y: 0, deltaX: 20, deltaY: 0 });
    step();
    expect(app.input.events.map((event) => event.type)).toEqual(["keydown", "pointermove"]);
    expect(app.input.actions.get("look").vector.x).toBeCloseTo(2, 6);
    expect(app.input.actions.get("jump").isPressed).toBe(false);
  });
});

describe("focus loss", () => {
  it("releases every control when the page reports a blur", async () => {
    const { app, step } = await withDemo();
    app.input.simulate({ "<Keyboard>/space": 1, "<Keyboard>/w": 1 });
    step();
    expect(app.input.actions.get("jump").isPressed).toBe(true);
    app.input.releaseAll();
    step();
    expect(app.input.actions.get("jump").isPressed).toBe(false);
    expect(app.input.actions.get("move").vector.y).toBe(0);
  });
});

describe("diagnostics", () => {
  it("publishes the input group's counters", async () => {
    const built = await withDemo();
    built.app.input.simulateEvent({ type: "keydown", code: "space" });
    built.step();
    const group = built.app.diagnostics.group("input");
    expect(group).not.toBeNull();
    if (group === null) {
      return;
    }
    expect(group.counterNames).toEqual(["eventsThisFrame", "gamepadsConnected", "activeScheme", "pointerLocked"]);
    expect(group.get(group.index("eventsThisFrame"))).toBe(1);
    expect(group.get(group.index("gamepadsConnected"))).toBe(0);
    expect(group.get(group.index("activeScheme"))).toBe(0);
    expect(group.get(group.index("pointerLocked"))).toBe(0);
    built.app.input.simulate({ "<Gamepad>/buttonSouth": 1 });
    built.step();
    expect(group.get(group.index("gamepadsConnected"))).toBe(1);
  });
});

describe("device events", () => {
  it("emits connect and disconnect as slots fill and empty", async () => {
    let connected = true;
    const reader = (): readonly (GamepadLike | null)[] => [
      connected
        ? {
            id: "Standard",
            mapping: "standard",
            connected: true,
            buttons: Array.from({ length: 18 }, () => ({ value: 0 })),
            axes: [0, 0, 0, 0],
          }
        : null,
      null,
      null,
      null,
    ];
    const built = await createInputApp({ options: { gamepadReader: reader } });
    harness = built;
    const log: string[] = [];
    built.app.input.onDeviceConnected.connect((device) => log.push(`+${String(device.deviceIndex)}`));
    built.app.input.onDeviceDisconnected.connect((device) => log.push(`-${String(device.deviceIndex)}`));
    built.step();
    connected = false;
    built.step();
    expect(log).toEqual(["+0", "-0"]);
  });

  it("does not poll at all when gamepadPolling is off", async () => {
    const built = await createInputApp({ options: { gamepadPolling: false, gamepadReader: refusingReader } });
    harness = built;
    built.step();
    expect(built.app.input.gamepads[0]?.isConnected).toBe(false);
  });
});

describe("the cursor", () => {
  it("records visibility on a headless app", async () => {
    const { app } = await withDemo();
    expect(app.input.cursor.visible).toBe(true);
    app.input.cursor.visible = false;
    expect(app.input.cursor.visible).toBe(false);
    app.input.cursor.visible = false;
    expect(app.input.cursor.visible).toBe(false);
  });
});

describe("pointer lock", () => {
  it("reports unlocked and rejects a request on a headless app", async () => {
    const { app } = await withDemo();
    expect(app.input.pointerLock.locked).toBe(false);
    await expect(app.input.pointerLock.request()).rejects.toMatchObject({ code: "IGX-0809" });
    app.input.pointerLock.exit();
  });
});
