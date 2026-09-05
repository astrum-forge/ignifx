import { describe, expect, it } from "vitest";
import { Mat4 } from "../../src/math/mat4.js";
import { Quat, QUAT_IDENTITY } from "../../src/math/quat.js";
import { VEC3_FORWARD, VEC3_RIGHT, VEC3_UP, Vec3 } from "../../src/math/vec3.js";

describe("Quat construction", () => {
  it("defaults to the identity rotation", () => {
    const q = new Quat();
    expect([q.x, q.y, q.z, q.w]).toEqual([0, 0, 0, 1]);
    expect(Quat.identity().equalsWithEpsilon(QUAT_IDENTITY)).toBe(true);
    expect(Quat.from(QUAT_IDENTITY).equalsWithEpsilon(new Quat())).toBe(true);
    expect(new Quat(1, 2, 3, 4).clone().equalsWithEpsilon(new Quat(1, 2, 3, 4))).toBe(true);
  });

  it("has a frozen identity constant", () => {
    expect(Object.isFrozen(QUAT_IDENTITY)).toBe(true);
    expect(() => {
      (QUAT_IDENTITY as { w: number }).w = 0;
    }).toThrow(TypeError);
    expect(QUAT_IDENTITY.w).toBe(1);
  });

  it("sets, copies and resets", () => {
    const q = new Quat();
    expect(q.set(1, 0, 0, 0)).toBe(q);
    expect(q.copyFrom({ x: 0, y: 1, z: 0, w: 0 }).equalsWithEpsilon({ x: 0, y: 1, z: 0, w: 0 })).toBe(true);
    expect(q.identity().equalsWithEpsilon(QUAT_IDENTITY)).toBe(true);
  });

  it("writes into a Float32Array at an offset", () => {
    const buffer = new Float32Array(8);
    new Quat(1, 2, 3, 4).toArray(buffer, 4);
    expect([...buffer]).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });
});

describe("Quat rotation conventions", () => {
  it("turns +Z onto +X for a 90 degree yaw, the left-handed answer", () => {
    const yaw = Quat.fromEulerDegrees(0, 90, 0);
    const out = new Vec3();
    Quat.rotateVectorToRef(yaw, VEC3_FORWARD, out);
    expect(out.equalsWithEpsilon(VEC3_RIGHT)).toBe(true);
  });

  it("turns (1, 0, 0) onto (0, 0, -1) for a 90 degree yaw", () => {
    const out = new Vec3();
    Quat.rotateVectorToRef(Quat.fromEulerDegrees(0, 90, 0), VEC3_RIGHT, out);
    expect(out.equalsWithEpsilon({ x: 0, y: 0, z: -1 })).toBe(true);
  });

  it("builds the same rotation from Euler degrees and from an axis and angle", () => {
    const euler = Quat.fromEulerDegrees(0, 90, 0);
    const axisAngle = Quat.fromAxisAngle(VEC3_UP, 90);
    expect(euler.equalsWithEpsilon(axisAngle)).toBe(true);
    expect(Quat.fromEulerRadians(0, Math.PI / 2, 0).equalsWithEpsilon(euler)).toBe(true);
  });

  it("writes the identity for a zero-length axis", () => {
    expect(Quat.fromAxisAngle({ x: 0, y: 0, z: 0 }, 45).equalsWithEpsilon(QUAT_IDENTITY)).toBe(true);
  });

  it("round-trips Euler degrees through the quaternion and back", () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [0, 0, 0],
      [30, 0, 0],
      [0, 45, 0],
      [0, 0, 60],
      [10, 20, 30],
      [-25, 80, 15],
    ];
    const out = new Vec3();
    for (const [x, y, z] of cases) {
      Quat.toEulerDegreesToRef(Quat.fromEulerDegrees(x, y, z), out);
      expect(out.x).toBeCloseTo(x, 6);
      expect(out.y).toBeCloseTo(y, 6);
      expect(out.z).toBeCloseTo(z, 6);
    }
  });

  it("clamps the Y angle at the pole instead of returning NaN", () => {
    const out = new Vec3();
    Quat.toEulerRadiansToRef(Quat.fromEulerDegrees(0, 90, 0), out);
    expect(out.y).toBeCloseTo(Math.PI / 2, 9);
    expect(Number.isNaN(out.x)).toBe(false);
  });
});

