import { basisToQuatToRef, Mat4 } from "./mat4.js";
import { clamp, degToRad, EPSILON, radToDeg } from "./math-utils.js";
import { VEC3_UP } from "./vec3.js";
import type { Mat4Like, MutableQuat, MutableVec3, QuatLike, Vec3Like } from "./types.js";

/**
 * A rotation, stored as a unit quaternion. Quaternions are how ignifx stores every rotation:
 * they interpolate smoothly, never gimbal-lock, and compose without matrix round-trips. Euler
 * angles exist only at the edges of the API, always in **degrees** (ADR-0011, coding standards
 * section 5.1).
 *
 * Conventions, all verified against Babylon Lite 1.27.0's implementation so a `Quat` and a Lite
 * quaternion mean the same rotation:
 *
 * - Euler order is **intrinsic XYZ** (`lib/math/quat-euler.js`), the inverse of Lite's
 *   `quatToEulerXYZ`.
 * - `a * b` is the Hamilton product: applied to a vector it performs `b` first, then `a`, matching
 *   the matrix product `Ma * Mb`.
 * - The space is left-handed with Y up and +Z forward, so rotating `(1, 0, 0)` by 90 degrees about
 *   +Y gives `(0, 0, -1)`, and {@link Quat.lookRotation} maps +Z onto `forward`.
 *
 * Instance methods mutate the receiver and return `this`; `ToRef` statics write into a final `out`
 * argument and allocate nothing; the remaining statics allocate and say so.
 *
 * @example
 * ```ts
 * // face the movement direction, then blend into it over time
 * const target = Quat.lookRotation(velocity);
 * Quat.slerpToRef(transform.localRotation, target, 0.2, transform.localRotation);
 * ```
 *
 * @public
 */
export class Quat {
  /** The imaginary X component. */
  x: number;
  /** The imaginary Y component. */
  y: number;
  /** The imaginary Z component. */
  z: number;
  /** The real (scalar) component. */
  w: number;

  /**
   * Creates a quaternion. The defaults are the identity rotation.
   *
   * @param x - The imaginary X component. Defaults to 0.
   * @param y - The imaginary Y component. Defaults to 0.
   * @param z - The imaginary Z component. Defaults to 0.
   * @param w - The real component. Defaults to 1.
   */
  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  /**
   * Assigns every component at once.
   *
   * @param x - The new imaginary X component.
   * @param y - The new imaginary Y component.
   * @param z - The new imaginary Z component.
   * @param w - The new real component.
   * @returns This quaternion.
   */
  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  /**
   * Copies every component from another quaternion.
   *
   * @param q - The quaternion to read.
   * @returns This quaternion.
   */
  copyFrom(q: QuatLike): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  /**
   * Copies this quaternion into a new one.
   *
   * @returns A new quaternion. **Allocates.**
   */
  clone(): Quat {
    return new Quat(this.x, this.y, this.z, this.w);
  }

  /**
   * Resets this quaternion to the identity rotation.
   *
   * @returns This quaternion.
   */
  identity(): this {
    return this.set(0, 0, 0, 1);
  }

  /**
   * Scales this quaternion to unit length. Compositions drift over time, so normalize rotations you
   * keep integrating. A zero-length quaternion becomes the identity rather than `NaN`.
   *
   * @returns This quaternion.
   */
  normalize(): this {
    return Quat.normalizeToRef(this, this);
  }

  /**
   * Conjugates this quaternion, negating its imaginary part. For a unit quaternion this is the
   * inverse rotation.
   *
   * @returns This quaternion.
   */
  conjugate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  /**
   * Inverts this rotation. Unlike {@link Quat.conjugate} this also divides by the squared length, so
   * it is correct for quaternions that have drifted from unit length.
   *
   * @returns This quaternion.
   */
  invert(): this {
    return Quat.invertToRef(this, this);
  }

  /**
   * Post-multiplies this rotation by another (`this = this * q`): applied to a vector, `q` happens
   * first.
   *
   * @param q - The right-hand rotation.
   * @returns This quaternion.
   */
  multiply(q: QuatLike): this {
    return Quat.multiplyToRef(this, q, this);
  }

  /**
   * The dot product of this quaternion with another. Its magnitude is the cosine of half the angle
   * between the two rotations.
   *
   * @param q - The other rotation.
   * @returns The dot product.
   */
  dot(q: QuatLike): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  /**
   * The length of this quaternion; 1 for a well-formed rotation.
   *
   * @returns The length.
   */
  length(): number {
    return Math.hypot(this.x, this.y, this.z, this.w);
  }

