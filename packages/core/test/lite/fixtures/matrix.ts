/**
 * Independent 4x4 column-major matrix arithmetic for the S1.1 spike. Written with plain `+`/`*` so
 * the expected values a test asserts never come from Babylon Lite's own math — if Lite changed its
 * layout or its quaternion convention, these helpers would disagree and the test would fail.
 *
 * Column-major means element `i` is row `i % 4` of column `floor(i / 4)`, and the translation lives
 * in elements 12, 13, 14 — the layout Lite documents for `Mat4` and the one WGSL's `mat4x4<f32>`
 * expects.
 */

/** A 4x4 matrix as 16 numbers in column-major order. */
export type Matrix = readonly number[];

/** Returns the 4x4 identity matrix. */
export function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * Composes translation, rotation (quaternion), and scale into one column-major matrix, the way a
 * left-handed Y-up engine does: scale first, then rotate, then translate.
 *
 * @param tx - Translation x.
 * @param ty - Translation y.
 * @param tz - Translation z.
 * @param qx - Quaternion x.
 * @param qy - Quaternion y.
 * @param qz - Quaternion z.
 * @param qw - Quaternion w.
 * @param sx - Scale x.
 * @param sy - Scale y.
 * @param sz - Scale z.
 * @returns The composed matrix.
 */
export function compose(
  tx: number,
  ty: number,
  tz: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  sx: number,
  sy: number,
  sz: number,
): number[] {
  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/**
 * Multiplies two column-major matrices: the result applies `b` first, then `a`.
 *
 * @param a - The outer (parent) matrix.
 * @param b - The inner (local) matrix.
 * @returns `a * b`.
 */
export function multiply(a: Matrix, b: Matrix): number[] {
  const out: number[] = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * Transforms a point (w = 1) by a column-major matrix.
 *
 * @param m - The matrix.
 * @param x - Point x.
 * @param y - Point y.
 * @param z - Point z.
 * @returns The transformed point as `[x, y, z]`.
 */
export function transformPoint(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}
