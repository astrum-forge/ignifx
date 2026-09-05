import { describe, expect, it, vi } from "vitest";
import { GAMEPAD_REMAPS, GamepadDevice, gamepadControlNames, resolveGamepadRemap } from "../../src/index.js";
import type { GamepadSnapshot } from "../../src/index.js";

/** Builds a snapshot with 16 buttons and 4 axes, all at rest unless overridden. */
function snapshot(overrides: Partial<GamepadSnapshot>): GamepadSnapshot {
  return {
    id: "Standard Pad (Vendor: 0000 Product: 0000)",
    mapping: "standard",
    buttons: Array.from({ length: 18 }, () => 0),
    axes: [0, 0, 0, 0, 0],
    ...overrides,
  };
}

/** Reads one control of a device by name. */
function read(device: GamepadDevice, name: string): number {
  const control = device.control(name);
  return control === null ? Number.NaN : device.valueAt(control.offset);
}

describe("the standard gamepad mapping", () => {
  it("declares the documented control names", () => {
    const names = gamepadControlNames();
    for (const expected of [
      "leftStick",
      "rightStick",
      "leftTrigger",
      "rightTrigger",
      "buttonSouth",
      "buttonEast",
      "buttonWest",
      "buttonNorth",
      "leftShoulder",
      "rightShoulder",
      "dpad",
      "dpad/up",
      "dpad/down",
      "dpad/left",
      "dpad/right",
      "start",
      "select",
      "leftStickPress",
      "rightStickPress",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("maps every standard button index onto its named control", () => {
    const pad = new GamepadDevice(0);
    const buttons = Array.from({ length: 18 }, () => 0);
    buttons[0] = 1;
    buttons[5] = 1;
    buttons[9] = 1;
    buttons[11] = 1;
    pad.applySnapshot(snapshot({ buttons }));
    expect(read(pad, "buttonSouth")).toBe(1);
    expect(read(pad, "rightShoulder")).toBe(1);
    expect(read(pad, "start")).toBe(1);
    expect(read(pad, "rightStickPress")).toBe(1);
    expect(read(pad, "buttonNorth")).toBe(0);
  });

  it("reports triggers as analog axes", () => {
    const pad = new GamepadDevice(0);
    const buttons = Array.from({ length: 18 }, () => 0);
    buttons[6] = 0.4;
    pad.applySnapshot(snapshot({ buttons }));
    expect(pad.control("leftTrigger")?.kind).toBe("axis");
    expect(read(pad, "leftTrigger")).toBeCloseTo(0.4, 6);
  });

  it("flips stick Y so that pushing up is positive", () => {
    const pad = new GamepadDevice(0);
    pad.applySnapshot(snapshot({ axes: [0.5, -1, -0.25, 1, 0] }));
    const left = pad.control("leftStick");
    const right = pad.control("rightStick");
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    if (left !== null && right !== null) {
      expect(pad.valueAt(left.offset)).toBeCloseTo(0.5, 6);
      expect(pad.valueAt(left.offset + 1)).toBeCloseTo(1, 6);
      expect(pad.valueAt(right.offset)).toBeCloseTo(-0.25, 6);
      expect(pad.valueAt(right.offset + 1)).toBeCloseTo(-1, 6);
    }
  });

  it("synthesises dpad as a vector from the four buttons", () => {
    const pad = new GamepadDevice(0);
    const buttons = Array.from({ length: 18 }, () => 0);
    buttons[12] = 1;
    buttons[15] = 1;
    pad.applySnapshot(snapshot({ buttons }));
    const dpad = pad.control("dpad");
    expect(dpad).not.toBeNull();
    if (dpad !== null) {
      expect(pad.valueAt(dpad.offset)).toBe(1);
      expect(pad.valueAt(dpad.offset + 1)).toBe(1);
    }
  });

  it("connects on the first snapshot and disconnects on a null one", () => {
    const pad = new GamepadDevice(1);
    expect(pad.isConnected).toBe(false);
    pad.applySnapshot(snapshot({ id: "Pad" }));
    expect(pad.isConnected).toBe(true);
    expect(pad.id).toBe("Pad");
    pad.applySnapshot(null);
    expect(pad.isConnected).toBe(false);
    expect(pad.id).toBe("");
  });

  it("releases every control when the pad disappears", () => {
    const pad = new GamepadDevice(0);
    const buttons = Array.from({ length: 18 }, () => 0);
    buttons[0] = 1;
    pad.applySnapshot(snapshot({ buttons }));
    expect(read(pad, "buttonSouth")).toBe(1);
    pad.applySnapshot(null);
    expect(read(pad, "buttonSouth")).toBe(0);
  });
});

describe("the non-standard remap table", () => {
  it("leaves a standard pad alone", () => {
    expect(resolveGamepadRemap(snapshot({ mapping: "standard", id: "nintendo" }))).toBeNull();
  });

  it("matches a non-standard pad by a substring of its id, case-insensitively", () => {
    const remap = resolveGamepadRemap(snapshot({ mapping: "", id: "Pro Controller (Nintendo)" }));
    expect(remap).toBe(GAMEPAD_REMAPS[0]);
  });

  it("falls back to the standard order for an unrecognised non-standard pad", () => {
    expect(resolveGamepadRemap(snapshot({ mapping: "", id: "Unknown Device" }))).toBeNull();
  });

  it("swaps the face buttons back into standard positions", () => {
    const pad = new GamepadDevice(0);
    const buttons = Array.from({ length: 18 }, () => 0);
    // Raw button 1 is the physical south position on a Nintendo-style pad.
    buttons[1] = 1;
    pad.applySnapshot(snapshot({ mapping: "", id: "Nintendo Switch Pro Controller", buttons }));
    expect(read(pad, "buttonSouth")).toBe(1);
    expect(read(pad, "buttonEast")).toBe(0);
  });

  it("reads the right stick from the axes the remap names", () => {
    const pad = new GamepadDevice(0);
    pad.applySnapshot(snapshot({ mapping: "", id: "054c-09cc-Wireless Controller", axes: [0, 0, 0, 0.5, -0.5] }));
    const right = pad.control("rightStick");
    expect(right).not.toBeNull();
    if (right !== null) {
      expect(pad.valueAt(right.offset)).toBeCloseTo(0.5, 6);
      expect(pad.valueAt(right.offset + 1)).toBeCloseTo(0.5, 6);
    }
  });
});

describe("haptics", () => {
  it("reports false when the pad has no actuator", () => {
    const pad = new GamepadDevice(0);
    expect(pad.rumble(1, 0.2)).toBe(false);
  });

  it("plays a clamped dual-rumble effect through the actuator", () => {
    const pad = new GamepadDevice(0);
    const playEffect = vi.fn(() => Promise.resolve("complete"));
    pad.setActuator({ playEffect });
    expect(pad.rumble(2, 0.25)).toBe(true);
    expect(playEffect).toHaveBeenCalledWith("dual-rumble", {
      duration: 250,
      strongMagnitude: 1,
      weakMagnitude: 1,
    });
  });

  it("swallows an actuator rejection", async () => {
    const pad = new GamepadDevice(0);
    pad.setActuator({ playEffect: () => Promise.reject(new Error("gone")) });
    expect(pad.rumble(0.5, 0.1)).toBe(true);
    await Promise.resolve();
  });
});
