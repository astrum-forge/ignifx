import { describe, expect, it } from "vitest";
import { Mat4 } from "../../src/math/mat4.js";
import { Quat } from "../../src/math/quat.js";
import {
  VEC3_BACKWARD,
  VEC3_DOWN,
  VEC3_FORWARD,
  VEC3_LEFT,
  VEC3_ONE,
  VEC3_RIGHT,
  VEC3_UP,
  VEC3_ZERO,
  Vec3,
} from "../../src/math/vec3.js";

describe("Vec3 construction", () => {
  it("defaults every component to zero", () => {
    const v = new Vec3();
    expect([v.x, v.y, v.z]).toEqual([0, 0, 0]);
  });

  it("copies from any vector-shaped value", () => {
    const v = Vec3.from({ x: 1, y: 2, z: 3 });
    expect([v.x, v.y, v.z]).toEqual([1, 2, 3]);
    expect(v.clone().equalsWithEpsilon(v)).toBe(true);
  });

  it("names the left-handed axes: forward is +Z and right is +X", () => {
    expect(Vec3.forward().equalsWithEpsilon({ x: 0, y: 0, z: 1 })).toBe(true);
    expect(Vec3.backward().equalsWithEpsilon({ x: 0, y: 0, z: -1 })).toBe(true);
    expect(Vec3.right().equalsWithEpsilon({ x: 1, y: 0, z: 0 })).toBe(true);
    expect(Vec3.left().equalsWithEpsilon({ x: -1, y: 0, z: 0 })).toBe(true);
    expect(Vec3.up().equalsWithEpsilon({ x: 0, y: 1, z: 0 })).toBe(true);
    expect(Vec3.down().equalsWithEpsilon({ x: 0, y: -1, z: 0 })).toBe(true);
    expect(Vec3.zero().equalsWithEpsilon({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(Vec3.one().equalsWithEpsilon({ x: 1, y: 1, z: 1 })).toBe(true);
  });

  it("hands out a fresh vector from every allocating static", () => {
    expect(Vec3.up()).not.toBe(Vec3.up());
  });
});

describe("Vec3 constants", () => {
  it("match their allocating counterparts", () => {
    expect(Vec3.equalsWithEpsilon(VEC3_ZERO, Vec3.zero())).toBe(true);
    expect(Vec3.equalsWithEpsilon(VEC3_ONE, Vec3.one())).toBe(true);
    expect(Vec3.equalsWithEpsilon(VEC3_UP, Vec3.up())).toBe(true);
    expect(Vec3.equalsWithEpsilon(VEC3_DOWN, Vec3.down())).toBe(true);
    expect(Vec3.equalsWithEpsilon(VEC3_LEFT, Vec3.left())).toBe(true);
    expect(Vec3.equalsWithEpsilon(VEC3_RIGHT, Vec3.right())).toBe(true);
    expect(Vec3.equalsWithEpsilon(VEC3_FORWARD, Vec3.forward())).toBe(true);
    expect(Vec3.equalsWithEpsilon(VEC3_BACKWARD, Vec3.backward())).toBe(true);
  });

  it("are frozen, so an accidental write throws instead of corrupting the world axes", () => {
    expect(Object.isFrozen(VEC3_UP)).toBe(true);
    expect(() => {
      (VEC3_UP as { x: number }).x = 99;
    }).toThrow(TypeError);
    expect(VEC3_UP.x).toBe(0);
  });
});

describe("Vec3 in-place operations", () => {
  it("return the receiver so calls chain", () => {
    const v = new Vec3(1, 2, 3);
    expect(v.add(VEC3_ONE).scale(2).negate()).toBe(v);
    expect([v.x, v.y, v.z]).toEqual([-4, -6, -8]);
  });

  it("adds, subtracts and multiplies component by component", () => {
    expect(new Vec3(1, 2, 3).add({ x: 1, y: 1, z: 1 }).equalsWithEpsilon({ x: 2, y: 3, z: 4 })).toBe(true);
    expect(new Vec3(1, 2, 3).subtract({ x: 1, y: 1, z: 1 }).equalsWithEpsilon({ x: 0, y: 1, z: 2 })).toBe(true);
    expect(new Vec3(1, 2, 3).multiply({ x: 2, y: 3, z: 4 }).equalsWithEpsilon({ x: 2, y: 6, z: 12 })).toBe(true);
  });

  it("adds a scaled vector without a temporary", () => {
    const position = new Vec3(0, 0, 0);
    position.addScaled({ x: 3, y: 0, z: 4 }, 0.5);
    expect(position.equalsWithEpsilon({ x: 1.5, y: 0, z: 2 })).toBe(true);
  });

  it("sets and copies", () => {
    const v = new Vec3();
    expect(v.set(1, 2, 3)).toBe(v);
    expect(v.copyFrom({ x: 4, y: 5, z: 6 }).equalsWithEpsilon({ x: 4, y: 5, z: 6 })).toBe(true);
  });

  it("normalizes to unit length and leaves a zero vector alone rather than producing NaN", () => {
    const v = new Vec3(0, 3, 4);
    expect(v.normalize().length()).toBeCloseTo(1, 12);
    const zero = new Vec3(0, 0, 0).normalize();
    expect(zero.equalsWithEpsilon(VEC3_ZERO)).toBe(true);
    expect(Number.isNaN(zero.x)).toBe(false);
  });

  it("crosses and lerps in place", () => {
    expect(new Vec3(1, 0, 0).cross({ x: 0, y: 1, z: 0 }).equalsWithEpsilon({ x: 0, y: 0, z: 1 })).toBe(true);
    expect(new Vec3(0, 0, 0).lerp({ x: 10, y: 20, z: 30 }, 0.5).equalsWithEpsilon({ x: 5, y: 10, z: 15 })).toBe(true);
  });

  it("keeps negative zero comparable with zero", () => {
    const negated = new Vec3(0, 0, 0).negate();
    expect(Object.is(negated.x, -0)).toBe(true);
    expect(negated.equalsWithEpsilon(VEC3_ZERO)).toBe(true);
  });
});

describe("Vec3 measurements", () => {
  it("measures length, squared length and distance", () => {
    const v = new Vec3(3, 4, 0);
    expect(v.length()).toBe(5);
    expect(v.lengthSquared()).toBe(25);
    expect(Vec3.length(v)).toBe(5);
    expect(Vec3.lengthSquared(v)).toBe(25);
    expect(v.distance({ x: 0, y: 0, z: 0 })).toBe(5);
    expect(v.distanceSquared({ x: 0, y: 0, z: 0 })).toBe(25);
    expect(Vec3.distance(v, VEC3_ZERO)).toBe(5);
    expect(Vec3.distanceSquared(v, VEC3_ZERO)).toBe(25);
  });

  it("dots vectors", () => {
    expect(new Vec3(1, 2, 3).dot({ x: 4, y: 5, z: 6 })).toBe(32);
    expect(Vec3.dot(VEC3_UP, VEC3_FORWARD)).toBe(0);
  });

  it("compares with a tolerance", () => {
    expect(new Vec3(1, 1, 1).equalsWithEpsilon({ x: 1 + 1e-9, y: 1, z: 1 })).toBe(true);
    expect(new Vec3(1, 1, 1).equalsWithEpsilon({ x: 1.5, y: 1, z: 1 })).toBe(false);
    expect(Vec3.equalsWithEpsilon(new Vec3(1, 1, 1), new Vec3(1.4, 1, 1), 0.5)).toBe(true);
  });

  it("writes into a Float32Array at an offset", () => {
    const buffer = new Float32Array(6);
    new Vec3(1, 2, 3).toArray(buffer, 3);
    expect([...buffer]).toEqual([0, 0, 0, 1, 2, 3]);
  });
});

describe("Vec3 allocating statics", () => {
  it("return fresh vectors", () => {
    const a = new Vec3(1, 2, 3);
    const b = new Vec3(4, 5, 6);
    expect(Vec3.add(a, b).equalsWithEpsilon({ x: 5, y: 7, z: 9 })).toBe(true);
    expect(Vec3.subtract(b, a).equalsWithEpsilon({ x: 3, y: 3, z: 3 })).toBe(true);
    expect(Vec3.scale(a, 2).equalsWithEpsilon({ x: 2, y: 4, z: 6 })).toBe(true);
    expect(Vec3.cross(VEC3_RIGHT, VEC3_UP).equalsWithEpsilon(VEC3_FORWARD)).toBe(true);
    expect(Vec3.normalize(new Vec3(0, 0, 5)).equalsWithEpsilon(VEC3_FORWARD)).toBe(true);
    expect(Vec3.lerp(VEC3_ZERO, VEC3_ONE, 0.25).equalsWithEpsilon({ x: 0.25, y: 0.25, z: 0.25 })).toBe(true);
    expect(a.equalsWithEpsilon({ x: 1, y: 2, z: 3 })).toBe(true);
  });

  it("crosses right by up into forward, which is what left-handedness means here", () => {
    expect(Vec3.cross(VEC3_UP, VEC3_FORWARD).equalsWithEpsilon(VEC3_RIGHT)).toBe(true);
    expect(Vec3.cross(VEC3_FORWARD, VEC3_RIGHT).equalsWithEpsilon(VEC3_UP)).toBe(true);
  });
});

describe("Vec3 ToRef statics", () => {
  it("write into out and return it", () => {
    const out = new Vec3();
    expect(Vec3.addToRef({ x: 1, y: 2, z: 3 }, { x: 1, y: 1, z: 1 }, out)).toBe(out);
    expect(out.equalsWithEpsilon({ x: 2, y: 3, z: 4 })).toBe(true);
    expect(
      Vec3.subtractToRef({ x: 1, y: 2, z: 3 }, { x: 1, y: 1, z: 1 }, out).equalsWithEpsilon({ x: 0, y: 1, z: 2 }),
    ).toBe(true);
    expect(
      Vec3.multiplyToRef({ x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 2 }, out).equalsWithEpsilon({ x: 2, y: 4, z: 6 }),
    ).toBe(true);
    expect(Vec3.scaleToRef({ x: 1, y: 2, z: 3 }, 3, out).equalsWithEpsilon({ x: 3, y: 6, z: 9 })).toBe(true);
    expect(Vec3.negateToRef({ x: 1, y: 2, z: 3 }, out).equalsWithEpsilon({ x: -1, y: -2, z: -3 })).toBe(true);
    expect(Vec3.normalizeToRef({ x: 0, y: 10, z: 0 }, out).equalsWithEpsilon(VEC3_UP)).toBe(true);
    expect(Vec3.normalizeToRef(VEC3_ZERO, out).equalsWithEpsilon(VEC3_ZERO)).toBe(true);
    expect(Vec3.crossToRef(VEC3_RIGHT, VEC3_UP, out).equalsWithEpsilon(VEC3_FORWARD)).toBe(true);
    expect(Vec3.lerpToRef(VEC3_ZERO, VEC3_ONE, 0.5, out).equalsWithEpsilon({ x: 0.5, y: 0.5, z: 0.5 })).toBe(true);
    expect(Vec3.minToRef({ x: 1, y: 5, z: 3 }, { x: 4, y: 2, z: 3 }, out).equalsWithEpsilon({ x: 1, y: 2, z: 3 })).toBe(
      true,
    );
    expect(Vec3.maxToRef({ x: 1, y: 5, z: 3 }, { x: 4, y: 2, z: 3 }, out).equalsWithEpsilon({ x: 4, y: 5, z: 3 })).toBe(
      true,
    );
  });

  it("are correct when out aliases the first input", () => {
    const a = new Vec3(1, 2, 3);
    const b = new Vec3(4, 5, 6);
    expect(Vec3.addToRef(a, b, a).equalsWithEpsilon({ x: 5, y: 7, z: 9 })).toBe(true);

    const c = new Vec3(1, 2, 3);
    expect(Vec3.subtractToRef(c, b, c).equalsWithEpsilon({ x: -3, y: -3, z: -3 })).toBe(true);

    const d = new Vec3(1, 0, 0);
    expect(Vec3.crossToRef(d, { x: 0, y: 1, z: 0 }, d).equalsWithEpsilon(VEC3_FORWARD)).toBe(true);

    const e = new Vec3(0, 0, 0);
    expect(Vec3.lerpToRef(e, VEC3_ONE, 0.5, e).equalsWithEpsilon({ x: 0.5, y: 0.5, z: 0.5 })).toBe(true);

    const f = new Vec3(0, 0, 9);
    expect(Vec3.normalizeToRef(f, f).equalsWithEpsilon(VEC3_FORWARD)).toBe(true);
  });

  it("are correct when out aliases the second input", () => {
    const a = new Vec3(1, 2, 3);
    const b = new Vec3(4, 5, 6);
    expect(Vec3.subtractToRef(a, b, b).equalsWithEpsilon({ x: -3, y: -3, z: -3 })).toBe(true);

    const c = new Vec3(0, 1, 0);
    expect(Vec3.crossToRef({ x: 1, y: 0, z: 0 }, c, c).equalsWithEpsilon(VEC3_FORWARD)).toBe(true);

    const d = new Vec3(1, 1, 1);
    expect(Vec3.minToRef({ x: 0, y: 2, z: 0 }, d, d).equalsWithEpsilon({ x: 0, y: 1, z: 0 })).toBe(true);

    const e = new Vec3(1, 1, 1);
    expect(Vec3.maxToRef({ x: 0, y: 2, z: 0 }, e, e).equalsWithEpsilon({ x: 1, y: 2, z: 1 })).toBe(true);

    const f = new Vec3(2, 2, 2);
    expect(Vec3.lerpToRef(VEC3_ZERO, f, 0.5, f).equalsWithEpsilon({ x: 1, y: 1, z: 1 })).toBe(true);
  });
});

describe("Vec3 matrix transforms", () => {
  it("transforms a coordinate with the matrix translation and a normal without it", () => {
    const m = Mat4.translation(10, 0, 0);
    const point = new Vec3();
    const normal = new Vec3();
    Vec3.transformCoordinatesToRef({ x: 1, y: 2, z: 3 }, m.elements, point);
    Vec3.transformNormalToRef({ x: 1, y: 2, z: 3 }, m.elements, normal);
    expect(point.equalsWithEpsilon({ x: 11, y: 2, z: 3 })).toBe(true);
    expect(normal.equalsWithEpsilon({ x: 1, y: 2, z: 3 })).toBe(true);
  });

  it("rotates (1, 0, 0) by 90 degrees about +Y onto (0, 0, -1)", () => {
    const m = Mat4.fromQuat(Quat.fromEulerDegrees(0, 90, 0));
    const out = new Vec3();
    Vec3.transformNormalToRef(VEC3_RIGHT, m.elements, out);
    expect(out.equalsWithEpsilon({ x: 0, y: 0, z: -1 })).toBe(true);
  });

  it("is safe when out aliases the input", () => {
    const v = new Vec3(1, 2, 3);
    Vec3.transformCoordinatesToRef(v, Mat4.translation(1, 1, 1).elements, v);
    expect(v.equalsWithEpsilon({ x: 2, y: 3, z: 4 })).toBe(true);
  });
});