describe("Quat composition", () => {
  it("multiplies the way the matrices do, which is how Lite composes transforms", () => {
    const a = Quat.fromEulerDegrees(15, 40, 5);
    const b = Quat.fromEulerDegrees(-30, 10, 70);
    const quatProduct = Mat4.fromQuat(Quat.multiply(a, b));
    const matrixProduct = Mat4.multiply(Mat4.fromQuat(a).elements, Mat4.fromQuat(b).elements);
    expect(quatProduct.equalsWithEpsilon(matrixProduct.elements, 1e-5)).toBe(true);
  });

  it("applies the right-hand rotation first when rotating a vector", () => {
    const a = Quat.fromEulerDegrees(0, 90, 0);
    const b = Quat.fromEulerDegrees(90, 0, 0);
    const composed = new Vec3();
    const stepwise = new Vec3();
    Quat.rotateVectorToRef(Quat.multiply(a, b), VEC3_FORWARD, composed);
    Quat.rotateVectorToRef(b, VEC3_FORWARD, stepwise);
    Quat.rotateVectorToRef(a, stepwise, stepwise);
    expect(composed.equalsWithEpsilon(stepwise, 1e-6)).toBe(true);
  });

  it("cancels a rotation with its inverse", () => {
    const q = Quat.fromEulerDegrees(21, 33, 47);
    const inverse = q.clone().invert();
    expect(Quat.multiply(q, inverse).equalsWithEpsilon(QUAT_IDENTITY, 1e-6)).toBe(true);
    expect(q.clone().conjugate().equalsWithEpsilon(inverse, 1e-6)).toBe(true);
  });

  it("writes the identity when inverting or normalizing a zero quaternion", () => {
    expect(new Quat(0, 0, 0, 0).invert().equalsWithEpsilon(QUAT_IDENTITY)).toBe(true);
    expect(new Quat(0, 0, 0, 0).normalize().equalsWithEpsilon(QUAT_IDENTITY)).toBe(true);
  });

  it("normalizes a drifted rotation back to unit length", () => {
    const q = new Quat(0, 2, 0, 2);
    expect(q.lengthSquared()).toBeCloseTo(8, 12);
    expect(q.normalize().length()).toBeCloseTo(1, 12);
  });

  it("measures the angle between rotations", () => {
    expect(Quat.angleDegrees(QUAT_IDENTITY, Quat.fromEulerDegrees(0, 90, 0))).toBeCloseTo(90, 6);
    expect(Quat.angleDegrees(QUAT_IDENTITY, QUAT_IDENTITY)).toBeCloseTo(0, 9);
    expect(Quat.dot(QUAT_IDENTITY, QUAT_IDENTITY)).toBe(1);
    expect(new Quat().dot(QUAT_IDENTITY)).toBe(1);
  });
});

describe("Quat slerp", () => {
  it("returns the endpoints at 0 and 1", () => {
    const a = Quat.fromEulerDegrees(0, 0, 0);
    const b = Quat.fromEulerDegrees(0, 90, 0);
    expect(Quat.slerp(a, b, 0).equalsWithEpsilon(a, 1e-6)).toBe(true);
    expect(Quat.slerp(a, b, 1).equalsWithEpsilon(b, 1e-6)).toBe(true);
  });

  it("passes through the halfway rotation", () => {
    const a = Quat.fromEulerDegrees(0, 0, 0);
    const b = Quat.fromEulerDegrees(0, 90, 0);
    const half = Quat.slerp(a, b, 0.5);
    expect(Quat.angleDegrees(a, half)).toBeCloseTo(45, 5);
    expect(Quat.angleDegrees(half, b)).toBeCloseTo(45, 5);
  });

  it("takes the short way round when the endpoints face away from each other", () => {
    const a = Quat.fromEulerDegrees(0, 0, 0);
    const b = Quat.fromEulerDegrees(0, 90, 0);
    const negated = new Quat(-b.x, -b.y, -b.z, -b.w);
    const direct = Quat.slerp(a, b, 0.5);
    const viaNegated = Quat.slerp(a, negated, 0.5);
    expect(Quat.angleDegrees(direct, viaNegated)).toBeCloseTo(0, 5);
  });

  it("falls back to a linear blend for nearly identical rotations", () => {
    const a = Quat.fromEulerDegrees(0, 0, 0);
    const b = Quat.fromEulerDegrees(0, 1e-5, 0);
    const mid = Quat.slerp(a, b, 0.5);
    expect(mid.length()).toBeCloseTo(1, 9);
    expect(Quat.angleDegrees(a, mid)).toBeLessThan(1e-4);
  });
});

describe("Quat lookRotation", () => {
  it("is the identity when already looking along +Z", () => {
    expect(Quat.lookRotation(VEC3_FORWARD).equalsWithEpsilon(QUAT_IDENTITY, 1e-6)).toBe(true);
  });

  it("points local +Z along the requested direction", () => {
    const look = Quat.lookRotation(VEC3_RIGHT);
    const out = new Vec3();
    Quat.rotateVectorToRef(look, VEC3_FORWARD, out);
    expect(out.equalsWithEpsilon(VEC3_RIGHT, 1e-6)).toBe(true);
    expect(look.equalsWithEpsilon(Quat.fromEulerDegrees(0, 90, 0), 1e-6)).toBe(true);
  });

  it("keeps local +Y as close to up as it can", () => {
    const look = Quat.lookRotation({ x: 1, y: 0, z: 1 }, VEC3_UP);
    const up = new Vec3();
    Quat.rotateVectorToRef(look, VEC3_UP, up);
    expect(up.equalsWithEpsilon(VEC3_UP, 1e-6)).toBe(true);
  });

  it("writes the identity for degenerate input instead of a meaningless basis", () => {
    expect(Quat.lookRotation({ x: 0, y: 0, z: 0 }).equalsWithEpsilon(QUAT_IDENTITY)).toBe(true);
    expect(Quat.lookRotation(VEC3_UP, VEC3_UP).equalsWithEpsilon(QUAT_IDENTITY)).toBe(true);
  });
});

