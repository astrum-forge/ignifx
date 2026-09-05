import { Mat4 } from "./mat4.js";
import { EPSILON, lerp } from "./math-utils.js";
import type { Mat4Like, MutableVec3, Vec3Like } from "./types.js";

/**
 * A 3-component vector: a position or a direction in metres, or a per-axis scale. ignifx is
 * left-handed with Y up and +Z forward (ADR-0011), so {@link Vec3.forward} is `(0, 0, 1)` and
 * {@link Vec3.right} is `(1, 0, 0)`.
 *
 * The fields are plain mutable numbers, which is what makes a `Vec3` interchangeable with Babylon
 * Lite's `{ x, y, z }` vectors and with the live {@link MutableVec3} views a `Transform` exposes.
 *
 * Three families of operations, and the names say which is which:
 *
 * - instance methods mutate the receiver and return `this` (`a.add(b)` means `a += b`);
 * - `ToRef` statics write into a final `out` argument, allocate nothing, and are safe when `out`
 *   aliases an input — these are what per-frame code uses (coding standards section 7);
 * - the remaining statics return a fresh vector and are documented as allocating.
 *
 * @example
 * ```ts
 * // convenience code
 * const offset = Vec3.add(position, Vec3.scale(direction, distance));
 *
 * // per-frame code: no allocation
 * Vec3.scaleToRef(direction, distance, scratch);
 * Vec3.addToRef(position, scratch, position);
 * ```
 *
 * @public
 */
export class Vec3 {
  /** The X component; positive is right. */
  x: number;
  /** The Y component; positive is up. */
  y: number;
  /** The Z component; positive is forward. */
  z: number;

