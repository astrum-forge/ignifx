import { degToRad, EPSILON } from "./math-utils.js";
import type { Mat4Like, MutableQuat, MutableVec3, QuatLike, Vec3Like } from "./types.js";

/**
 * The backing store of a {@link Mat4}: a `Float32Array` of exactly 16 elements, in column-major
 * order (`m[column * 4 + row]`). The `length: 16` refinement is what makes it a {@link Mat4Like},
 * and therefore what makes it accepted anywhere Babylon Lite wants a `Mat4`.
 *
 * @public
 */
export type Mat4Elements = Float32Array & { readonly length: 16 };

/**
 * Allocates the 16-element column-major storage a matrix owns, pre-filled with zeroes.
 *
 * @returns Fresh, zeroed storage.
 */
function allocateElements(): Mat4Elements {
  // The invariant is that this array is exactly 16
  // elements long, which `Float32Array`'s `length: number` cannot express. Babylon Lite brands its
  // own allocation the same way (`lib/math/_matrix-allocator.js`).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return new Float32Array(16) as Mat4Elements;
}

/**
 * The determinant of the upper-left 3×3 basis. Its sign says whether the matrix mirrors, which is
 * how Babylon Lite decides the sign of the decomposed Y scale (`lib/math/mat4-decompose.js`).
 *
 * @param m - The matrix to measure.
 * @returns The 3×3 determinant.
 */
function basisDeterminant(m: Mat4Like): number {
  const m0 = m[0] ?? 0;
  const m1 = m[1] ?? 0;
  const m2 = m[2] ?? 0;
  const m4 = m[4] ?? 0;
  const m5 = m[5] ?? 0;
  const m6 = m[6] ?? 0;
  const m8 = m[8] ?? 0;
  const m9 = m[9] ?? 0;
  const m10 = m[10] ?? 0;
  return m0 * (m5 * m10 - m6 * m9) + m1 * (m6 * m8 - m4 * m10) + m2 * (m4 * m9 - m5 * m8);
}

/**
 * Writes the unit quaternion of an orthonormal basis into `out`. Arguments are named row-major
 * (`b<row><column>`), matching Babylon Lite's `_quatFromRotationBasis`
 * (`lib/math/quat-from-rotation-matrix.js`), which this reproduces branch for branch.
 *
 * Shared with the quaternion module; not part of the public API.
 *
 * @param b00 - Row 0, column 0.
 * @param b01 - Row 0, column 1.
 * @param b02 - Row 0, column 2.
 * @param b10 - Row 1, column 0.
 * @param b11 - Row 1, column 1.
 * @param b12 - Row 1, column 2.
 * @param b20 - Row 2, column 0.
 * @param b21 - Row 2, column 1.
 * @param b22 - Row 2, column 2.
 * @param out - The quaternion to write.
 *
 * @internal
 */
export function basisToQuatToRef(
  b00: number,
  b01: number,
  b02: number,
  b10: number,
  b11: number,
  b12: number,
  b20: number,
  b21: number,
  b22: number,
  out: MutableQuat,
): void {
  const trace = b00 + b11 + b22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out.set((b21 - b12) * s, (b02 - b20) * s, (b10 - b01) * s, 0.25 / s);
    return;
  }
  if (b00 > b11 && b00 > b22) {
    const s = 2 * Math.sqrt(1 + b00 - b11 - b22);
    out.set(0.25 * s, (b01 + b10) / s, (b02 + b20) / s, (b21 - b12) / s);
    return;
  }
  if (b11 > b22) {
    const s = 2 * Math.sqrt(1 + b11 - b00 - b22);
    out.set((b01 + b10) / s, 0.25 * s, (b12 + b21) / s, (b02 - b20) / s);
    return;
  }
  const s = 2 * Math.sqrt(1 + b22 - b00 - b11);
  out.set((b02 + b20) / s, (b12 + b21) / s, 0.25 * s, (b10 - b01) / s);
}

/**
 * A 4×4 transformation matrix stored column-major in a `Float32Array`, byte-compatible with WGSL's
 * `mat4x4<f32>` and with Babylon Lite's `Mat4` (translation in slots 12/13/14).
 *
 * ignifx is left-handed, Y up, +Z forward (ADR-0011), so the projection helpers are the `LH`
 * family and they use Lite's **reverse depth** convention: the near plane maps to 1 and the far
 * plane to 0.
 *
 * Instance methods mutate the matrix and return `this`; `ToRef` statics write into their `out`
 * matrix and allocate nothing, and are safe when `out` aliases an input. The remaining statics
 * allocate a fresh matrix and say so.
 *
 * @example
 * ```ts
 * const world = new Mat4();
 * Mat4.composeToRef(position, rotation, scale, world);
 *
 * const inverse = new Mat4();
 * if (Mat4.invertToRef(world, inverse)) {
 *   Mat4.transformPointToRef(inverse, worldPoint, localPoint);
 * }
 * ```
 *
 * @public
 */
