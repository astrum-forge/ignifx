import { describe, expect, it } from "vitest";
import {
  buildControls,
  controlSlotCount,
  createKeyboardDevice,
  createMouseDevice,
  createPointerDevice,
  createTouchDevice,
  DEVICE_KINDS,
  InputDevices,
  keyboardControlNames,
  keyCodeControlNames,
  mouseControlNames,
  touchControlNames,
  VirtualDevice,
} from "../../src/index.js";

describe("control tables", () => {
  it("assigns ascending indices and packs vectors into two slots", () => {
    const controls = buildControls([
      { name: "press", kind: "button" },
      { name: "position", kind: "vector2" },
      { name: "count", kind: "axis" },
    ]);
    expect(controls.map((control) => [control.index, control.offset, control.components])).toEqual([
      [0, 0, 1],
      [1, 1, 2],
      [2, 3, 1],
    ]);
    expect(controlSlotCount(controls)).toBe(4);
  });

  it("reports zero slots for an empty table", () => {
    expect(controlSlotCount([])).toBe(0);
  });
});

describe("keyboard layout", () => {
  it("names controls after the physical key position, not the label", () => {
    const codes = keyCodeControlNames();
    expect(codes.get("KeyW")).toBe("w");
    expect(codes.get("Digit1")).toBe("1");
    expect(codes.get("ShiftLeft")).toBe("shiftLeft");
    expect(codes.get("ArrowUp")).toBe("arrowUp");
    expect(codes.get("Space")).toBe("space");
  });

  it("ends its control list with anyKey", () => {
    const names = keyboardControlNames();
    expect(names.at(-1)).toBe("anyKey");
    expect(names).toContain("enter");
  });

  it("exposes every named key as a button control", () => {
    const keyboard = createKeyboardDevice();
    expect(keyboard.control("w")?.kind).toBe("button");
    expect(keyboard.control("nope")).toBeNull();
  });
});

describe("pointing layouts", () => {
  it("gives the mouse three buttons and three vectors", () => {
    const mouse = createMouseDevice();
    expect(mouseControlNames()).toEqual(["leftButton", "rightButton", "middleButton", "position", "delta", "scroll"]);
    expect(mouse.control("delta")?.components).toBe(2);
    expect(mouse.control("leftButton")?.components).toBe(1);
  });

  it("gives the pointer press, position, and delta", () => {
    const pointer = createPointerDevice();
    expect(pointer.controls.map((control) => control.name)).toEqual(["press", "position", "delta"]);
  });

  it("gives touch a primary slot, ten numbered slots, and a count", () => {
    const touch = createTouchDevice();
    const names = touchControlNames();
    expect(names[0]).toBe("primaryTouch/press");
    expect(names).toContain("touch9/delta");
    expect(names.at(-1)).toBe("touchCount");
    expect(touch.control("touchCount")?.kind).toBe("axis");
    expect(touch.control("touch3/position")?.kind).toBe("vector2");
  });
});

describe("the device table", () => {
  it("lists every family in a stable order", () => {
    expect(DEVICE_KINDS).toEqual(["Keyboard", "Mouse", "Pointer", "Touch", "Gamepad", "Virtual"]);
  });

  it("has one device per family and four gamepad slots", () => {
    const devices = new InputDevices();
    expect(devices.gamepads).toHaveLength(4);
    expect(devices.all).toHaveLength(9);
    expect(devices.device("Keyboard", 0)).toBe(devices.keyboard);
    expect(devices.device("Keyboard", 1)).toBeNull();
    expect(devices.device("Gamepad", 3)).toBe(devices.gamepads[3]);
    expect(devices.device("Virtual", 0)).toBe(devices.virtual);
    expect(devices.device("Mouse", 0)).toBe(devices.mouse);
    expect(devices.device("Pointer", 0)).toBe(devices.pointer);
    expect(devices.device("Touch", 0)).toBe(devices.touch);
  });

  it("starts gamepads disconnected and everything else connected", () => {
    const devices = new InputDevices();
    expect(devices.keyboard.isConnected).toBe(true);
    expect(devices.gamepads[0]?.isConnected).toBe(false);
  });

  it("releases every control of every device", () => {
    const devices = new InputDevices();
    const space = devices.keyboard.control("space");
    expect(space).not.toBeNull();
    if (space !== null) {
      devices.keyboard.write(space, 1);
      expect(devices.keyboard.valueAt(space.offset)).toBe(1);
      devices.releaseAll();
      expect(devices.keyboard.valueAt(space.offset)).toBe(0);
    }
  });

  it("reads an out-of-range slot as zero", () => {
    const devices = new InputDevices();
    expect(devices.keyboard.valueAt(9999)).toBe(0);
  });
});

describe("the virtual device", () => {
  it("creates controls on demand and keeps their descriptors stable", () => {
    const virtual = new VirtualDevice();
    const stick = virtual.declare("joystick", "vector2");
    expect(virtual.declare("joystick")).toBe(stick);
    virtual.setVector("joystick", 0.5, -0.25);
    expect(virtual.valueAt(stick.offset)).toBeCloseTo(0.5, 6);
    expect(virtual.valueAt(stick.offset + 1)).toBeCloseTo(-0.25, 6);
  });

  it("keeps earlier values when the table grows", () => {
    const virtual = new VirtualDevice();
    virtual.set("buttonA", 1);
    const a = virtual.control("buttonA");
    virtual.setVector("joystick", 1, 1);
    expect(a).not.toBeNull();
    if (a !== null) {
      expect(virtual.valueAt(a.offset)).toBe(1);
    }
    expect(virtual.controls).toHaveLength(2);
  });
});
