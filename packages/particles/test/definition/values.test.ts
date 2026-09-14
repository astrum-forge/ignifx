import { describe, expect, it } from "vitest";
import { LOOKUP_SAMPLES } from "../../src/definition/types.js";
import {
  bakeCurve,
  bakeGradient,
  evaluateCurve,
  evaluateGradient,
  isUnitScalar,
  resolveColor,
  resolveScalar,
  rowMax,
  rowMin,
  sampleRow,
  scalarMax,
  scalarMin,
  srgbToLinear,
} from "../../src/definition/values.js";
import type { GradientStop, ScalarValue } from "../../src/definition/types.js";
import type { CurveValue } from "@ignifx/core";

/** A straight ramp from `0` at `t = 0` to `1` at `t = 1`. */
const RAMP: CurveValue = { keys: [[0, 0, 1, 1] as const, [1, 1, 1, 1] as const] };

/** Two stops, opaque red to transparent blue. */
const STOPS: readonly GradientStop[] = [
  [0, 1, 0, 0, 1],
  [1, 0, 0, 1, 0],
];

describe("evaluateCurve", () => {
  it("clamps to the first and last key outside the key range", () => {
    expect(evaluateCurve(RAMP, -1)).toBe(0);
    expect(evaluateCurve(RAMP, 2)).toBe(1);
  });

  it("returns zero for a curve with no keys", () => {
    expect(evaluateCurve({ keys: [] }, 0.5)).toBe(0);
  });

  it("interpolates a linear ramp exactly", () => {
    expect(evaluateCurve(RAMP, 0.25)).toBeCloseTo(0.25, 6);
    expect(evaluateCurve(RAMP, 0.5)).toBeCloseTo(0.5, 6);
  });

  it("eases between two flat keys, which a linear reading would not", () => {
    const flat: CurveValue = {
      keys: [
        [0, 0, 0, 0],
        [1, 1, 0, 0],
      ],
    };
    expect(evaluateCurve(flat, 0.5)).toBeCloseTo(0.5, 6);
    expect(evaluateCurve(flat, 0.25)).toBeLessThan(0.25);
  });

  it("returns the only key's value everywhere for a one-key curve", () => {
    const flat: CurveValue = { keys: [[0.5, 7, 0, 0]] };
    expect(evaluateCurve(flat, 0)).toBe(7);
    expect(evaluateCurve(flat, 0.5)).toBe(7);
    expect(evaluateCurve(flat, 1)).toBe(7);
  });
});

describe("bakeCurve", () => {
  it("samples the curve at i / 63 over 64 samples", () => {
    const samples = bakeCurve(RAMP);
    expect(samples).toHaveLength(LOOKUP_SAMPLES);
    expect(samples[0]).toBeCloseTo(0, 6);
    expect(samples[LOOKUP_SAMPLES - 1]).toBeCloseTo(1, 6);
    expect(samples[32]).toBeCloseTo(evaluateCurve(RAMP, 32 / 63), 6);
  });
});

describe("sampleRow", () => {
  it("reproduces the baked curve at every sample point", () => {
    const samples = bakeCurve(RAMP);
    for (let index = 0; index < LOOKUP_SAMPLES; index += 1) {
      expect(sampleRow(samples, index / (LOOKUP_SAMPLES - 1))).toBeCloseTo(samples[index] ?? 0, 6);
    }
  });

  it("lerps between two samples, which is the contract the shader's linear filter keeps", () => {
    const samples = bakeCurve(RAMP);
    const midpoint = 0.5 / (LOOKUP_SAMPLES - 1);
    const expected = ((samples[0] ?? 0) + (samples[1] ?? 0)) / 2;
    expect(sampleRow(samples, midpoint)).toBeCloseTo(expected, 6);
  });

  it("clamps outside [0, 1] instead of extrapolating", () => {
    const samples = bakeCurve(RAMP);
    expect(sampleRow(samples, -3)).toBe(samples[0]);
    expect(sampleRow(samples, 3)).toBe(samples[LOOKUP_SAMPLES - 1]);
  });
});