export class Mat4 {
  /**
   * The 16 elements, column-major (`elements[column * 4 + row]`). This is the object to hand to
   * anything that wants a {@link Mat4Like} — including Babylon Lite — and the buffer to upload to
   * the GPU. It is never reallocated, so a reference to it stays valid for the matrix's lifetime.
   */
  readonly elements: Mat4Elements;

  /**
   * Creates an identity matrix.
   */
  constructor() {
    const e = allocateElements();
    e[0] = 1;
    e[5] = 1;
    e[10] = 1;
    e[15] = 1;
    this.elements = e;
  }

  /**
   * Resets this matrix to the identity.
   *
   * @returns This matrix.
   */
  identity(): this {
    const e = this.elements;
    e[0] = 1;
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e[4] = 0;
    e[5] = 1;
    e[6] = 0;
    e[7] = 0;
    e[8] = 0;
    e[9] = 0;
    e[10] = 1;
    e[11] = 0;
    e[12] = 0;
    e[13] = 0;
    e[14] = 0;
    e[15] = 1;
    return this;
  }

  /**
   * Copies every element from another matrix.
   *
   * @param m - The matrix to read.
   * @returns This matrix.
   */
  copyFrom(m: Mat4Like): this {
    const e = this.elements;
    for (let i = 0; i < 16; i++) {
      e[i] = m[i] ?? 0;
    }
    return this;
  }

  /**
   * Copies this matrix into a new one.
   *
   * @returns A new matrix. **Allocates.**
   */
  clone(): Mat4 {
    return new Mat4().copyFrom(this.elements);
  }

  /**
   * Post-multiplies this matrix by another (`this = this * m`), so `m`'s transform is applied first
   * when the product acts on a column vector.
   *
   * @param m - The right-hand matrix.
   * @returns This matrix.
   */
  multiply(m: Mat4Like): this {
    Mat4.multiplyToRef(this.elements, m, this);
    return this;
  }

  /**
   * Inverts this matrix in place.
   *
   * @returns `true` on success. When the matrix is singular this returns `false` and leaves the
   * matrix untouched.
   */
  invert(): boolean {
    return Mat4.invertToRef(this.elements, this);
  }

  /**
   * Transposes this matrix in place, swapping rows and columns.
   *
   * @returns This matrix.
   */
  transpose(): this {
    Mat4.transposeToRef(this.elements, this);
    return this;
  }

  /**
   * The full 4×4 determinant of this matrix.
   *
   * @returns The determinant; zero means the matrix cannot be inverted.
   */
  determinant(): number {
    return Mat4.determinant(this.elements);
  }

  /**
   * Compares this matrix with another element by element, with a tolerance.
   *
   * @param m - The matrix to compare against.
   * @param epsilon - The largest per-element difference still considered equal.
   * @returns `true` when every element matches within `epsilon`.
   */
  equalsWithEpsilon(m: Mat4Like, epsilon: number = EPSILON): boolean {
    return Mat4.equalsWithEpsilon(this.elements, m, epsilon);
  }

  /**
   * Creates an identity matrix.
   *
   * @returns A new identity matrix. **Allocates.**
   */
  static identity(): Mat4 {
    return new Mat4();
  }

  /**
   * Creates a matrix holding a copy of another matrix's elements.
   *
   * @param m - The matrix to copy.
   * @returns A new matrix. **Allocates.**
   */
  static from(m: Mat4Like): Mat4 {
    return new Mat4().copyFrom(m);
  }

  /**
   * Builds a translation-rotation-scale matrix, the same composition order Babylon Lite's
   * `mat4Compose` uses (`translation * rotation * scale`).
   *
   * @param position - The translation, in metres.
   * @param rotation - The rotation; assumed to be a unit quaternion.
   * @param scale - The per-axis scale.
   * @returns A new matrix. **Allocates.**
   */
  static compose(position: Vec3Like, rotation: QuatLike, scale: Vec3Like): Mat4 {
    return Mat4.composeToRef(position, rotation, scale, new Mat4());
  }

