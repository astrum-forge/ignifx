import { describe, expect, it } from "vitest";
import { Vec4 } from "../../src/math/vec4.js";

describe("Vec4", () => {
  it("defaults to zero, including w", () => {
    const v = new Vec4();
    expect([v.x, v.y, v.z, v.w]).toEqual([0, 0, 0, 0]);
    expect(Vec4.zero().equalsWithEpsilon(v)).toBe(true);
    expect(Vec4.one().equalsWithEpsilon({ x: 1, y: 1, z: 1, w: 1 })).toBe(true);
    expect(Vec4.from({ x: 1, y: 2, z: 3, w: 4 }).clone().equalsWithEpsilon({ x: 1, y: 2, z: 3, w: 4 })).toBe(true);
  });

  it("chains in-place operations", () => {
    const v = new Vec4();
    expect(v.set(1, 2, 3, 4)).toBe(v);
    expect(
      v
        .copyFrom({ x: 1, y: 1, z: 1, w: 1 })
        .add({ x: 1, y: 1, z: 1, w: 1 })
        .equalsWithEpsilon({ x: 2, y: 2, z: 2, w: 2 }),
    ).toBe(true);
    expect(
      new Vec4(2, 2, 2, 2).subtract({ x: 1, y: 1, z: 1, w: 1 }).equalsWithEpsilon({ x: 1, y: 1, z: 1, w: 1 }),
    ).toBe(true);
    expect(
      new Vec4(1, 2, 3, 4).multiply({ x: 2, y: 2, z: 2, w: 2 }).equalsWithEpsilon({ x: 2, y: 4, z: 6, w: 8 }),
    ).toBe(true);
    expect(new Vec4(1, 2, 3, 4).scale(2).equalsWithEpsilon({ x: 2, y: 4, z: 6, w: 8 })).toBe(true);
    expect(new Vec4(1, 2, 3, 4).negate().equalsWithEpsilon({ x: -1, y: -2, z: -3, w: -4 })).toBe(true);
    expect(
      new Vec4(0, 0, 0, 0).lerp({ x: 4, y: 4, z: 4, w: 4 }, 0.25).equalsWithEpsilon({ x: 1, y: 1, z: 1, w: 1 }),
    ).toBe(true);
  });

  it("normalizes, and leaves a zero vector alone rather than producing NaN", () => {
    expect(new Vec4(0, 0, 3, 4).normalize().length()).toBeCloseTo(1, 12);
    const zero = new Vec4(0, 0, 0, 0).normalize();
    expect(zero.equalsWithEpsilon(Vec4.zero())).toBe(true);
    expect(Number.isNaN(zero.w)).toBe(false);
  });

  it("measures length and dot", () => {
    const v = new Vec4(0, 0, 3, 4);
    expect(v.length()).toBe(5);
    expect(v.lengthSquared()).toBe(25);
    expect(Vec4.length(v)).toBe(5);
    expect(Vec4.lengthSquared(v)).toBe(25);
    expect(v.dot({ x: 0, y: 0, z: 1, w: 0 })).toBe(3);
    expect(Vec4.dot(v, { x: 0, y: 0, z: 0, w: 1 })).toBe(4);
  });

  it("compares with a tolerance and writes into a Float32Array", () => {
    expect(new Vec4(1, 1, 1, 1).equalsWithEpsilon({ x: 1 + 1e-9, y: 1, z: 1, w: 1 })).toBe(true);
    expect(new Vec4(1, 1, 1, 1).equalsWithEpsilon({ x: 1, y: 1, z: 1, w: 2 })).toBe(false);
    expect(Vec4.equalsWithEpsilon({ x: 1, y: 1, z: 1, w: 1 }, { x: 1, y: 1, z: 1, w: 1.4 }, 0.5)).toBe(true);
    const buffer = new Float32Array(8);
    new Vec4(1, 2, 3, 4).toArray(buffer, 4);
    expect([...buffer]).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });

  it("returns fresh vectors from the allocating statics", () => {
    expect(
      Vec4.add({ x: 1, y: 1, z: 1, w: 1 }, { x: 1, y: 1, z: 1, w: 1 }).equalsWithEpsilon({ x: 2, y: 2, z: 2, w: 2 }),
    ).toBe(true);
    expect(
      Vec4.subtract({ x: 2, y: 2, z: 2, w: 2 }, { x: 1, y: 1, z: 1, w: 1 }).equalsWithEpsilon({
        x: 1,
        y: 1,
        z: 1,
        w: 1,
      }),
    ).toBe(true);
    expect(Vec4.scale({ x: 1, y: 1, z: 1, w: 1 }, 3).equalsWithEpsilon({ x: 3, y: 3, z: 3, w: 3 })).toBe(true);
    expect(Vec4.normalize({ x: 0, y: 0, z: 0, w: 2 }).equalsWithEpsilon({ x: 0, y: 0, z: 0, w: 1 })).toBe(true);
    expect(Vec4.lerp(Vec4.zero(), Vec4.one(), 0.5).equalsWithEpsilon({ x: 0.5, y: 0.5, z: 0.5, w: 0.5 })).toBe(true);
  });

  it("writes into out and stays correct when out aliases an input", () => {
    const out = new Vec4();
    expect(Vec4.addToRef({ x: 1, y: 1, z: 1, w: 1 }, { x: 1, y: 1, z: 1, w: 1 }, out)).toBe(out);
    expect(out.equalsWithEpsilon({ x: 2, y: 2, z: 2, w: 2 })).toBe(true);
    expect(
      Vec4.multiplyToRef({ x: 2, y: 2, z: 2, w: 2 }, { x: 3, y: 3, z: 3, w: 3 }, out).equalsWithEpsilon({
        x: 6,
        y: 6,
        z: 6,
        w: 6,
      }),
    ).toBe(true);
    expect(Vec4.negateToRef({ x: 1, y: 1, z: 1, w: 1 }, out).equalsWithEpsilon({ x: -1, y: -1, z: -1, w: -1 })).toBe(
      true,
    );
    expect(Vec4.normalizeToRef(Vec4.zero(), out).equalsWithEpsilon(Vec4.zero())).toBe(true);

    const a = new Vec4(1, 1, 1, 1);
    expect(Vec4.addToRef(a, { x: 1, y: 1, z: 1, w: 1 }, a).equalsWithEpsilon({ x: 2, y: 2, z: 2, w: 2 })).toBe(true);

    const b = new Vec4(1, 1, 1, 1);
    expect(Vec4.subtractToRef({ x: 3, y: 3, z: 3, w: 3 }, b, b).equalsWithEpsilon({ x: 2, y: 2, z: 2, w: 2 })).toBe(
      true,
    );

    const c = new Vec4(2, 2, 2, 2);
    expect(Vec4.scaleToRef(c, 0.5, c).equalsWithEpsilon({ x: 1, y: 1, z: 1, w: 1 })).toBe(true);

    const d = new Vec4(0, 0, 0, 4);
    expect(Vec4.normalizeToRef(d, d).equalsWithEpsilon({ x: 0, y: 0, z: 0, w: 1 })).toBe(true);

    const e = new Vec4(4, 4, 4, 4);
    expect(Vec4.lerpToRef(Vec4.zero(), e, 0.5, e).equalsWithEpsilon({ x: 2, y: 2, z: 2, w: 2 })).toBe(true);
  });
});