describe("evaluateGradient", () => {
  it("interpolates every channel between two stops", () => {
    const out = new Float32Array(4);
    evaluateGradient(STOPS, 0.5, out);
    expect([...out]).toEqual([0.5, 0, 0.5, 0.5]);
  });

  it("clamps to the end stops", () => {
    const out = new Float32Array(4);
    expect([...evaluateGradient(STOPS, -1, out)]).toEqual([1, 0, 0, 1]);
    expect([...evaluateGradient(STOPS, 5, out)]).toEqual([0, 0, 1, 0]);
  });

  it("falls back to opaque white for an empty gradient", () => {
    const out = new Float32Array(4);
    expect([...evaluateGradient([], 0.5, out)]).toEqual([1, 1, 1, 1]);
  });
});

describe("bakeGradient", () => {
  it("writes four floats per sample, first and last matching the end stops", () => {
    const samples = bakeGradient(STOPS);
    expect(samples).toHaveLength(LOOKUP_SAMPLES * 4);
    expect([...samples.subarray(0, 4)]).toEqual([1, 0, 0, 1]);
    expect([...samples.subarray((LOOKUP_SAMPLES - 1) * 4)]).toEqual([0, 0, 1, 0]);
  });
});

describe("scalar ranges", () => {
  it("reports a constant's own value as both ends", () => {
    const value: ScalarValue = { kind: "constant", value: 3 };
    expect(scalarMin(value)).toBe(3);
    expect(scalarMax(value)).toBe(3);
  });

  it("orders a reversed random range", () => {
    const value: ScalarValue = { kind: "random", min: 5, max: 1 };
    expect(scalarMin(value)).toBe(1);
    expect(scalarMax(value)).toBe(5);
  });

  it("reads a curve's extremes from its samples", () => {
    const value: ScalarValue = { kind: "curve", curve: RAMP, samples: bakeCurve(RAMP) };
    expect(scalarMin(value)).toBeCloseTo(0, 6);
    expect(scalarMax(value)).toBeCloseTo(1, 6);
  });

  it("reports zero for an empty row", () => {
    expect(rowMin(new Float32Array(0))).toBe(0);
    expect(rowMax(new Float32Array(0))).toBe(0);
  });
});

describe("resolveScalar", () => {
  it("ignores the random draw for a constant", () => {
    expect(resolveScalar({ kind: "constant", value: 2 }, 0.9, 0.5)).toBe(2);
  });

  it("picks inside a random range by the draw", () => {
    expect(resolveScalar({ kind: "random", min: 1, max: 3 }, 0, 0)).toBe(1);
    expect(resolveScalar({ kind: "random", min: 1, max: 3 }, 0.5, 0)).toBe(2);
  });

  it("reads a curve at the cycle time, not at the draw", () => {
    const value: ScalarValue = { kind: "curve", curve: RAMP, samples: bakeCurve(RAMP) };
    expect(resolveScalar(value, 0.9, 0.25)).toBeCloseTo(0.25, 5);
  });
});

describe("isUnitScalar", () => {
  it("is true only for a constant one", () => {
    expect(isUnitScalar({ kind: "constant", value: 1 })).toBe(true);
    expect(isUnitScalar({ kind: "constant", value: 2 })).toBe(false);
    expect(isUnitScalar({ kind: "random", min: 1, max: 1 })).toBe(false);
  });
});

describe("resolveColor", () => {
  it("copies a constant colour", () => {
    const out = new Float32Array(4);
    resolveColor({ kind: "constant", value: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 } }, 0.5, 0, out);
    expect(out[0]).toBeCloseTo(0.1, 6);
    expect(out[1]).toBeCloseTo(0.2, 6);
    expect(out[2]).toBeCloseTo(0.3, 6);
    expect(out[3]).toBeCloseTo(0.4, 6);
  });

  it("picks between two colours with one draw, so a particle stays on the line between them", () => {
    const out = new Float32Array(4);
    resolveColor({ kind: "random", min: { r: 0, g: 0, b: 0, a: 0 }, max: { r: 1, g: 1, b: 1, a: 1 } }, 0.25, 0, out);
    expect([...out]).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("samples a gradient at the cycle time", () => {
    const out = new Float32Array(4);
    resolveColor({ kind: "gradient", stops: STOPS, samples: bakeGradient(STOPS) }, 0, 0.5, out);
    expect([...out]).toEqual([0.5, 0, 0.5, 0.5]);
  });
});

describe("srgbToLinear", () => {
  it("uses the linear segment below the threshold and the power curve above it", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 6);
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 8);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214_041_14, 6);
  });
});
