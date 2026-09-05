import { describe, expect, it } from "vitest";
import {
  approximately,
  clamp,
  clamp01,
  DEG_TO_RAD,
  degToRad,
  deltaAngleDegrees,
  EPSILON,
  inverseLerp,
  lerp,
  lerpAngleDegrees,
  moveTowards,
  pingPong,
  RAD_TO_DEG,
  radToDeg,
  repeat,
  sign,
  smoothStep,
  wrapAngleDegrees,
} from "../../src/math/math-utils.js";

describe("angle conversion", () => {
  it("converts degrees to radians and back", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12);
    expect(radToDeg(degToRad(37))).toBeCloseTo(37, 12);
  });

  it("exposes the conversion factors as constants", () => {
    expect(DEG_TO_RAD * RAD_TO_DEG).toBeCloseTo(1, 12);
    expect(EPSILON).toBeGreaterThan(0);
  });
});

describe("clamp", () => {
  it("returns the bounds outside the range and the value inside it", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });

  it("propagates NaN", () => {
    expect(clamp(Number.NaN, 0, 10)).toBeNaN();
  });

  it("clamps into the unit range", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });
});

describe("lerp", () => {
  it("interpolates between the endpoints", () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it("extrapolates because the interpolant is not clamped", () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });

  it("inverts back to the interpolant", () => {
    expect(inverseLerp(10, 20, 15)).toBe(0.5);
    expect(inverseLerp(10, 20, 0)).toBe(0);
    expect(inverseLerp(10, 20, 99)).toBe(1);
  });

  it("returns zero when inverting a degenerate range", () => {
    expect(inverseLerp(5, 5, 5)).toBe(0);
  });
});

describe("smoothStep", () => {
  it("eases between the edges", () => {
    expect(smoothStep(0, 1, 0)).toBe(0);
    expect(smoothStep(0, 1, 1)).toBe(1);
    expect(smoothStep(0, 1, 0.5)).toBe(0.5);
    expect(smoothStep(0, 1, 0.25)).toBeLessThan(0.25);
    expect(smoothStep(0, 1, 0.75)).toBeGreaterThan(0.75);
  });

  it("clamps outside the edges", () => {
    expect(smoothStep(0, 1, -3)).toBe(0);
    expect(smoothStep(0, 1, 3)).toBe(1);
  });

  it("steps at the edge when both edges are equal", () => {
    expect(smoothStep(2, 2, 1)).toBe(0);
    expect(smoothStep(2, 2, 3)).toBe(1);
  });
});

describe("moveTowards", () => {
  it("steps by at most maxDelta", () => {
    expect(moveTowards(0, 10, 3)).toBe(3);
    expect(moveTowards(0, -10, 3)).toBe(-3);
  });

  it("lands exactly on the target instead of overshooting", () => {
    expect(moveTowards(0, 10, 100)).toBe(10);
    expect(moveTowards(9.5, 10, 0.5)).toBe(10);
  });
});

describe("repeat and pingPong", () => {
  it("wraps into [0, length) without going negative", () => {
    expect(repeat(-1, 4)).toBe(3);
    expect(repeat(5, 4)).toBe(1);
    expect(repeat(0, 4)).toBe(0);
  });

  it("folds back and forth", () => {
    expect(pingPong(0, 4)).toBe(0);
    expect(pingPong(3, 4)).toBe(3);
    expect(pingPong(5, 4)).toBe(3);
    expect(pingPong(8, 4)).toBe(0);
  });
});

describe("approximately", () => {
  it("accepts differences within the tolerance", () => {
    expect(approximately(1, 1 + 1e-9)).toBe(true);
    expect(approximately(1, 1.1)).toBe(false);
    expect(approximately(1, 1.1, 0.2)).toBe(true);
  });

  it("never reports NaN as equal, not even to itself", () => {
    expect(approximately(Number.NaN, Number.NaN)).toBe(false);
  });
});

describe("sign", () => {
  it("treats both zeroes as positive", () => {
    expect(sign(0)).toBe(1);
    expect(sign(-0)).toBe(1);
  });

  it("reports the sign of non-zero values", () => {
    expect(sign(4)).toBe(1);
    expect(sign(-4)).toBe(-1);
  });

  it("propagates NaN", () => {
    expect(sign(Number.NaN)).toBeNaN();
  });
});

describe("degree angles", () => {
  it("wraps into [-180, 180)", () => {
    expect(wrapAngleDegrees(370)).toBeCloseTo(10, 12);
    expect(wrapAngleDegrees(-190)).toBeCloseTo(170, 12);
    expect(wrapAngleDegrees(0)).toBe(0);
    expect(wrapAngleDegrees(180)).toBe(-180);
  });

  it("takes the short way round for a delta", () => {
    expect(deltaAngleDegrees(350, 10)).toBeCloseTo(20, 12);
    expect(deltaAngleDegrees(10, 350)).toBeCloseTo(-20, 12);
  });

  it("interpolates the short way round", () => {
    expect(lerpAngleDegrees(350, 10, 0.5)).toBeCloseTo(360, 12);
    expect(lerpAngleDegrees(0, 90, 0.5)).toBeCloseTo(45, 12);
  });
});