  /**
   * The squared length of this quaternion.
   *
   * @returns The squared length.
   */
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  /**
   * Compares this quaternion with another, component by component, with a tolerance. Note that `q`
   * and `-q` are the same rotation but are **not** equal by this test.
   *
   * @param q - The quaternion to compare against.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  equalsWithEpsilon(q: QuatLike, epsilon: number = EPSILON): boolean {
    return Quat.equalsWithEpsilon(this, q, epsilon);
  }

  /**
   * Writes this quaternion into a `Float32Array`, for GPU upload. The output comes first to mirror
   * Babylon Lite's `ObservableQuat.toArray`.
   *
   * @param out - The array to write into.
   * @param offset - The index of the X component. Defaults to 0.
   * @returns `out`.
   */
  toArray(out: Float32Array, offset: number = 0): Float32Array {
    out[offset] = this.x;
    out[offset + 1] = this.y;
    out[offset + 2] = this.z;
    out[offset + 3] = this.w;
    return out;
  }

  /**
   * The identity rotation.
   *
   * @returns A new `(0, 0, 0, 1)`. **Allocates**; see {@link QUAT_IDENTITY}.
   */
  static identity(): Quat {
    return new Quat(0, 0, 0, 1);
  }

  /**
   * Copies any quaternion-shaped value into a `Quat`.
   *
   * @param q - The quaternion to copy.
   * @returns A new quaternion. **Allocates.**
   */
  static from(q: QuatLike): Quat {
    return new Quat(q.x, q.y, q.z, q.w);
  }

  /**
   * Builds a rotation from Euler angles in degrees, in intrinsic XYZ order.
   *
   * @param xDegrees - Rotation about X (pitch), in degrees.
   * @param yDegrees - Rotation about Y (yaw), in degrees.
   * @param zDegrees - Rotation about Z (roll), in degrees.
   * @returns A new quaternion. **Allocates.**
   *
   * @example
   * ```ts
   * transform.localRotation.copyFrom(Quat.fromEulerDegrees(0, 90, 0)); // face +X
   * ```
   */
  static fromEulerDegrees(xDegrees: number, yDegrees: number, zDegrees: number): Quat {
    return Quat.fromEulerDegreesToRef(xDegrees, yDegrees, zDegrees, new Quat());
  }

  /**
   * Writes a rotation built from Euler degrees into `out`.
   *
   * @param xDegrees - Rotation about X (pitch), in degrees.
   * @param yDegrees - Rotation about Y (yaw), in degrees.
   * @param zDegrees - Rotation about Z (roll), in degrees.
   * @param out - The quaternion to write.
   * @returns `out`.
   */
  static fromEulerDegreesToRef<TOut extends MutableQuat>(
    xDegrees: number,
    yDegrees: number,
    zDegrees: number,
    out: TOut,
  ): TOut {
    return Quat.fromEulerRadToRef(degToRad(xDegrees), degToRad(yDegrees), degToRad(zDegrees), out);
  }

  /**
   * Builds a rotation from Euler angles in radians, in intrinsic XYZ order.
   *
   * @param xRad - Rotation about X, in radians.
   * @param yRad - Rotation about Y, in radians.
   * @param zRad - Rotation about Z, in radians.
   * @returns A new quaternion. **Allocates.**
   */
  static fromEulerRad(xRad: number, yRad: number, zRad: number): Quat {
    return Quat.fromEulerRadToRef(xRad, yRad, zRad, new Quat());
  }

  /**
   * Writes a rotation built from Euler radians into `out`. This is Babylon Lite's `eulerToQuat`
   * (`lib/math/quat-euler.js`) element for element, so a rotation built here means the same thing
   * to Lite's node hierarchy.
   *
   * @param xRad - Rotation about X, in radians.
   * @param yRad - Rotation about Y, in radians.
   * @param zRad - Rotation about Z, in radians.
   * @param out - The quaternion to write.
   * @returns `out`.
   */
  static fromEulerRadToRef<TOut extends MutableQuat>(xRad: number, yRad: number, zRad: number, out: TOut): TOut {
    const cx = Math.cos(xRad * 0.5);
    const sx = Math.sin(xRad * 0.5);
    const cy = Math.cos(yRad * 0.5);
    const sy = Math.sin(yRad * 0.5);
    const cz = Math.cos(zRad * 0.5);
    const sz = Math.sin(zRad * 0.5);
    out.set(
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz + sx * sy * cz,
      cx * cy * cz - sx * sy * sz,
    );
    return out;
  }