  /**
   * Writes a translation-rotation-scale matrix into `out`.
   *
   * @param position - The translation, in metres.
   * @param rotation - The rotation; assumed to be a unit quaternion.
   * @param scale - The per-axis scale.
   * @param out - The matrix to write.
   * @returns `out`.
   *
   * @example
   * ```ts
   * Mat4.composeToRef(transform.localPosition, transform.localRotation, transform.localScale, local);
   * ```
   */
  static composeToRef(position: Vec3Like, rotation: QuatLike, scale: Vec3Like, out: Mat4): Mat4 {
    const qx = rotation.x;
    const qy = rotation.y;
    const qz = rotation.z;
    const qw = rotation.w;
    const sx = scale.x;
    const sy = scale.y;
    const sz = scale.z;
    const xx = qx * qx;
    const yy = qy * qy;
    const zz = qz * qz;
    const xy = qx * qy;
    const xz = qx * qz;
    const yz = qy * qz;
    const wx = qw * qx;
    const wy = qw * qy;
    const wz = qw * qz;
    const e = out.elements;
    e[0] = (1 - 2 * (yy + zz)) * sx;
    e[1] = 2 * (xy + wz) * sx;
    e[2] = 2 * (xz - wy) * sx;
    e[3] = 0;
    e[4] = 2 * (xy - wz) * sy;
    e[5] = (1 - 2 * (xx + zz)) * sy;
    e[6] = 2 * (yz + wx) * sy;
    e[7] = 0;
    e[8] = 2 * (xz + wy) * sz;
    e[9] = 2 * (yz - wx) * sz;
    e[10] = (1 - 2 * (xx + yy)) * sz;
    e[11] = 0;
    e[12] = position.x;
    e[13] = position.y;
    e[14] = position.z;
    e[15] = 1;
    return out;
  }

  /**
   * Splits an affine transformation-rotation-scale matrix back into its parts, using Babylon Lite's
   * convention (`lib/math/mat4-decompose.js`): scales are the lengths of the basis columns, and a
   * mirrored matrix (negative basis determinant) reports a **negative Y scale** rather than
   * silently dropping the reflection. Shear is not detected.
   *
   * @param m - The matrix to split.
   * @param outPosition - Receives the translation.
   * @param outRotation - Receives the rotation as a unit quaternion.
   * @param outScale - Receives the per-axis scale.
   * @returns `true` on success; `false` when a basis column has (near) zero length, in which case
   * the outputs are left untouched.
   *
   * @example
   * ```ts
   * Mat4.decomposeToRef(node.worldMatrix, position, rotation, scale);
   * ```
   */
  static decomposeToRef(
    m: Mat4Like,
    outPosition: MutableVec3,
    outRotation: MutableQuat,
    outScale: MutableVec3,
  ): boolean {
    const m0 = m[0] ?? 0;
    const m1 = m[1] ?? 0;
    const m2 = m[2] ?? 0;
    const m4 = m[4] ?? 0;
    const m5 = m[5] ?? 0;
    const m6 = m[6] ?? 0;
    const m8 = m[8] ?? 0;
    const m9 = m[9] ?? 0;
    const m10 = m[10] ?? 0;
    const sx = Math.hypot(m0, m1, m2);
    const syAbs = Math.hypot(m4, m5, m6);
    const sz = Math.hypot(m8, m9, m10);
    if (sx <= 1e-8 || syAbs <= 1e-8 || sz <= 1e-8) {
      return false;
    }
    const sy = basisDeterminant(m) < 0 ? -syAbs : syAbs;
    const invSx = 1 / sx;
    const invSy = 1 / sy;
    const invSz = 1 / sz;
    // Read the translation before writing anything, so `outPosition` may alias nothing dangerous.
    const tx = m[12] ?? 0;
    const ty = m[13] ?? 0;
    const tz = m[14] ?? 0;
    basisToQuatToRef(
      m0 * invSx,
      m4 * invSy,
      m8 * invSz,
      m1 * invSx,
      m5 * invSy,
      m9 * invSz,
      m2 * invSx,
      m6 * invSy,
      m10 * invSz,
      outRotation,
    );
    const qx = outRotation.x;
    const qy = outRotation.y;
    const qz = outRotation.z;
    const qw = outRotation.w;
    const invLength = 1 / Math.hypot(qx, qy, qz, qw);
    outRotation.set(qx * invLength, qy * invLength, qz * invLength, qw * invLength);
    outPosition.set(tx, ty, tz);
    outScale.set(sx, sy, sz);
    return true;
  }