  /**
   * Creates a vector.
   *
   * @param x - The X component. Defaults to 0.
   * @param y - The Y component. Defaults to 0.
   * @param z - The Z component. Defaults to 0.
   */
  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * Assigns every component at once.
   *
   * @param x - The new X component.
   * @param y - The new Y component.
   * @param z - The new Z component.
   * @returns This vector.
   */
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  /**
   * Copies every component from another vector.
   *
   * @param v - The vector to read.
   * @returns This vector.
   */
  copyFrom(v: Vec3Like): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  /**
   * Copies this vector into a new one.
   *
   * @returns A new vector. **Allocates.**
   */
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  /**
   * Adds another vector to this one.
   *
   * @param v - The vector to add.
   * @returns This vector.
   */
  add(v: Vec3Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  /**
   * Adds a scaled vector to this one — the "move by velocity times delta time" step, without a
   * temporary.
   *
   * @param v - The vector to add.
   * @param scale - The factor to multiply `v` by first.
   * @returns This vector.
   *
   * @example
   * ```ts
   * position.addScaled(velocity, time.deltaTime);
   * ```
   */
  addScaled(v: Vec3Like, scale: number): this {
    this.x += v.x * scale;
    this.y += v.y * scale;
    this.z += v.z * scale;
    return this;
  }

  /**
   * Subtracts another vector from this one.
   *
   * @param v - The vector to subtract.
   * @returns This vector.
   */
  subtract(v: Vec3Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  /**
   * Multiplies this vector by another component by component.
   *
   * @param v - The vector to multiply by.
   * @returns This vector.
   */
  multiply(v: Vec3Like): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }

  /**
   * Multiplies every component by a number.
   *
   * @param scale - The factor.
   * @returns This vector.
   */
  scale(scale: number): this {
    this.x *= scale;
    this.y *= scale;
    this.z *= scale;
    return this;
  }

  /**
   * Flips this vector to point the other way.
   *
   * @returns This vector.
   */
  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  /**
   * Scales this vector to unit length. A zero-length vector is left at zero rather than becoming
   * `NaN`, so callers can normalize an unchecked direction safely.
   *
   * @returns This vector.
   */
  normalize(): this {
    const length = Math.hypot(this.x, this.y, this.z);
    if (length === 0) {
      return this;
    }
    return this.scale(1 / length);
  }

  /**
   * Replaces this vector with its cross product with another (`this = this x v`).
   *
   * @param v - The right-hand vector.
   * @returns This vector.
   */
  cross(v: Vec3Like): this {
    return Vec3.crossToRef(this, v, this);
  }

  /**
   * Moves this vector towards a target by an interpolant.
   *
   * @param target - The vector reached at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @returns This vector.
   */
  lerp(target: Vec3Like, t: number): this {
    return Vec3.lerpToRef(this, target, t, this);
  }

  /**
   * The dot product of this vector with another.
   *
   * @param v - The other vector.
   * @returns The dot product.
   */
  dot(v: Vec3Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /**
   * The length of this vector, in metres.
   *
   * @returns The length.
   */
  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  /**
   * The squared length of this vector. Prefer it over `length()` when comparing distances:
   * it skips the square root.
   *
   * @returns The squared length.
   */
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /**
   * The distance from this vector to another, in metres.
   *
   * @param v - The other position.
   * @returns The distance.
   */
  distance(v: Vec3Like): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  /**
   * The squared distance from this vector to another.
   *
   * @param v - The other position.
   * @returns The squared distance.
   */
  distanceSquared(v: Vec3Like): number {
    return Vec3.distanceSquared(this, v);
  }

  /**
   * Compares this vector with another, component by component, with a tolerance.
   *
   * @param v - The vector to compare against.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  equalsWithEpsilon(v: Vec3Like, epsilon: number = EPSILON): boolean {
    return Vec3.equalsWithEpsilon(this, v, epsilon);
  }

  /**
   * Writes this vector into a `Float32Array`, for GPU upload. The output comes first to mirror
   * Babylon Lite's `ObservableVec3.toArray`, the shape the adapter has to interoperate with.
   *
   * @param out - The array to write into.
   * @param offset - The index of the X component. Defaults to 0.
   * @returns `out`.
   */
  toArray(out: Float32Array, offset: number = 0): Float32Array {
    out[offset] = this.x;
    out[offset + 1] = this.y;
    out[offset + 2] = this.z;
    return out;
  }

  /**
   * The zero vector.
   *
   * @returns A new `(0, 0, 0)`. **Allocates**; use {@link VEC3_ZERO} when a read-only value will do.
   */
  static zero(): Vec3 {
    return new Vec3(0, 0, 0);
  }

  /**
   * The vector whose components are all one.
   *
   * @returns A new `(1, 1, 1)`. **Allocates.**
   */
  static one(): Vec3 {
    return new Vec3(1, 1, 1);
  }

  /**
   * The world up direction.
   *
   * @returns A new `(0, 1, 0)`. **Allocates**; see {@link VEC3_UP}.
   */
  static up(): Vec3 {
    return new Vec3(0, 1, 0);
  }

  /**
   * The world down direction.
   *
   * @returns A new `(0, -1, 0)`. **Allocates.**
   */
  static down(): Vec3 {
    return new Vec3(0, -1, 0);
  }

  /**
   * The world right direction.
   *
   * @returns A new `(1, 0, 0)`. **Allocates**; see {@link VEC3_RIGHT}.
   */
  static right(): Vec3 {
    return new Vec3(1, 0, 0);
  }

  /**
   * The world left direction.
   *
   * @returns A new `(-1, 0, 0)`. **Allocates.**
   */
  static left(): Vec3 {
    return new Vec3(-1, 0, 0);
  }

  /**
   * The world forward direction. ignifx is left-handed, so forward is **+Z** (ADR-0011).
   *
   * @returns A new `(0, 0, 1)`. **Allocates**; see {@link VEC3_FORWARD}.
   */
  static forward(): Vec3 {
    return new Vec3(0, 0, 1);
  }

  /**
   * The world backward direction.
   *
   * @returns A new `(0, 0, -1)`. **Allocates.**
   */
  static backward(): Vec3 {
    return new Vec3(0, 0, -1);
  }

  /**
   * Copies any vector-shaped value into a `Vec3`.
   *
   * @param v - The vector to copy.
   * @returns A new vector. **Allocates.**
   *
   * @example
   * ```ts
   * const position = Vec3.from(node.position); // snapshot of a live Lite view
   * ```
   */
  static from(v: Vec3Like): Vec3 {
    return new Vec3(v.x, v.y, v.z);
  }

  /**
   * Adds two vectors.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @returns A new vector. **Allocates**; use {@link Vec3.addToRef} in per-frame code.
   */
  static add(a: Vec3Like, b: Vec3Like): Vec3 {
    return Vec3.addToRef(a, b, new Vec3());
  }

  /**
   * Subtracts one vector from another.
   *
   * @param a - The vector to subtract from.
   * @param b - The vector to subtract.
   * @returns A new vector holding `a - b`. **Allocates.**
   */
  static subtract(a: Vec3Like, b: Vec3Like): Vec3 {
    return Vec3.subtractToRef(a, b, new Vec3());
  }

  /**
   * Multiplies a vector by a number.
   *
   * @param v - The vector to scale.
   * @param scale - The factor.
   * @returns A new vector. **Allocates.**
   */
  static scale(v: Vec3Like, scale: number): Vec3 {
    return Vec3.scaleToRef(v, scale, new Vec3());
  }

  /**
   * The cross product of two vectors.
   *
   * @param a - The left-hand vector.
   * @param b - The right-hand vector.
   * @returns A new vector holding `a x b`. **Allocates.**
   */
  static cross(a: Vec3Like, b: Vec3Like): Vec3 {
    return Vec3.crossToRef(a, b, new Vec3());
  }

  /**
   * A unit-length copy of a vector.
   *
   * @param v - The vector to normalize.
   * @returns A new vector. **Allocates.**
   */
  static normalize(v: Vec3Like): Vec3 {
    return Vec3.normalizeToRef(v, new Vec3());
  }

  /**
   * Linearly interpolates between two vectors.
   *
   * @param a - The vector returned at `t === 0`.
   * @param b - The vector returned at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @returns A new vector. **Allocates.**
   */
  static lerp(a: Vec3Like, b: Vec3Like, t: number): Vec3 {
    return Vec3.lerpToRef(a, b, t, new Vec3());
  }

  /**
   * Writes `a + b` into `out`.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static addToRef<TOut extends MutableVec3>(a: Vec3Like, b: Vec3Like, out: TOut): TOut {
    out.set(a.x + b.x, a.y + b.y, a.z + b.z);
    return out;
  }

  /**
   * Writes `a - b` into `out`.
   *
   * @param a - The vector to subtract from.
   * @param b - The vector to subtract.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static subtractToRef<TOut extends MutableVec3>(a: Vec3Like, b: Vec3Like, out: TOut): TOut {
    out.set(a.x - b.x, a.y - b.y, a.z - b.z);
    return out;
  }

  /**
   * Writes the component-wise product `a * b` into `out`.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static multiplyToRef<TOut extends MutableVec3>(a: Vec3Like, b: Vec3Like, out: TOut): TOut {
    out.set(a.x * b.x, a.y * b.y, a.z * b.z);
    return out;
  }

  /**
   * Writes `v * scale` into `out`.
   *
   * @param v - The vector to scale.
   * @param scale - The factor.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   */
  static scaleToRef<TOut extends MutableVec3>(v: Vec3Like, scale: number, out: TOut): TOut {
    out.set(v.x * scale, v.y * scale, v.z * scale);
    return out;
  }

  /**
   * Writes `-v` into `out`.
   *
   * @param v - The vector to flip.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   */
  static negateToRef<TOut extends MutableVec3>(v: Vec3Like, out: TOut): TOut {
    out.set(-v.x, -v.y, -v.z);
    return out;
  }

  /**
   * Writes a unit-length copy of `v` into `out`. A zero-length input is written as zero rather than
   * `NaN`.
   *
   * @param v - The vector to normalize.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   */
  static normalizeToRef<TOut extends MutableVec3>(v: Vec3Like, out: TOut): TOut {
    const length = Math.hypot(v.x, v.y, v.z);
    if (length === 0) {
      out.set(0, 0, 0);
      return out;
    }
    const inv = 1 / length;
    out.set(v.x * inv, v.y * inv, v.z * inv);
    return out;
  }

  /**
   * Writes `a x b` into `out`.
   *
   * @param a - The left-hand vector.
   * @param b - The right-hand vector.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static crossToRef<TOut extends MutableVec3>(a: Vec3Like, b: Vec3Like, out: TOut): TOut {
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const bx = b.x;
    const by = b.y;
    const bz = b.z;
    out.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    return out;
  }

  /**
   * Writes the interpolation of `a` and `b` into `out`.
   *
   * @param a - The vector written at `t === 0`.
   * @param b - The vector written at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static lerpToRef<TOut extends MutableVec3>(a: Vec3Like, b: Vec3Like, t: number, out: TOut): TOut {
    out.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
    return out;
  }

  /**
   * Writes the component-wise minimum of two vectors into `out`.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static minToRef<TOut extends MutableVec3>(a: Vec3Like, b: Vec3Like, out: TOut): TOut {
    out.set(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
    return out;
  }

  /**
   * Writes the component-wise maximum of two vectors into `out`.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static maxToRef<TOut extends MutableVec3>(a: Vec3Like, b: Vec3Like, out: TOut): TOut {
    out.set(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
    return out;
  }

  /**
   * Transforms a **position** by a matrix into `out`: the matrix's translation is applied and the
   * result is divided by w, so a projection matrix gives clip-space coordinates.
   *
   * @param v - The position to transform, in metres.
   * @param m - The transformation, column-major.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   *
   * @example
   * ```ts
   * Vec3.transformCoordinatesToRef(localPoint, node.worldMatrix, worldPoint);
   * ```
   */
  static transformCoordinatesToRef<TOut extends MutableVec3>(v: Vec3Like, m: Mat4Like, out: TOut): TOut {
    return Mat4.transformPointToRef(m, v, out);
  }

  /**
   * Transforms a **direction** by a matrix into `out`, ignoring the matrix's translation.
   *
   * @param v - The direction to transform.
   * @param m - The transformation, column-major.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   */
  static transformNormalToRef<TOut extends MutableVec3>(v: Vec3Like, m: Mat4Like, out: TOut): TOut {
    return Mat4.transformDirectionToRef(m, v, out);
  }

  /**
   * The dot product of two vectors.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @returns The dot product.
   */
  static dot(a: Vec3Like, b: Vec3Like): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  /**
   * The length of a vector, in metres.
   *
   * @param v - The vector to measure.
   * @returns The length.
   */
  static length(v: Vec3Like): number {
    return Math.hypot(v.x, v.y, v.z);
  }

  /**
   * The squared length of a vector.
   *
   * @param v - The vector to measure.
   * @returns The squared length.
   */
  static lengthSquared(v: Vec3Like): number {
    return v.x * v.x + v.y * v.y + v.z * v.z;
  }

  /**
   * The distance between two positions, in metres.
   *
   * @param a - The first position.
   * @param b - The second position.
   * @returns The distance.
   */
  static distance(a: Vec3Like, b: Vec3Like): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /**
   * The squared distance between two positions. Compare squared distances to avoid a square root.
   *
   * @param a - The first position.
   * @param b - The second position.
   * @returns The squared distance.
   */
  static distanceSquared(a: Vec3Like, b: Vec3Like): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Compares two vectors component by component, with a tolerance.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  static equalsWithEpsilon(a: Vec3Like, b: Vec3Like, epsilon: number = EPSILON): boolean {
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon && Math.abs(a.z - b.z) <= epsilon;
  }
}

/**
 * The frozen zero vector, `(0, 0, 0)`. Read-only: pass it anywhere a {@link Vec3Like} is wanted, and
 * call {@link Vec3.zero} when you need a vector you can write to.
 *
 * @public
 */
export const VEC3_ZERO: Vec3Like = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * The frozen vector whose components are all one, `(1, 1, 1)` — the identity scale.
 *
 * @public
 */
export const VEC3_ONE: Vec3Like = Object.freeze({ x: 1, y: 1, z: 1 });

/**
 * The frozen world up direction, `(0, 1, 0)`.
 *
 * @public
 */
export const VEC3_UP: Vec3Like = Object.freeze({ x: 0, y: 1, z: 0 });

/**
 * The frozen world down direction, `(0, -1, 0)`.
 *
 * @public
 */
export const VEC3_DOWN: Vec3Like = Object.freeze({ x: 0, y: -1, z: 0 });

/**
 * The frozen world right direction, `(1, 0, 0)`.
 *
 * @public
 */
export const VEC3_RIGHT: Vec3Like = Object.freeze({ x: 1, y: 0, z: 0 });

/**
 * The frozen world left direction, `(-1, 0, 0)`.
 *
 * @public
 */
export const VEC3_LEFT: Vec3Like = Object.freeze({ x: -1, y: 0, z: 0 });

/**
 * The frozen world forward direction, `(0, 0, 1)`. ignifx is left-handed, so forward is +Z
 * (ADR-0011).
 *
 * @public
 */
export const VEC3_FORWARD: Vec3Like = Object.freeze({ x: 0, y: 0, z: 1 });

/**
 * The frozen world backward direction, `(0, 0, -1)`.
 *
 * @public
 */
export const VEC3_BACKWARD: Vec3Like = Object.freeze({ x: 0, y: 0, z: -1 });