  /**
   * Writes a rotation's Euler angles in degrees into `out`, in intrinsic XYZ order — the inverse of
   * {@link Quat.fromEulerDegreesToRef}.
   *
   * @param q - The rotation to convert; assumed to be a unit quaternion.
   * @param out - The vector to write; `x` is pitch, `y` is yaw, `z` is roll, all in degrees.
   * @returns `out`.
   */
  static toEulerDegreesToRef<TOut extends MutableVec3>(q: QuatLike, out: TOut): TOut {
    Quat.toEulerRadToRef(q, out);
    out.set(radToDeg(out.x), radToDeg(out.y), radToDeg(out.z));
    return out;
  }

  /**
   * Writes a rotation's Euler angles in radians into `out`, in intrinsic XYZ order. This is Babylon
   * Lite's `quatToEulerXYZ` (`lib/math/quat-euler.js`) line for line, including its behaviour near
   * the poles: at a Y rotation of plus or minus 90 degrees the X and Z angles are not separable and
   * the result is one of the infinitely many valid answers.
   *
   * @param q - The rotation to convert; assumed to be a unit quaternion.
   * @param out - The vector to write, in radians.
   * @returns `out`.
   */
  static toEulerRadToRef<TOut extends MutableVec3>(q: QuatLike, out: TOut): TOut {
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;
    const sinY = 2 * (qx * qz + qw * qy);
    const ry = Math.asin(clamp(sinY, -1, 1));
    const rx = Math.atan2(-(2 * (qy * qz - qw * qx)), 1 - 2 * (qx * qx + qy * qy));
    const rz = Math.atan2(-(2 * (qx * qy - qw * qz)), 1 - 2 * (qy * qy + qz * qz));
    out.set(rx, ry, rz);
    return out;
  }

  /**
   * Builds a rotation of `degrees` about an axis.
   *
   * @param axis - The axis to turn about; normalized internally.
   * @param degrees - The angle, in degrees.
   * @returns A new quaternion. **Allocates.**
   */
  static fromAxisAngle(axis: Vec3Like, degrees: number): Quat {
    return Quat.fromAxisAngleToRef(axis, degrees, new Quat());
  }

  /**
   * Writes a rotation of `degrees` about an axis into `out`.
   *
   * @param axis - The axis to turn about; normalized internally. A zero-length axis writes the
   * identity rotation.
   * @param degrees - The angle, in degrees.
   * @param out - The quaternion to write.
   * @returns `out`.
   */
  static fromAxisAngleToRef<TOut extends MutableQuat>(axis: Vec3Like, degrees: number, out: TOut): TOut {
    const length = Math.hypot(axis.x, axis.y, axis.z);
    if (length === 0) {
      out.set(0, 0, 0, 1);
      return out;
    }
    const half = degToRad(degrees) * 0.5;
    const s = Math.sin(half) / length;
    out.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
    return out;
  }

  /**
   * Composes two rotations.
   *
   * @param a - The rotation applied second.
   * @param b - The rotation applied first.
   * @returns A new quaternion holding `a * b`. **Allocates.**
   */
  static multiply(a: QuatLike, b: QuatLike): Quat {
    return Quat.multiplyToRef(a, b, new Quat());
  }

  /**
   * Writes the Hamilton product `a * b` into `out`. Applied to a vector, `b` is performed first.
   *
   * @param a - The left-hand rotation.
   * @param b - The right-hand rotation.
   * @param out - The quaternion to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static multiplyToRef<TOut extends MutableQuat>(a: QuatLike, b: QuatLike, out: TOut): TOut {
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const aw = a.w;
    const bx = b.x;
    const by = b.y;
    const bz = b.z;
    const bw = b.w;
    out.set(
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    );
    return out;
  }

  /**
   * Writes the conjugate of `q` into `out`.
   *
   * @param q - The rotation to conjugate.
   * @param out - The quaternion to write; may alias `q`.
   * @returns `out`.
   */
  static conjugateToRef<TOut extends MutableQuat>(q: QuatLike, out: TOut): TOut {
    out.set(-q.x, -q.y, -q.z, q.w);
    return out;
  }

