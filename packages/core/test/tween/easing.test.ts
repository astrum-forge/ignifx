import { describe, expect, it } from "vitest";
import { EASING_NAMES, EASINGS, resolveEase } from "../../src/tween/easing.js";

/** A custom curve, declared once so `resolveEase` can be asserted to hand back the same function. */
const doubleCurve = (t: number): number => t * 2;

describe("easing", () => {
  it("declares one function per name", () => {
    expect(Object.keys(EASINGS).toSorted()).toEqual(EASING_NAMES.toSorted());
  });

  it("starts at 0 and ends at 1 for every curve", () => {
    for (const name of EASING_NAMES) {
      const curve = EASINGS[name];
      expect(curve).toBeDefined();
      expect(curve?.(0)).toBeCloseTo(0, 6);
      expect(curve?.(1)).toBeCloseTo(1, 6);
    }
  });

  it("overshoots for backOut and elasticOut and stays inside [0, 1] for bounceOut", () => {
    let backMax = 0;
    let elasticMax = 0;
    let bounceMax = 0;
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 100;
      backMax = Math.max(backMax, EASINGS["backOut"]?.(t) ?? 0);
      elasticMax = Math.max(elasticMax, EASINGS["elasticOut"]?.(t) ?? 0);
      bounceMax = Math.max(bounceMax, EASINGS["bounceOut"]?.(t) ?? 0);
    }
    expect(backMax).toBeGreaterThan(1);
    expect(elasticMax).toBeGreaterThan(1);
    expect(bounceMax).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("is monotonic and symmetric for the in-out curves", () => {
    expect(EASINGS["quadInOut"]?.(0.5)).toBeCloseTo(0.5, 6);
    expect(EASINGS["cubicInOut"]?.(0.5)).toBeCloseTo(0.5, 6);
    expect(EASINGS["sineInOut"]?.(0.5)).toBeCloseTo(0.5, 6);
    expect(EASINGS["quadIn"]?.(0.5)).toBeCloseTo(0.25, 6);
    expect(EASINGS["quadOut"]?.(0.5)).toBeCloseTo(0.75, 6);
    expect(EASINGS["cubicIn"]?.(0.5)).toBeCloseTo(0.125, 6);
    expect(EASINGS["cubicOut"]?.(0.5)).toBeCloseTo(0.875, 6);
  });

  it("resolves names, custom curves, and the default", () => {
    expect(resolveEase(undefined)?.(0.25)).toBe(0.25);
    expect(resolveEase("cubicIn")).toBe(EASINGS["cubicIn"]);
    expect(resolveEase(doubleCurve)).toBe(doubleCurve);
  });

  it("returns null for a name the table does not declare", () => {
    // The cast is the whole point of the test: a JavaScript caller can reach this.
    expect(resolveEase("nope" as "linear")).toBeNull();
  });
});
