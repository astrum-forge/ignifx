import { describe, expect, it } from "vitest";
import { applyProcessors, parseProcessor, parseProcessors } from "../../src/index.js";
import type { ControlValue } from "../../src/index.js";
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

/** Runs one processor chain over a value and returns it. */
function applyChain(sources: readonly string[], x: number, y: number, isVector: boolean): ControlValue {
  const value: ControlValue = { x, y };
  applyProcessors(parseProcessors(sources), value, isVector);
  return value;
}

describe("processor parsing", () => {
  it("parses a bare processor with its defaults", () => {
    expect(parseProcessor("invert")).toEqual({ kind: "invert", first: 0, second: 0 });
    expect(parseProcessor("deadzone")).toEqual({ kind: "deadzone", first: 0.125, second: 1 });
    expect(parseProcessor("clamp")).toEqual({ kind: "clamp", first: -1, second: 1 });
  });

  it("copies a single scale argument onto both axes", () => {
    expect(parseProcessor("scale(0.1)")).toEqual({ kind: "scale", first: 0.1, second: 0.1 });
    expect(parseProcessor("scale(2, 3)")).toEqual({ kind: "scale", first: 2, second: 3 });
  });

  it("tolerates whitespace around the name and the arguments", () => {
    expect(parseProcessor("  deadzone( 0.2 , 0.9 ) ")).toEqual({ kind: "deadzone", first: 0.2, second: 0.9 });
  });

  it("rejects an unknown processor with IGX-0802", () => {
    expect(codeOf(() => parseProcessor("smooth(0.5)"))).toBe("IGX-0802");
  });

  it("rejects a missing closing parenthesis with IGX-0802", () => {
    expect(codeOf(() => parseProcessor("scale(2"))).toBe("IGX-0802");
  });

  it("rejects an argument that is not a number with IGX-0802", () => {
    expect(codeOf(() => parseProcessor("scale(fast)"))).toBe("IGX-0802");
  });

  it("reports the first unparseable entry of a chain", () => {
    expect(codeOf(() => parseProcessors(["invert", "wobble"]))).toBe("IGX-0802");
  });
});

describe("processor arithmetic", () => {
  it("applies an axial deadzone to a scalar", () => {
    expect(applyChain(["deadzone(0.2)"], 0.1, 0, false).x).toBe(0);
    expect(applyChain(["deadzone(0.2)"], 0.2, 0, false).x).toBe(0);
    expect(applyChain(["deadzone(0.2)"], 0.6, 0, false).x).toBeCloseTo(0.5, 6);
    expect(applyChain(["deadzone(0.2)"], -0.6, 0, false).x).toBeCloseTo(-0.5, 6);
    expect(applyChain(["deadzone(0.2)"], 1, 0, false).x).toBeCloseTo(1, 6);
  });

  it("applies a radial deadzone to a vector, keeping its direction", () => {
    const inside = applyChain(["deadzone(0.5)"], 0.3, 0.3, true);
    expect(inside).toEqual({ x: 0, y: 0 });
    // (0.45, 0.6) has magnitude 0.75, which is halfway through the [0.5, 1] band.
    const outside = applyChain(["deadzone(0.5)"], 0.45, 0.6, true);
    expect(Math.hypot(outside.x, outside.y)).toBeCloseTo(0.5, 6);
    expect(outside.y / outside.x).toBeCloseTo(0.6 / 0.45, 6);
    // A fully deflected stick still reaches magnitude 1 after the rescale.
    const full = applyChain(["deadzone(0.5)"], 0.6, 0.8, true);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 6);
  });

  it("leaves a zero vector alone under a deadzone", () => {
    expect(applyChain(["deadzone(0.2)"], 0, 0, true)).toEqual({ x: 0, y: 0 });
  });

  it("treats a zero-width deadzone band as a hard gate", () => {
    expect(applyChain(["deadzone(0.5, 0.5)"], 0.6, 0, false).x).toBe(1);
    expect(applyChain(["deadzone(0.5, 0.5)"], 0.6, 0.8, true).x).toBeCloseTo(0.6, 6);
  });

  it("inverts both components", () => {
    expect(applyChain(["invert"], 0.25, -0.5, true)).toEqual({ x: -0.25, y: 0.5 });
  });

  it("scales per axis", () => {
    expect(applyChain(["scale(2, 3)"], 1, 1, true)).toEqual({ x: 2, y: 3 });
    expect(applyChain(["scale(0.1)"], 10, 20, true)).toEqual({ x: 1, y: 2 });
  });

  it("clamps every component into the range", () => {
    expect(applyChain(["clamp(0, 1)"], -2, 5, true)).toEqual({ x: 0, y: 1 });
  });

  it("normalizes a vector to unit length", () => {
    const value = applyChain(["normalize"], 3, 4, true);
    expect(Math.hypot(value.x, value.y)).toBeCloseTo(1, 6);
    expect(value.x).toBeCloseTo(0.6, 6);
  });

  it("leaves a zero vector alone under normalize", () => {
    expect(applyChain(["normalize"], 0, 0, true)).toEqual({ x: 0, y: 0 });
  });

  it("clamps a scalar into [-1, 1] under normalize", () => {
    expect(applyChain(["normalize"], 4, 0, false).x).toBe(1);
    expect(applyChain(["normalize"], -4, 0, false).x).toBe(-1);
  });

  it("runs a chain in declaration order", () => {
    expect(applyChain(["scale(2)", "clamp(-1, 1)"], 0.8, 0, false).x).toBe(1);
    expect(applyChain(["clamp(-1, 1)", "scale(2)"], 0.8, 0, false).x).toBeCloseTo(1.6, 6);
  });

  it("does nothing for an empty chain", () => {
    expect(applyChain([], 0.4, 0.2, true)).toEqual({ x: 0.4, y: 0.2 });
  });
});