  /**
   * Writes the inverse of `q` into `out`, dividing the conjugate by the squared length.
   *
   * @param q - The rotation to invert.
   * @param out - The quaternion to write; may alias `q`. A zero-length input writes the identity.
   * @returns `out`.
   */
  static invertToRef<TOut extends MutableQuat>(q: QuatLike, out: TOut): TOut {
    const lengthSquared = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
    if (lengthSquared === 0) {
      out.set(0, 0, 0, 1);
      return out;
    }
    const inv = 1 / lengthSquared;
    out.set(-q.x * inv, -q.y * inv, -q.z * inv, q.w * inv);
    return out;
  }

  /**
   * Writes a unit-length copy of `q` into `out`.
   *
   * @param q - The rotation to normalize.
   * @param out - The quaternion to write; may alias `q`. A zero-length input writes the identity.
   * @returns `out`.
   */
  static normalizeToRef<TOut extends MutableQuat>(q: QuatLike, out: TOut): TOut {
    const length = Math.hypot(q.x, q.y, q.z, q.w);
    if (length === 0) {
      out.set(0, 0, 0, 1);
      return out;
    }
    const inv = 1 / length;
    out.set(q.x * inv, q.y * inv, q.z * inv, q.w * inv);
    return out;
  }

  /**
   * Interpolates between two rotations along the shortest arc, at a constant angular rate.
   *
   * @param a - The rotation returned at `t === 0`.
   * @param b - The rotation returned at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @returns A new quaternion. **Allocates.**
   */
  static slerp(a: QuatLike, b: QuatLike, t: number): Quat {
    return Quat.slerpToRef(a, b, t, new Quat());
  }

  /**
   * Writes the spherical interpolation of `a` and `b` into `out`, taking the shortest arc: when the
   * two rotations point away from each other one is negated first, which is the same rotation. Very
   * close rotations fall back to a normalized linear blend, where slerp is numerically unstable.
   *
   * @param a - The rotation written at `t === 0`.
   * @param b - The rotation written at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @param out - The quaternion to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static slerpToRef<TOut extends MutableQuat>(a: QuatLike, b: QuatLike, t: number, out: TOut): TOut {
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const aw = a.w;
    let bx = b.x;
    let by = b.y;
    let bz = b.z;
    let bw = b.w;
    let cosine = ax * bx + ay * by + az * bz + aw * bw;
    if (cosine < 0) {
      cosine = -cosine;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    let scaleA = 1 - t;
    let scaleB = t;
    if (cosine < 1 - 1e-6) {
      const angle = Math.acos(cosine);
      const invSin = 1 / Math.sin(angle);
      scaleA = Math.sin(scaleA * angle) * invSin;
      scaleB = Math.sin(scaleB * angle) * invSin;
    }
    out.set(ax * scaleA + bx * scaleB, ay * scaleA + by * scaleB, az * scaleA + bz * scaleB, aw * scaleA + bw * scaleB);
    return Quat.normalizeToRef(out, out);
  }

  /**
   * Rotates a vector by a quaternion, writing the result into `out`. This is the allocation-free
   * way to turn a local direction into a world direction.
   *
   * @param q - The rotation; assumed to be a unit quaternion.
   * @param v - The vector to rotate.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   *
   * @example
   * ```ts
   * // world-space forward of an entity
   * Quat.rotateVectorToRef(transform.localRotation, VEC3_FORWARD, forward);
   * ```
   */
  static rotateVectorToRef<TOut extends MutableVec3>(q: QuatLike, v: Vec3Like, out: TOut): TOut {
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;
    const vx = v.x;
    const vy = v.y;
    const vz = v.z;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    out.set(vx + qw * tx + qy * tz - qz * ty, vy + qw * ty + qz * tx - qx * tz, vz + qw * tz + qx * ty - qy * tx);
    return out;
  }

  /**
   * Builds the rotation that points local +Z along `forward` and local +Y as close to `up` as it
   * can (left-handed, ADR-0011).
   *
   * @param forward - The direction to face; normalized internally.
   * @param up - The reference up direction. Defaults to world up, `(0, 1, 0)`.
   * @returns A new quaternion. **Allocates.**
   */
  static lookRotation(forward: Vec3Like, up: Vec3Like = VEC3_UP): Quat {
    return Quat.lookRotationToRef(forward, up, new Quat());
  }

