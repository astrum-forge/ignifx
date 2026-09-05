import { describe, expect, it } from "vitest";
import { VEC2_ONE, VEC2_ZERO, Vec2 } from "../../src/math/vec2.js";

describe("Vec2", () => {
  it("defaults to zero and copies from any vector-shaped value", () => {
    expect(new Vec2().equalsWithEpsilon(VEC2_ZERO)).toBe(true);
    expect(Vec2.from({ x: 1, y: 2 }).equalsWithEpsilon({ x: 1, y: 2 })).toBe(true);
    expect(Vec2.zero().equalsWithEpsilon(VEC2_ZERO)).toBe(true);
    expect(Vec2.one().equalsWithEpsilon(VEC2_ONE)).toBe(true);
    expect(new Vec2(3, 4).clone().equalsWithEpsilon({ x: 3, y: 4 })).toBe(true);
  });

  it("has frozen constants", () => {
    expect(Object.isFrozen(VEC2_ZERO)).toBe(true);
    expect(Object.isFrozen(VEC2_ONE)).toBe(true);
    expect(() => {
      (VEC2_ONE as { x: number }).x = 5;
    }).toThrow(TypeError);
  });

  it("chains in-place operations", () => {
    const v = new Vec2(1, 2);
    expect(v.set(2, 4)).toBe(v);
    expect(
      v.copyFrom({ x: 1, y: 1 }).add({ x: 1, y: 1 }).subtract({ x: 0.5, y: 0.5 }).equalsWithEpsilon({ x: 1.5, y: 1.5 }),
    ).toBe(true);
    expect(new Vec2(2, 3).multiply({ x: 2, y: 2 }).equalsWithEpsilon({ x: 4, y: 6 })).toBe(true);
    expect(new Vec2(2, 3).scale(2).equalsWithEpsilon({ x: 4, y: 6 })).toBe(true);
    expect(new Vec2(2, 3).negate().equalsWithEpsilon({ x: -2, y: -3 })).toBe(true);
    expect(new Vec2(0, 0).addScaled({ x: 2, y: 4 }, 0.5).equalsWithEpsilon({ x: 1, y: 2 })).toBe(true);
    expect(new Vec2(0, 0).lerp({ x: 4, y: 8 }, 0.25).equalsWithEpsilon({ x: 1, y: 2 })).toBe(true);
  });

  it("normalizes, and leaves a zero vector alone rather than producing NaN", () => {
    expect(new Vec2(3, 4).normalize().length()).toBeCloseTo(1, 12);
    const zero = new Vec2(0, 0).normalize();
    expect(zero.equalsWithEpsilon(VEC2_ZERO)).toBe(true);
    expect(Number.isNaN(zero.x)).toBe(false);
  });

  it("measures length, distance, dot and the scalar cross product", () => {
    const v = new Vec2(3, 4);
    expect(v.length()).toBe(5);
    expect(v.lengthSquared()).toBe(25);
    expect(v.distance(VEC2_ZERO)).toBe(5);
    expect(v.distanceSquared(VEC2_ZERO)).toBe(25);
    expect(Vec2.length(v)).toBe(5);
    expect(Vec2.lengthSquared(v)).toBe(25);
    expect(Vec2.distance(v, VEC2_ZERO)).toBe(5);
    expect(v.dot({ x: 1, y: 0 })).toBe(3);
    expect(Vec2.dot(v, { x: 0, y: 1 })).toBe(4);
    expect(new Vec2(1, 0).cross({ x: 0, y: 1 })).toBe(1);
    expect(Vec2.cross({ x: 1, y: 0 }, { x: 0, y: -1 })).toBe(-1);
  });

  it("compares with a tolerance and writes into a Float32Array", () => {
    expect(new Vec2(1, 1).equalsWithEpsilon({ x: 1 + 1e-9, y: 1 })).toBe(true);
    expect(new Vec2(1, 1).equalsWithEpsilon({ x: 2, y: 1 })).toBe(false);
    expect(Vec2.equalsWithEpsilon({ x: 1, y: 1 }, { x: 1.4, y: 1 }, 0.5)).toBe(true);
    const buffer = new Float32Array(4);
    new Vec2(1, 2).toArray(buffer, 2);
    expect([...buffer]).toEqual([0, 0, 1, 2]);
  });

  it("returns fresh vectors from the allocating statics", () => {
    expect(Vec2.add({ x: 1, y: 2 }, { x: 3, y: 4 }).equalsWithEpsilon({ x: 4, y: 6 })).toBe(true);
    expect(Vec2.subtract({ x: 3, y: 4 }, { x: 1, y: 2 }).equalsWithEpsilon({ x: 2, y: 2 })).toBe(true);
    expect(Vec2.scale({ x: 1, y: 2 }, 3).equalsWithEpsilon({ x: 3, y: 6 })).toBe(true);
    expect(Vec2.normalize({ x: 0, y: 5 }).equalsWithEpsilon({ x: 0, y: 1 })).toBe(true);
    expect(Vec2.lerp(VEC2_ZERO, VEC2_ONE, 0.5).equalsWithEpsilon({ x: 0.5, y: 0.5 })).toBe(true);
  });

  it("writes into out and stays correct when out aliases an input", () => {
    const out = new Vec2();
    expect(Vec2.addToRef({ x: 1, y: 2 }, { x: 3, y: 4 }, out)).toBe(out);
    expect(out.equalsWithEpsilon({ x: 4, y: 6 })).toBe(true);
    expect(Vec2.multiplyToRef({ x: 2, y: 3 }, { x: 4, y: 5 }, out).equalsWithEpsilon({ x: 8, y: 15 })).toBe(true);
    expect(Vec2.negateToRef({ x: 1, y: 2 }, out).equalsWithEpsilon({ x: -1, y: -2 })).toBe(true);
    expect(Vec2.normalizeToRef(VEC2_ZERO, out).equalsWithEpsilon(VEC2_ZERO)).toBe(true);

    const a = new Vec2(1, 2);
    expect(Vec2.addToRef(a, { x: 1, y: 1 }, a).equalsWithEpsilon({ x: 2, y: 3 })).toBe(true);

    const b = new Vec2(1, 2);
    expect(Vec2.subtractToRef({ x: 5, y: 5 }, b, b).equalsWithEpsilon({ x: 4, y: 3 })).toBe(true);

    const c = new Vec2(2, 4);
    expect(Vec2.scaleToRef(c, 0.5, c).equalsWithEpsilon({ x: 1, y: 2 })).toBe(true);

    const d = new Vec2(0, 4);
    expect(Vec2.normalizeToRef(d, d).equalsWithEpsilon({ x: 0, y: 1 })).toBe(true);

    const e = new Vec2(4, 4);
    expect(Vec2.lerpToRef(VEC2_ZERO, e, 0.5, e).equalsWithEpsilon({ x: 2, y: 2 })).toBe(true);
  });
});