  /**
   * Multiplies two matrices.
   *
   * @param a - The left-hand matrix.
   * @param b - The right-hand matrix.
   * @returns A new matrix holding `a * b`. **Allocates.**
   */
  static multiply(a: Mat4Like, b: Mat4Like): Mat4 {
    return Mat4.multiplyToRef(a, b, new Mat4());
  }

  /**
   * Writes `a * b` into `out`. Acting on a column vector, `b` is applied first.
   *
   * @param a - The left-hand matrix.
   * @param b - The right-hand matrix.
   * @param out - The matrix to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static multiplyToRef(a: Mat4Like, b: Mat4Like, out: Mat4): Mat4 {
    const a0 = a[0] ?? 0;
    const a1 = a[1] ?? 0;
    const a2 = a[2] ?? 0;
    const a3 = a[3] ?? 0;
    const a4 = a[4] ?? 0;
    const a5 = a[5] ?? 0;
    const a6 = a[6] ?? 0;
    const a7 = a[7] ?? 0;
    const a8 = a[8] ?? 0;
    const a9 = a[9] ?? 0;
    const a10 = a[10] ?? 0;
    const a11 = a[11] ?? 0;
    const a12 = a[12] ?? 0;
    const a13 = a[13] ?? 0;
    const a14 = a[14] ?? 0;
    const a15 = a[15] ?? 0;
    const b0 = b[0] ?? 0;
    const b1 = b[1] ?? 0;
    const b2 = b[2] ?? 0;
    const b3 = b[3] ?? 0;
    const b4 = b[4] ?? 0;
    const b5 = b[5] ?? 0;
    const b6 = b[6] ?? 0;
    const b7 = b[7] ?? 0;
    const b8 = b[8] ?? 0;
    const b9 = b[9] ?? 0;
    const b10 = b[10] ?? 0;
    const b11 = b[11] ?? 0;
    const b12 = b[12] ?? 0;
    const b13 = b[13] ?? 0;
    const b14 = b[14] ?? 0;
    const b15 = b[15] ?? 0;
    const e = out.elements;
    e[0] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
    e[1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
    e[2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
    e[3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
    e[4] = a0 * b4 + a4 * b5 + a8 * b6 + a12 * b7;
    e[5] = a1 * b4 + a5 * b5 + a9 * b6 + a13 * b7;
    e[6] = a2 * b4 + a6 * b5 + a10 * b6 + a14 * b7;
    e[7] = a3 * b4 + a7 * b5 + a11 * b6 + a15 * b7;
    e[8] = a0 * b8 + a4 * b9 + a8 * b10 + a12 * b11;
    e[9] = a1 * b8 + a5 * b9 + a9 * b10 + a13 * b11;
    e[10] = a2 * b8 + a6 * b9 + a10 * b10 + a14 * b11;
    e[11] = a3 * b8 + a7 * b9 + a11 * b10 + a15 * b11;
    e[12] = a0 * b12 + a4 * b13 + a8 * b14 + a12 * b15;
    e[13] = a1 * b12 + a5 * b13 + a9 * b14 + a13 * b15;
    e[14] = a2 * b12 + a6 * b13 + a10 * b14 + a14 * b15;
    e[15] = a3 * b12 + a7 * b13 + a11 * b14 + a15 * b15;
    return out;
  }

  /**
   * Writes the inverse of `m` into `out`.
   *
   * @param m - The matrix to invert.
   * @param out - The matrix to write; may alias `m`. Left untouched when the inverse does not exist.
   * @returns `true` on success, `false` when `m` is singular. Returning a status rather than `null`
   * keeps the call allocation-free (coding standards §7).
   *
   * @example
   * ```ts
   * if (!Mat4.invertToRef(world, worldToLocal)) {
   *   // degenerate scale — skip this entity
   * }
   * ```
   */
  static invertToRef(m: Mat4Like, out: Mat4): boolean {
    const a00 = m[0] ?? 0;
    const a01 = m[1] ?? 0;
    const a02 = m[2] ?? 0;
    const a03 = m[3] ?? 0;
    const a10 = m[4] ?? 0;
    const a11 = m[5] ?? 0;
    const a12 = m[6] ?? 0;
    const a13 = m[7] ?? 0;
    const a20 = m[8] ?? 0;
    const a21 = m[9] ?? 0;
    const a22 = m[10] ?? 0;
    const a23 = m[11] ?? 0;
    const a30 = m[12] ?? 0;
    const a31 = m[13] ?? 0;
    const a32 = m[14] ?? 0;
    const a33 = m[15] ?? 0;
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    // Lite rejects at the same threshold (`lib/math/mat4-invert.js`), so both agree on which
    // matrices are singular.
    if (Math.abs(determinant) < 1e-10) {
      return false;
    }
    const inv = 1 / determinant;
    const e = out.elements;
    e[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv;
    e[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv;
    e[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv;
    e[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv;
    e[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv;
    e[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv;
    e[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv;
    e[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv;
    e[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv;
    e[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv;
    e[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv;
    e[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv;
    e[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv;
    e[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv;
    e[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv;
    e[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv;
    return true;
  }

  /**
   * Writes the transpose of `m` into `out`.
   *
   * @param m - The matrix to transpose.
   * @param out - The matrix to write; may alias `m`.
   * @returns `out`.
   */
  static transposeToRef(m: Mat4Like, out: Mat4): Mat4 {
    const m0 = m[0] ?? 0;
    const m1 = m[1] ?? 0;
    const m2 = m[2] ?? 0;
    const m3 = m[3] ?? 0;
    const m4 = m[4] ?? 0;
    const m5 = m[5] ?? 0;
    const m6 = m[6] ?? 0;
    const m7 = m[7] ?? 0;
    const m8 = m[8] ?? 0;
    const m9 = m[9] ?? 0;
    const m10 = m[10] ?? 0;
    const m11 = m[11] ?? 0;
    const m12 = m[12] ?? 0;
    const m13 = m[13] ?? 0;
    const m14 = m[14] ?? 0;
    const m15 = m[15] ?? 0;
    const e = out.elements;
    e[0] = m0;
    e[1] = m4;
    e[2] = m8;
    e[3] = m12;
    e[4] = m1;
    e[5] = m5;
    e[6] = m9;
    e[7] = m13;
    e[8] = m2;
    e[9] = m6;
    e[10] = m10;
    e[11] = m14;
    e[12] = m3;
    e[13] = m7;
    e[14] = m11;
    e[15] = m15;
    return out;
  }

  /**
   * The full 4×4 determinant.
   *
   * @param m - The matrix to measure.
   * @returns The determinant; zero means the matrix cannot be inverted.
   */
  static determinant(m: Mat4Like): number {
    const a00 = m[0] ?? 0;
    const a01 = m[1] ?? 0;
    const a02 = m[2] ?? 0;
    const a03 = m[3] ?? 0;
    const a10 = m[4] ?? 0;
    const a11 = m[5] ?? 0;
    const a12 = m[6] ?? 0;
    const a13 = m[7] ?? 0;
    const a20 = m[8] ?? 0;
    const a21 = m[9] ?? 0;
    const a22 = m[10] ?? 0;
    const a23 = m[11] ?? 0;
    const a30 = m[12] ?? 0;
    const a31 = m[13] ?? 0;
    const a32 = m[14] ?? 0;
    const a33 = m[15] ?? 0;
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  }

  /**
   * Builds a pure translation matrix.
   *
   * @param x - Translation along X, in metres.
   * @param y - Translation along Y, in metres.
   * @param z - Translation along Z, in metres.
   * @returns A new matrix. **Allocates.**
   */
  static translation(x: number, y: number, z: number): Mat4 {
    return Mat4.translationToRef(x, y, z, new Mat4());
  }

  /**
   * Writes a pure translation matrix into `out`.
   *
   * @param x - Translation along X, in metres.
   * @param y - Translation along Y, in metres.
   * @param z - Translation along Z, in metres.
   * @param out - The matrix to write.
   * @returns `out`.
   */
  static translationToRef(x: number, y: number, z: number, out: Mat4): Mat4 {
    const e = out.identity().elements;
    e[12] = x;
    e[13] = y;
    e[14] = z;
    return out;
  }

  /**
   * Builds a pure scaling matrix.
   *
   * @param x - Scale along X.
   * @param y - Scale along Y.
   * @param z - Scale along Z.
   * @returns A new matrix. **Allocates.**
   */
  static scaling(x: number, y: number, z: number): Mat4 {
    return Mat4.scalingToRef(x, y, z, new Mat4());
  }

  /**
   * Writes a pure scaling matrix into `out`.
   *
   * @param x - Scale along X.
   * @param y - Scale along Y.
   * @param z - Scale along Z.
   * @param out - The matrix to write.
   * @returns `out`.
   */
  static scalingToRef(x: number, y: number, z: number, out: Mat4): Mat4 {
    const e = out.identity().elements;
    e[0] = x;
    e[5] = y;
    e[10] = z;
    return out;
  }

  /**
   * Builds a pure rotation matrix from a quaternion.
   *
   * @param q - The rotation; assumed to be a unit quaternion.
   * @returns A new matrix. **Allocates.**
   */
  static fromQuat(q: QuatLike): Mat4 {
    return Mat4.fromQuatToRef(q, new Mat4());
  }

  /**
   * Writes a pure rotation matrix into `out`.
   *
   * @param q - The rotation; assumed to be a unit quaternion.
   * @param out - The matrix to write.
   * @returns `out`.
   */
  static fromQuatToRef(q: QuatLike, out: Mat4): Mat4 {
    return Mat4.composeToRef(ZERO_TRANSLATION, q, UNIT_SCALE, out);
  }

  /**
   * Builds a left-handed view matrix that places the camera at `eye` looking at `target`.
   *
   * @param eye - The camera position, in metres.
   * @param target - The point to look at, in metres.
   * @param up - The camera's up direction.
   * @returns A new matrix. **Allocates.**
   */
  static lookAtLH(eye: Vec3Like, target: Vec3Like, up: Vec3Like): Mat4 {
    return Mat4.lookAtLHToRef(eye, target, up, new Mat4());
  }

  /**
   * Writes a left-handed view matrix into `out`. Reproduces Babylon Lite's `mat4LookAtLHToRef`,
   * including its degenerate-input behaviour: when `eye` and `target` coincide, or when `up` is
   * parallel to the view direction, `out` becomes the identity.
   *
   * @param eye - The camera position, in metres.
   * @param target - The point to look at, in metres.
   * @param up - The camera's up direction.
   * @param out - The matrix to write.
   * @returns `out`.
   */
  static lookAtLHToRef(eye: Vec3Like, target: Vec3Like, up: Vec3Like, out: Mat4): Mat4 {
    const ex = eye.x;
    const ey = eye.y;
    const ez = eye.z;
    let zx = target.x - ex;
    let zy = target.y - ey;
    let zz = target.z - ez;
    const zLength = Math.hypot(zx, zy, zz);
    if (zLength < 1e-10) {
      return out.identity();
    }
    const invZ = 1 / zLength;
    zx *= invZ;
    zy *= invZ;
    zz *= invZ;
    let xx = up.y * zz - up.z * zy;
    let xy = up.z * zx - up.x * zz;
    let xz = up.x * zy - up.y * zx;
    const xLength = Math.hypot(xx, xy, xz);
    if (xLength < 1e-10) {
      return out.identity();
    }
    const invX = 1 / xLength;
    xx *= invX;
    xy *= invX;
    xz *= invX;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const e = out.elements;
    e[0] = xx;
    e[1] = yx;
    e[2] = zx;
    e[3] = 0;
    e[4] = xy;
    e[5] = yy;
    e[6] = zy;
    e[7] = 0;
    e[8] = xz;
    e[9] = yz;
    e[10] = zz;
    e[11] = 0;
    e[12] = -(xx * ex + xy * ey + xz * ez);
    e[13] = -(yx * ex + yy * ey + yz * ez);
    e[14] = -(zx * ex + zy * ey + zz * ez);
    e[15] = 1;
    return out;
  }

  /**
   * Builds a left-handed perspective projection.
   *
   * @param fovDegrees - The vertical field of view, in degrees.
   * @param aspect - The viewport's width divided by its height.
   * @param near - The near plane distance, in metres.
   * @param far - The far plane distance, in metres.
   * @returns A new matrix. **Allocates.**
   */
  static perspectiveLH(fovDegrees: number, aspect: number, near: number, far: number): Mat4 {
    return Mat4.perspectiveLHToRef(fovDegrees, aspect, near, far, new Mat4());
  }

  /**
   * Writes a left-handed perspective projection into `out`, matching Babylon Lite's
   * `mat4PerspectiveLHToRef` — which is a **reverse-depth** projection: the near plane maps to
   * clip-space depth 1 and the far plane to 0, the arrangement that keeps float depth precise.
   *
   * @param fovDegrees - The vertical field of view, in degrees.
   * @param aspect - The viewport's width divided by its height.
   * @param near - The near plane distance, in metres.
   * @param far - The far plane distance, in metres.
   * @param out - The matrix to write.
   * @returns `out`.
   */
  static perspectiveLHToRef(fovDegrees: number, aspect: number, near: number, far: number, out: Mat4): Mat4 {
    const cot = 1 / Math.tan(degToRad(fovDegrees) * 0.5);
    const range = far - near;
    const e = out.elements;
    e[0] = cot / aspect;
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e[4] = 0;
    e[5] = cot;
    e[6] = 0;
    e[7] = 0;
    e[8] = 0;
    e[9] = 0;
    e[10] = -near / range;
    e[11] = 1;
    e[12] = 0;
    e[13] = 0;
    e[14] = (far * near) / range;
    e[15] = 0;
    return out;
  }

  /**
   * Builds a centred left-handed orthographic projection.
   *
   * @param width - The view width, in metres.
   * @param height - The view height, in metres.
   * @param near - The near plane distance, in metres.
   * @param far - The far plane distance, in metres.
   * @returns A new matrix. **Allocates.**
   */
  static orthoLH(width: number, height: number, near: number, far: number): Mat4 {
    return Mat4.orthoLHToRef(width, height, near, far, new Mat4());
  }

  /**
   * Writes a centred left-handed orthographic projection into `out`, with the same reverse-depth
   * convention as {@link Mat4.perspectiveLHToRef}.
   *
   * @param width - The view width, in metres.
   * @param height - The view height, in metres.
   * @param near - The near plane distance, in metres.
   * @param far - The far plane distance, in metres.
   * @param out - The matrix to write.
   * @returns `out`.
   */
  static orthoLHToRef(width: number, height: number, near: number, far: number, out: Mat4): Mat4 {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    return Mat4.orthoOffCenterLHToRef(-halfWidth, halfWidth, -halfHeight, halfHeight, near, far, out);
  }

  /**
   * Writes an off-centre left-handed orthographic projection into `out`, reproducing Babylon Lite's
   * `mat4OrthoOffCenterLHToRef` (reverse depth).
   *
   * @param left - The left clip plane, in metres.
   * @param right - The right clip plane, in metres.
   * @param bottom - The bottom clip plane, in metres.
   * @param top - The top clip plane, in metres.
   * @param near - The near plane distance, in metres.
   * @param far - The far plane distance, in metres.
   * @param out - The matrix to write.
   * @returns `out`.
   */
  static orthoOffCenterLHToRef(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
    out: Mat4,
  ): Mat4 {
    const range = far - near;
    const e = out.elements;
    e[0] = 2 / (right - left);
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e[4] = 0;
    e[5] = 2 / (top - bottom);
    e[6] = 0;
    e[7] = 0;
    e[8] = 0;
    e[9] = 0;
    e[10] = -1 / range;
    e[11] = 0;
    e[12] = (left + right) / (left - right);
    e[13] = (top + bottom) / (bottom - top);
    e[14] = far / range;
    e[15] = 1;
    return out;
  }

  /**
   * Reads a matrix's translation.
   *
   * @param m - The matrix to read.
   * @param out - The vector to write.
   * @returns `out`.
   */
  static getTranslationToRef<TOut extends MutableVec3>(m: Mat4Like, out: TOut): TOut {
    out.set(m[12] ?? 0, m[13] ?? 0, m[14] ?? 0);
    return out;
  }

  /**
   * Reads a matrix's per-axis scale as the lengths of its basis columns, negating Y for a mirrored
   * matrix exactly as {@link Mat4.decomposeToRef} does.
   *
   * @param m - The matrix to read.
   * @param out - The vector to write.
   * @returns `out`.
   */
  static getScaleToRef<TOut extends MutableVec3>(m: Mat4Like, out: TOut): TOut {
    const sx = Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0);
    const syAbs = Math.hypot(m[4] ?? 0, m[5] ?? 0, m[6] ?? 0);
    const sz = Math.hypot(m[8] ?? 0, m[9] ?? 0, m[10] ?? 0);
    out.set(sx, basisDeterminant(m) < 0 ? -syAbs : syAbs, sz);
    return out;
  }

  /**
   * Reads a matrix's rotation, dividing the scale out of the basis first.
   *
   * @param m - The matrix to read.
   * @param out - The quaternion to write. Left untouched when a basis column has zero length.
   * @returns `out`.
   */
  static getRotationToRef<TOut extends MutableQuat>(m: Mat4Like, out: TOut): TOut {
    const m0 = m[0] ?? 0;
    const m1 = m[1] ?? 0;
    const m2 = m[2] ?? 0;
    const m4 = m[4] ?? 0;
    const m5 = m[5] ?? 0;
    const m6 = m[6] ?? 0;
    const m8 = m[8] ?? 0;
    const m9 = m[9] ?? 0;
    const m10 = m[10] ?? 0;
    const sx = Math.hypot(m0, m1, m2);
    const syAbs = Math.hypot(m4, m5, m6);
    const sz = Math.hypot(m8, m9, m10);
    if (sx <= 1e-8 || syAbs <= 1e-8 || sz <= 1e-8) {
      return out;
    }
    const invSx = 1 / sx;
    const invSy = 1 / (basisDeterminant(m) < 0 ? -syAbs : syAbs);
    const invSz = 1 / sz;
    basisToQuatToRef(
      m0 * invSx,
      m4 * invSy,
      m8 * invSz,
      m1 * invSx,
      m5 * invSy,
      m9 * invSz,
      m2 * invSx,
      m6 * invSy,
      m10 * invSz,
      out,
    );
    const invLength = 1 / Math.hypot(out.x, out.y, out.z, out.w);
    out.set(out.x * invLength, out.y * invLength, out.z * invLength, out.w * invLength);
    return out;
  }

  /**
   * Transforms a point by a matrix, applying translation and the perspective divide.
   *
   * @param m - The transformation.
   * @param point - The point to transform, in metres.
   * @param out - The vector to write; may alias `point`.
   * @returns `out`.
   */
  static transformPointToRef<TOut extends MutableVec3>(m: Mat4Like, point: Vec3Like, out: TOut): TOut {
    const x = point.x;
    const y = point.y;
    const z = point.z;
    const rx = x * (m[0] ?? 0) + y * (m[4] ?? 0) + z * (m[8] ?? 0) + (m[12] ?? 0);
    const ry = x * (m[1] ?? 0) + y * (m[5] ?? 0) + z * (m[9] ?? 0) + (m[13] ?? 0);
    const rz = x * (m[2] ?? 0) + y * (m[6] ?? 0) + z * (m[10] ?? 0) + (m[14] ?? 0);
    const invW = 1 / (x * (m[3] ?? 0) + y * (m[7] ?? 0) + z * (m[11] ?? 0) + (m[15] ?? 0));
    out.set(rx * invW, ry * invW, rz * invW);
    return out;
  }

  /**
   * Transforms a direction by a matrix, ignoring translation. Note that this is the plain basis
   * transform: a non-uniformly scaled matrix needs its inverse-transpose to keep normals correct.
   *
   * @param m - The transformation.
   * @param direction - The direction to transform.
   * @param out - The vector to write; may alias `direction`.
   * @returns `out`.
   */
  static transformDirectionToRef<TOut extends MutableVec3>(m: Mat4Like, direction: Vec3Like, out: TOut): TOut {
    const x = direction.x;
    const y = direction.y;
    const z = direction.z;
    out.set(
      x * (m[0] ?? 0) + y * (m[4] ?? 0) + z * (m[8] ?? 0),
      x * (m[1] ?? 0) + y * (m[5] ?? 0) + z * (m[9] ?? 0),
      x * (m[2] ?? 0) + y * (m[6] ?? 0) + z * (m[10] ?? 0),
    );
    return out;
  }

  /**
   * Compares two matrices element by element, with a tolerance.
   *
   * @param a - The first matrix.
   * @param b - The second matrix.
   * @param epsilon - The largest per-element difference still considered equal.
   * @returns `true` when every element matches within `epsilon`.
   */
  static equalsWithEpsilon(a: Mat4Like, b: Mat4Like, epsilon: number = EPSILON): boolean {
    for (let i = 0; i < 16; i++) {
      if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > epsilon) {
        return false;
      }
    }
    return true;
  }
}

/**
 * The zero translation {@link Mat4.fromQuatToRef} composes with. Module-scope constant, frozen so it
 * can never be written through.
 */
const ZERO_TRANSLATION: Vec3Like = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * The unit scale {@link Mat4.fromQuatToRef} composes with.
 */
const UNIT_SCALE: Vec3Like = Object.freeze({ x: 1, y: 1, z: 1 });

/**
 * A frozen identity matrix, for the common case of "no transform". It is a plain {@link Mat4Like}
 * rather than a {@link Mat4} because a `Float32Array` cannot be frozen — pass it to anything that
 * reads a matrix, and use `new Mat4()` when you need one you can write to.
 *
 * @example
 * ```ts
 * Mat4.transformPointToRef(MAT4_IDENTITY, point, out); // copies the point
 * ```
 *
 * @public
 */
export const MAT4_IDENTITY: Mat4Like = Object.freeze({
  length: 16,
  0: 1,
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 1,
  6: 0,
  7: 0,
  8: 0,
  9: 0,
  10: 1,
  11: 0,
  12: 0,
  13: 0,
  14: 0,
  15: 1,
} as const);