  /**
   * Writes the rotation that points local +Z along `forward` into `out`. The basis is built the way
   * Babylon Lite builds it in `quatFromLookDirectionRH` (`lib/math/quat-from-look-direction-rh.js`):
   * `right = up x forward`, `up' = forward x right`, columns `(right, up', forward)` — which in
   * ignifx's left-handed space is exactly the Unity-style look rotation, whatever the Lite function
   * is named.
   *
   * @param forward - The direction to face; normalized internally.
   * @param up - The reference up direction; normalized internally.
   * @param out - The quaternion to write. Degenerate input (a zero-length `forward`, or an `up`
   * parallel to it) writes the identity rotation, where Lite would produce a meaningless basis.
   * @returns `out`.
   */
  static lookRotationToRef<TOut extends MutableQuat>(forward: Vec3Like, up: Vec3Like, out: TOut): TOut {
    const forwardLength = Math.hypot(forward.x, forward.y, forward.z);
    if (forwardLength === 0) {
      out.set(0, 0, 0, 1);
      return out;
    }
    const invForward = 1 / forwardLength;
    const fx = forward.x * invForward;
    const fy = forward.y * invForward;
    const fz = forward.z * invForward;
    let rx = up.y * fz - up.z * fy;
    let ry = up.z * fx - up.x * fz;
    let rz = up.x * fy - up.y * fx;
    const rightLength = Math.hypot(rx, ry, rz);
    if (rightLength < 1e-10) {
      out.set(0, 0, 0, 1);
      return out;
    }
    const invRight = 1 / rightLength;
    rx *= invRight;
    ry *= invRight;
    rz *= invRight;
    const ux = fy * rz - fz * ry;
    const uy = fz * rx - fx * rz;
    const uz = fx * ry - fy * rx;
    basisToQuatToRef(rx, ux, fx, ry, uy, fy, rz, uz, fz, out);
    return Quat.normalizeToRef(out, out);
  }

  /**
   * Reads the rotation out of a transformation matrix.
   *
   * @param m - The matrix to read; scale is divided out first.
   * @returns A new quaternion. **Allocates.**
   */
  static fromRotationMatrix(m: Mat4Like): Quat {
    return Quat.fromRotationMatrixToRef(m, new Quat());
  }

  /**
   * Writes the rotation of a transformation matrix into `out`, dividing out the scale exactly as
   * {@link Mat4.decomposeToRef} does.
   *
   * @param m - The matrix to read.
   * @param out - The quaternion to write. Left untouched when a basis column has zero length.
   * @returns `out`.
   */
  static fromRotationMatrixToRef<TOut extends MutableQuat>(m: Mat4Like, out: TOut): TOut {
    return Mat4.getRotationToRef(m, out);
  }

  /**
   * The dot product of two rotations.
   *
   * @param a - The first rotation.
   * @param b - The second rotation.
   * @returns The dot product.
   */
  static dot(a: QuatLike, b: QuatLike): number {
    return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  }

  /**
   * The angle between two rotations, in degrees, along the shortest arc.
   *
   * @param a - The first rotation; assumed to be a unit quaternion.
   * @param b - The second rotation; assumed to be a unit quaternion.
   * @returns The angle in `[0, 180]` degrees.
   */
  static angleDegrees(a: QuatLike, b: QuatLike): number {
    const cosine = Math.abs(clamp(Quat.dot(a, b), -1, 1));
    return radToDeg(2 * Math.acos(cosine));
  }

  /**
   * Compares two quaternions component by component, with a tolerance. Note that `q` and `-q` are
   * the same rotation but are **not** equal by this test; compare with {@link Quat.angleDegrees}
   * when that matters.
   *
   * @param a - The first quaternion.
   * @param b - The second quaternion.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  static equalsWithEpsilon(a: QuatLike, b: QuatLike, epsilon: number = EPSILON): boolean {
    return (
      Math.abs(a.x - b.x) <= epsilon &&
      Math.abs(a.y - b.y) <= epsilon &&
      Math.abs(a.z - b.z) <= epsilon &&
      Math.abs(a.w - b.w) <= epsilon
    );
  }
}

/**
 * The frozen identity rotation, `(0, 0, 0, 1)`. Read-only: pass it anywhere a {@link QuatLike} is
 * wanted, and call `Quat.identity()` when you need one you can write to.
 *
 * @public
 */
export const QUAT_IDENTITY: QuatLike = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
