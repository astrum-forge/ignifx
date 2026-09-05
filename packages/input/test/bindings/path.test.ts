import { describe, expect, it } from "vitest";
import { InputDevices, parseControlPath } from "../../src/index.js";
import type { IgnifxError } from "@ignifx/core";

/** Runs a call that must throw an `IgnifxError` and returns its code. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as IgnifxError).code;
  }
  return "";
}

describe("binding path grammar", () => {
  it("parses a simple device and control", () => {
    expect(parseControlPath("<Keyboard>/space")).toEqual({
      device: "Keyboard",
      deviceIndex: 0,
      control: "space",
    });
  });

  it("keeps sub-control segments in the control name", () => {
    expect(parseControlPath("<Gamepad>/dpad/up").control).toBe("dpad/up");
    expect(parseControlPath("<Touch>/touch0/position").control).toBe("touch0/position");
  });

  it("reads a zero-based device index written after the angle brackets", () => {
    expect(parseControlPath("<Gamepad>{2}/leftStick")).toEqual({
      device: "Gamepad",
      deviceIndex: 2,
      control: "leftStick",
    });
  });

  it("treats an omitted index as slot zero", () => {
    expect(parseControlPath("<Gamepad>/leftStick").deviceIndex).toBe(0);
  });

  it("rejects a path that does not start with a device", () => {
    expect(codeOf(() => parseControlPath("Keyboard/space"))).toBe("IGX-0803");
  });

  it("rejects an unclosed device token", () => {
    expect(codeOf(() => parseControlPath("<Keyboard/space"))).toBe("IGX-0803");
  });

  it("rejects an unknown device", () => {
    expect(codeOf(() => parseControlPath("<Joystick>/x"))).toBe("IGX-0803");
  });

  it("rejects an unclosed device index", () => {
    expect(codeOf(() => parseControlPath("<Gamepad>{1/leftStick"))).toBe("IGX-0803");
  });

  it("rejects a device index that is not a whole number", () => {
    expect(codeOf(() => parseControlPath("<Gamepad>{x}/leftStick"))).toBe("IGX-0803");
    expect(codeOf(() => parseControlPath("<Gamepad>{-1}/leftStick"))).toBe("IGX-0803");
    expect(codeOf(() => parseControlPath("<Gamepad>{}/leftStick"))).toBe("IGX-0803");
  });

  it("rejects a path with no slash and no control", () => {
    expect(codeOf(() => parseControlPath("<Keyboard>"))).toBe("IGX-0803");
    expect(codeOf(() => parseControlPath("<Keyboard>/"))).toBe("IGX-0803");
  });

  it("rejects a control the device does not have", () => {
    const devices = new InputDevices();
    expect(codeOf(() => devices.resolve("<Keyboard>/nope"))).toBe("IGX-0803");
  });

  it("rejects a device index that does not exist", () => {
    const devices = new InputDevices();
    expect(codeOf(() => devices.resolve("<Keyboard>{1}/space"))).toBe("IGX-0803");
    expect(codeOf(() => devices.resolve("<Gamepad>{9}/buttonSouth"))).toBe("IGX-0803");
  });

  it("creates a virtual control on demand", () => {
    const devices = new InputDevices();
    const ref = devices.resolve("<Virtual>/joystick", "vector2");
    expect(ref.control.kind).toBe("vector2");
    expect(devices.virtual.control("joystick")).not.toBeNull();
  });
});