describe("Quat and matrices", () => {
  it("round-trips a rotation through a matrix", () => {
    const q = Quat.fromEulerDegrees(12, 34, 56);
    const recovered = Quat.fromRotationMatrix(Mat4.fromQuat(q).elements);
    expect(recovered.equalsWithEpsilon(q, 1e-6)).toBe(true);
  });

  it("recovers the rotation from every branch of the trace decision", () => {
    const cases: readonly Quat[] = [
      Quat.fromEulerDegrees(0, 0, 0),
      Quat.fromAxisAngle(VEC3_RIGHT, 180),
      Quat.fromAxisAngle(VEC3_UP, 180),
      Quat.fromAxisAngle(VEC3_FORWARD, 180),
    ];
    for (const q of cases) {
      const recovered = Quat.fromRotationMatrix(Mat4.fromQuat(q).elements);
      expect(Quat.angleDegrees(recovered, q)).toBeCloseTo(0, 4);
    }
  });
});

describe("Quat ToRef aliasing", () => {
  it("multiplies correctly when out aliases either input", () => {
    const a = Quat.fromEulerDegrees(0, 90, 0);
    const b = Quat.fromEulerDegrees(90, 0, 0);
    const expected = Quat.multiply(a, b);

    const aliasA = a.clone();
    expect(Quat.multiplyToRef(aliasA, b, aliasA).equalsWithEpsilon(expected, 1e-9)).toBe(true);

    const aliasB = b.clone();
    expect(Quat.multiplyToRef(a, aliasB, aliasB).equalsWithEpsilon(expected, 1e-9)).toBe(true);
  });

  it("conjugates, inverts and normalizes in place", () => {
    const q = new Quat(0, 2, 0, 2);
    expect(Quat.conjugateToRef(q, q).equalsWithEpsilon({ x: 0, y: -2, z: 0, w: 2 })).toBe(true);
    const r = Quat.fromEulerDegrees(0, 90, 0);
    expect(Quat.invertToRef(r, r).equalsWithEpsilon(Quat.fromEulerDegrees(0, -90, 0), 1e-9)).toBe(true);
    const s = new Quat(0, 3, 0, 0);
    expect(Quat.normalizeToRef(s, s).equalsWithEpsilon({ x: 0, y: 1, z: 0, w: 0 })).toBe(true);
  });

  it("slerps correctly when out aliases either endpoint", () => {
    const a = Quat.fromEulerDegrees(0, 0, 0);
    const b = Quat.fromEulerDegrees(0, 90, 0);
    const expected = Quat.slerp(a, b, 0.25);

    const aliasA = a.clone();
    expect(Quat.slerpToRef(aliasA, b, 0.25, aliasA).equalsWithEpsilon(expected, 1e-9)).toBe(true);

    const aliasB = b.clone();
    expect(Quat.slerpToRef(a, aliasB, 0.25, aliasB).equalsWithEpsilon(expected, 1e-9)).toBe(true);
  });

  it("rotates a vector correctly when out aliases the vector", () => {
    const v = new Vec3(0, 0, 1);
    Quat.rotateVectorToRef(Quat.fromEulerDegrees(0, 90, 0), v, v);
    expect(v.equalsWithEpsilon(VEC3_RIGHT, 1e-9)).toBe(true);
  });

  it("writes Euler degrees and radians into a supplied vector", () => {
    const degrees = new Vec3();
    const radians = new Vec3();
    const q = Quat.fromEulerDegrees(0, 90, 0);
    expect(Quat.toEulerDegreesToRef(q, degrees)).toBe(degrees);
    expect(Quat.toEulerRadiansToRef(q, radians)).toBe(radians);
    expect(degrees.y).toBeCloseTo(90, 6);
    expect(radians.y).toBeCloseTo(Math.PI / 2, 6);
  });

  it("multiplies in place through the instance method", () => {
    const q = Quat.fromEulerDegrees(0, 45, 0);
    q.multiply(Quat.fromEulerDegrees(0, 45, 0));
    expect(q.equalsWithEpsilon(Quat.fromEulerDegrees(0, 90, 0), 1e-9)).toBe(true);
  });

  it("compares with a tolerance", () => {
    expect(new Quat(0, 0, 0, 1).equalsWithEpsilon({ x: 0, y: 0, z: 1e-9, w: 1 })).toBe(true);
    expect(new Quat(0, 0, 0, 1).equalsWithEpsilon({ x: 0, y: 0, z: 0.5, w: 1 })).toBe(false);
  });
});
