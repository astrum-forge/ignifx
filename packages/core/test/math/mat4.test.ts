import { describe, expect, it } from "vitest";
import { MAT4_IDENTITY, Mat4 } from "../../src/math/mat4.js";
import { Quat } from "../../src/math/quat.js";
import { VEC3_FORWARD, VEC3_UP, Vec3 } from "../../src/math/vec3.js";
import type { Mat4Like } from "../../src/math/types.js";

/**
 * Projects a point and returns its clip-space depth. `transformPointToRef` already performs the
 * perspective divide, so this is exactly what the rasterizer would see.
 */
function clipDepth(projection: Mat4, x: number, y: number, z: number): number {
  return Mat4.transformPointToRef(projection.elements, { x, y, z }, new Vec3()).z;
}

describe("Mat4 storage", () => {
  it("is a 16-element Float32Array in column-major order, with translation in slots 12 to 14", () => {
    const m = Mat4.translation(1, 2, 3);
    expect(m.elements).toBeInstanceOf(Float32Array);
    expect(m.elements.length).toBe(16);
    expect([...m.elements]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
  });

  it("starts out as the identity and can be reset to it", () => {
    const m = new Mat4();
    expect(m.equalsWithEpsilon(MAT4_IDENTITY)).toBe(true);
    m.copyFrom(Mat4.scaling(2, 2, 2).elements);
    expect(m.equalsWithEpsilon(MAT4_IDENTITY)).toBe(false);
    expect(m.identity().equalsWithEpsilon(MAT4_IDENTITY)).toBe(true);
    expect(Mat4.identity().equalsWithEpsilon(MAT4_IDENTITY)).toBe(true);
    expect(Mat4.from(MAT4_IDENTITY).equalsWithEpsilon(MAT4_IDENTITY)).toBe(true);
    expect(m.clone().equalsWithEpsilon(m.elements)).toBe(true);
  });

  it("has a frozen identity constant", () => {
    expect(Object.isFrozen(MAT4_IDENTITY)).toBe(true);
    expect(MAT4_IDENTITY.length).toBe(16);
    expect(() => {
      (MAT4_IDENTITY as { length: number }).length = 4;
    }).toThrow(TypeError);
  });

  it("builds scaling matrices", () => {
    expect([...Mat4.scaling(2, 3, 4).elements]).toEqual([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);
  });
});

describe("Mat4 multiplication", () => {
  it("leaves a matrix unchanged when multiplied by the identity", () => {
    const m = Mat4.compose({ x: 1, y: 2, z: 3 }, Quat.fromEulerDegrees(10, 20, 30), { x: 2, y: 2, z: 2 });
    expect(Mat4.multiply(m.elements, MAT4_IDENTITY).equalsWithEpsilon(m.elements, 1e-6)).toBe(true);
    expect(Mat4.multiply(MAT4_IDENTITY, m.elements).equalsWithEpsilon(m.elements, 1e-6)).toBe(true);
  });

  it("applies the right-hand matrix first", () => {
    const translate = Mat4.translation(10, 0, 0);
    const scale = Mat4.scaling(2, 2, 2);
    const scaleThenTranslate = Mat4.multiply(translate.elements, scale.elements);
    const out = new Vec3();
    Mat4.transformPointToRef(scaleThenTranslate.elements, { x: 1, y: 0, z: 0 }, out);
    expect(out.equalsWithEpsilon({ x: 12, y: 0, z: 0 })).toBe(true);
  });

  it("is correct when out aliases either input", () => {
    const a = Mat4.translation(1, 2, 3);
    const b = Mat4.scaling(2, 2, 2);
    const expected = Mat4.multiply(a.elements, b.elements);

    const aliasA = a.clone();
    expect(Mat4.multiplyToRef(aliasA.elements, b.elements, aliasA).equalsWithEpsilon(expected.elements)).toBe(true);

    const aliasB = b.clone();
    expect(Mat4.multiplyToRef(a.elements, aliasB.elements, aliasB).equalsWithEpsilon(expected.elements)).toBe(true);

    const chained = a.clone().multiply(b.elements);
    expect(chained.equalsWithEpsilon(expected.elements)).toBe(true);
  });
});

describe("Mat4 inversion", () => {
  it("multiplies back to the identity", () => {
    const m = Mat4.compose({ x: 5, y: -2, z: 1 }, Quat.fromEulerDegrees(23, 45, 67), { x: 2, y: 0.5, z: 3 });
    const inverse = new Mat4();
    expect(Mat4.invertToRef(m.elements, inverse)).toBe(true);
    expect(Mat4.multiply(m.elements, inverse.elements).equalsWithEpsilon(MAT4_IDENTITY, 1e-5)).toBe(true);
  });

  it("inverts in place", () => {
    const m = Mat4.translation(3, 4, 5);
    const original = m.clone();
    expect(m.invert()).toBe(true);
    expect(Mat4.multiply(original.elements, m.elements).equalsWithEpsilon(MAT4_IDENTITY, 1e-6)).toBe(true);
  });

  it("reports failure and leaves out untouched for a singular matrix", () => {
    const singular = Mat4.scaling(1, 0, 1);
    const out = Mat4.translation(9, 9, 9);
    expect(Mat4.invertToRef(singular.elements, out)).toBe(false);
    expect(out.equalsWithEpsilon(Mat4.translation(9, 9, 9).elements)).toBe(true);
    expect(singular.invert()).toBe(false);
  });
});

describe("Mat4 transpose and determinant", () => {
  it("returns to the original after two transposes", () => {
    const m = Mat4.compose({ x: 1, y: 2, z: 3 }, Quat.fromEulerDegrees(10, 20, 30), { x: 1, y: 2, z: 3 });
    const original = m.clone();
    expect(m.transpose().transpose().equalsWithEpsilon(original.elements)).toBe(true);
  });

  it("moves translation from the last column to the last row", () => {
    const transposed = Mat4.transposeToRef(Mat4.translation(1, 2, 3).elements, new Mat4());
    expect([...transposed.elements]).toEqual([1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1]);
  });

  it("measures the determinant", () => {
    expect(new Mat4().determinant()).toBeCloseTo(1, 9);
    expect(Mat4.determinant(Mat4.scaling(2, 3, 4).elements)).toBeCloseTo(24, 9);
    expect(Mat4.determinant(Mat4.scaling(1, 0, 1).elements)).toBeCloseTo(0, 9);
  });
});

describe("Mat4 compose and decompose", () => {
  it("round-trips translation, rotation and scale", () => {
    const position = new Vec3(1.5, -2.25, 3);
    const rotation = Quat.fromEulerDegrees(15, 40, -25);
    const scale = new Vec3(2, 3, 0.5);
    const m = Mat4.compose(position, rotation, scale);

    const outPosition = new Vec3();
    const outRotation = new Quat();
    const outScale = new Vec3();
    expect(Mat4.decomposeToRef(m.elements, outPosition, outRotation, outScale)).toBe(true);
    expect(outPosition.equalsWithEpsilon(position, 1e-5)).toBe(true);
    expect(outScale.equalsWithEpsilon(scale, 1e-5)).toBe(true);
    expect(Quat.angleDegrees(outRotation, rotation)).toBeCloseTo(0, 3);
  });

  it("reports a mirrored matrix as a negative Y scale, the way Lite's mat4Decompose does", () => {
    const m = Mat4.compose({ x: 0, y: 0, z: 0 }, Quat.identity(), { x: 1, y: -1, z: 1 });
    const outScale = new Vec3();
    expect(Mat4.decomposeToRef(m.elements, new Vec3(), new Quat(), outScale)).toBe(true);
    expect(outScale.y).toBeCloseTo(-1, 6);
    expect(Mat4.getScaleToRef(m.elements, new Vec3()).y).toBeCloseTo(-1, 6);
  });

  it("refuses to decompose a degenerate matrix and leaves the outputs alone", () => {
    const outPosition = new Vec3(7, 7, 7);
    const outRotation = new Quat(0, 0, 0, 1);
    const outScale = new Vec3(7, 7, 7);
    expect(Mat4.decomposeToRef(Mat4.scaling(1, 0, 1).elements, outPosition, outRotation, outScale)).toBe(false);
    expect(outPosition.equalsWithEpsilon({ x: 7, y: 7, z: 7 })).toBe(true);
    expect(outScale.equalsWithEpsilon({ x: 7, y: 7, z: 7 })).toBe(true);
  });

  it("reads the parts individually", () => {
    const position = new Vec3(4, 5, 6);
    const rotation = Quat.fromEulerDegrees(0, 90, 0);
    const scale = new Vec3(2, 2, 2);
    const m = Mat4.compose(position, rotation, scale);
    expect(Mat4.getTranslationToRef(m.elements, new Vec3()).equalsWithEpsilon(position, 1e-6)).toBe(true);
    expect(Mat4.getScaleToRef(m.elements, new Vec3()).equalsWithEpsilon(scale, 1e-6)).toBe(true);
    expect(Quat.angleDegrees(Mat4.getRotationToRef(m.elements, new Quat()), rotation)).toBeCloseTo(0, 4);
  });

  it("divides a mirrored basis out before reading the rotation", () => {
    const mirrored = Mat4.compose({ x: 0, y: 0, z: 0 }, Quat.fromEulerDegrees(0, 90, 0), { x: 1, y: -1, z: 1 });
    const rotation = Mat4.getRotationToRef(mirrored.elements, new Quat());
    expect(Quat.angleDegrees(rotation, Quat.fromEulerDegrees(0, 90, 0))).toBeCloseTo(0, 4);
  });

  it("leaves the rotation output untouched for a degenerate basis", () => {
    const out = new Quat(0, 0, 0, 1);
    Mat4.getRotationToRef(Mat4.scaling(0, 1, 1).elements, out);
    expect(out.equalsWithEpsilon({ x: 0, y: 0, z: 0, w: 1 })).toBe(true);
  });

  it("builds a rotation-only matrix from a quaternion", () => {
    const q = Quat.fromEulerDegrees(0, 90, 0);
    const out = new Vec3();
    Mat4.transformDirectionToRef(Mat4.fromQuat(q).elements, VEC3_FORWARD, out);
    expect(out.equalsWithEpsilon({ x: 1, y: 0, z: 0 }, 1e-6)).toBe(true);
    expect(Mat4.fromQuatToRef(q, new Mat4()).equalsWithEpsilon(Mat4.fromQuat(q).elements)).toBe(true);
  });
});

describe("Mat4 transforms", () => {
  it("applies translation to points but not to directions", () => {
    const m = Mat4.compose({ x: 10, y: 0, z: 0 }, Quat.identity(), { x: 1, y: 1, z: 1 });
    const point = Mat4.transformPointToRef(m.elements, { x: 1, y: 0, z: 0 }, new Vec3());
    const direction = Mat4.transformDirectionToRef(m.elements, { x: 1, y: 0, z: 0 }, new Vec3());
    expect(point.equalsWithEpsilon({ x: 11, y: 0, z: 0 })).toBe(true);
    expect(direction.equalsWithEpsilon({ x: 1, y: 0, z: 0 })).toBe(true);
  });

  it("is safe when out aliases the input vector", () => {
    const v = new Vec3(1, 1, 1);
    Mat4.transformPointToRef(Mat4.translation(1, 1, 1).elements, v, v);
    expect(v.equalsWithEpsilon({ x: 2, y: 2, z: 2 })).toBe(true);

    const d = new Vec3(1, 0, 0);
    Mat4.transformDirectionToRef(Mat4.scaling(3, 3, 3).elements, d, d);
    expect(d.equalsWithEpsilon({ x: 3, y: 0, z: 0 })).toBe(true);
  });
});

describe("Mat4 camera matrices", () => {
  it("moves the eye to the origin and puts the target on +Z", () => {
    const view = Mat4.lookAtLH({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 }, VEC3_UP);
    const eye = Mat4.transformPointToRef(view.elements, { x: 0, y: 0, z: -5 }, new Vec3());
    const target = Mat4.transformPointToRef(view.elements, { x: 0, y: 0, z: 0 }, new Vec3());
    expect(eye.equalsWithEpsilon({ x: 0, y: 0, z: 0 }, 1e-5)).toBe(true);
    expect(target.equalsWithEpsilon({ x: 0, y: 0, z: 5 }, 1e-5)).toBe(true);
  });

  it("writes the identity for degenerate look-at input, matching Lite", () => {
    const sameSpot = Mat4.lookAtLHToRef({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, VEC3_UP, new Mat4());
    expect(sameSpot.equalsWithEpsilon(MAT4_IDENTITY)).toBe(true);
    const parallelUp = Mat4.lookAtLHToRef({ x: 0, y: 0, z: 0 }, VEC3_UP, VEC3_UP, new Mat4());
    expect(parallelUp.equalsWithEpsilon(MAT4_IDENTITY)).toBe(true);
  });

  it("projects with reverse depth: the near plane is 1 and the far plane is 0", () => {
    const projection = Mat4.perspectiveLH(60, 16 / 9, 0.1, 1000);
    expect(clipDepth(projection, 0, 0, 0.1)).toBeCloseTo(1, 4);
    expect(clipDepth(projection, 0, 0, 1000)).toBeCloseTo(0, 4);
  });

  it("scales by the field of view and the aspect ratio, and divides by depth", () => {
    // 90 degrees vertical: at one metre ahead, one metre up is exactly the top of the screen.
    const projection = Mat4.perspectiveLH(90, 2, 1, 100);
    const top = Mat4.transformPointToRef(projection.elements, { x: 0, y: 1, z: 1 }, new Vec3());
    expect(top.y).toBeCloseTo(1, 5);
    // and the 2:1 aspect ratio puts the right edge two metres out.
    const right = Mat4.transformPointToRef(projection.elements, { x: 2, y: 0, z: 1 }, new Vec3());
    expect(right.x).toBeCloseTo(1, 5);
    // twice as far away is half as big — the perspective divide by z, which ortho does not do.
    const far = Mat4.transformPointToRef(projection.elements, { x: 2, y: 0, z: 2 }, new Vec3());
    expect(far.x).toBeCloseTo(0.5, 5);
  });

  it("projects orthographically with the same reverse depth", () => {
    const projection = Mat4.orthoLH(4, 2, 1, 11);
    expect(clipDepth(projection, 0, 0, 1)).toBeCloseTo(1, 6);
    expect(clipDepth(projection, 0, 0, 11)).toBeCloseTo(0, 6);
    const corner = Mat4.transformPointToRef(projection.elements, { x: 2, y: 1, z: 1 }, new Vec3());
    expect(corner.x).toBeCloseTo(1, 6);
    expect(corner.y).toBeCloseTo(1, 6);
  });

  it("supports an off-centre orthographic frustum", () => {
    const projection = Mat4.orthoOffCenterLHToRef(0, 4, 0, 2, 1, 11, new Mat4());
    const centre = Mat4.transformPointToRef(projection.elements, { x: 2, y: 1, z: 1 }, new Vec3());
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.y).toBeCloseTo(0, 6);
  });
});

describe("Mat4 comparison", () => {
  it("compares element by element with a tolerance", () => {
    const a = Mat4.translation(1, 1, 1);
    const b = Mat4.translation(1 + 1e-9, 1, 1);
    expect(a.equalsWithEpsilon(b.elements)).toBe(true);
    expect(a.equalsWithEpsilon(Mat4.translation(2, 1, 1).elements)).toBe(false);
    expect(Mat4.equalsWithEpsilon(a.elements, Mat4.translation(1.4, 1, 1).elements, 0.5)).toBe(true);
  });
});

describe("Mat4Like with missing elements", () => {
  it("reads absent indices as zero, so a partial matrix-shaped value is never NaN", () => {
    // `Mat4Like` is an index signature: a caller can hand over an object that has `length` but not
    // every slot. Every read defends with `?? 0`, and this is the test that keeps that true.
    const sparse: Mat4Like = { length: 16 };
    const out = new Mat4();

    expect(Mat4.determinant(sparse)).toBe(0);
    expect(Mat4.invertToRef(sparse, out)).toBe(false);
    const zeros = Array.from({ length: 16 }, () => 0);
    expect([...Mat4.multiplyToRef(sparse, sparse, out).elements]).toEqual(zeros);
    expect([...Mat4.transposeToRef(sparse, out).elements]).toEqual(zeros);
    expect(Mat4.decomposeToRef(sparse, new Vec3(), new Quat(), new Vec3())).toBe(false);
    expect(Mat4.getTranslationToRef(sparse, new Vec3()).equalsWithEpsilon({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(Mat4.getScaleToRef(sparse, new Vec3()).equalsWithEpsilon({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(Mat4.getRotationToRef(sparse, new Quat()).equalsWithEpsilon({ x: 0, y: 0, z: 0, w: 1 })).toBe(true);
    expect(
      Mat4.transformDirectionToRef(sparse, { x: 1, y: 1, z: 1 }, new Vec3()).equalsWithEpsilon({ x: 0, y: 0, z: 0 }),
    ).toBe(true);
    expect(Mat4.equalsWithEpsilon(sparse, Mat4.multiplyToRef(sparse, sparse, new Mat4()).elements)).toBe(true);
    expect([...new Mat4().copyFrom(sparse).elements]).toEqual(zeros);
    expect(Vec3.transformCoordinatesToRef({ x: 1, y: 1, z: 1 }, sparse, new Vec3()).x).toBeNaN();
  });
});
