import { EPSILON, lerp } from "./math-utils.js";
import type { MutableVec4, Vec4Like } from "./types.js";

/**
 * A 4-component vector: homogeneous coordinates, a tangent with a handedness sign, or any packed
 * quadruple headed for a shader. Rotations use {@link Quat}, not this type.
 *
 * Instance methods mutate the receiver and return `this`; `ToRef` statics write into a final `out`
 * argument and allocate nothing; the remaining statics allocate and say so.
 *
 * @example
 * ```ts
 * const tangent = new Vec4(1, 0, 0, -1);
 * tangent.toArray(vertexBuffer, offset);
 * ```
 *
 * @public
 */
export class Vec4 {
  /** The X component. */
  x: number;
  /** The Y component. */
  y: number;
  /** The Z component. */
  z: number;
  /** The W component. */
  w: number;

  /**
   * Creates a vector.
   *
   * @param x - The X component. Defaults to 0.
   * @param y - The Y component. Defaults to 0.
   * @param z - The Z component. Defaults to 0.
   * @param w - The W component. Defaults to 0.
   */
  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  /**
   * Assigns every component at once.
   *
   * @param x - The new X component.
   * @param y - The new Y component.
   * @param z - The new Z component.
   * @param w - The new W component.
   * @returns This vector.
   */
  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  /**
   * Copies every component from another vector.
   *
   * @param v - The vector to read.
   * @returns This vector.
   */
  copyFrom(v: Vec4Like): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.w = v.w;
    return this;
  }

  /**
   * Copies this vector into a new one.
   *
   * @returns A new vector. **Allocates.**
   */
  clone(): Vec4 {
    return new Vec4(this.x, this.y, this.z, this.w);
  }

  /**
   * Adds another vector to this one.
   *
   * @param v - The vector to add.
   * @returns This vector.
   */
  add(v: Vec4Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.w += v.w;
    return this;
  }

  /**
   * Subtracts another vector from this one.
   *
   * @param v - The vector to subtract.
   * @returns This vector.
   */
  subtract(v: Vec4Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this.w -= v.w;
    return this;
  }

  /**
   * Multiplies this vector by another component by component.
   *
   * @param v - The vector to multiply by.
   * @returns This vector.
   */
  multiply(v: Vec4Like): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    this.w *= v.w;
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
    this.w *= scale;
    return this;
  }

  /**
   * Flips every component's sign.
   *
   * @returns This vector.
   */
  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this.w = -this.w;
    return this;
  }

  /**
   * Scales this vector to unit length; a zero-length vector is left at zero rather than becoming
   * `NaN`.
   *
   * @returns This vector.
   */
  normalize(): this {
    const length = Math.hypot(this.x, this.y, this.z, this.w);
    if (length === 0) {
      return this;
    }
    return this.scale(1 / length);
  }

  /**
   * Moves this vector towards a target by an interpolant.
   *
   * @param target - The vector reached at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @returns This vector.
   */
  lerp(target: Vec4Like, t: number): this {
    return Vec4.lerpToRef(this, target, t, this);
  }

  /**
   * The dot product of this vector with another.
   *
   * @param v - The other vector.
   * @returns The dot product.
   */
  dot(v: Vec4Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  /**
   * The length of this vector.
   *
   * @returns The length.
   */
  length(): number {
    return Math.hypot(this.x, this.y, this.z, this.w);
  }

  /**
   * The squared length of this vector.
   *
   * @returns The squared length.
   */
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  /**
   * Compares this vector with another, component by component, with a tolerance.
   *
   * @param v - The vector to compare against.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  equalsWithEpsilon(v: Vec4Like, epsilon: number = EPSILON): boolean {
    return Vec4.equalsWithEpsilon(this, v, epsilon);
  }

  /**
   * Writes this vector into a `Float32Array`, for GPU upload. The output comes first to mirror
   * Babylon Lite's `toArray` helpers.
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
   * The zero vector.
   *
   * @returns A new `(0, 0, 0, 0)`. **Allocates.**
   */
  static zero(): Vec4 {
    return new Vec4(0, 0, 0, 0);
  }

  /**
   * The vector whose components are all one.
   *
   * @returns A new `(1, 1, 1, 1)`. **Allocates.**
   */
  static one(): Vec4 {
    return new Vec4(1, 1, 1, 1);
  }

  /**
   * Copies any vector-shaped value into a `Vec4`.
   *
   * @param v - The vector to copy.
   * @returns A new vector. **Allocates.**
   */
  static from(v: Vec4Like): Vec4 {
    return new Vec4(v.x, v.y, v.z, v.w);
  }

  /**
   * Adds two vectors.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @returns A new vector. **Allocates.**
   */
  static add(a: Vec4Like, b: Vec4Like): Vec4 {
    return Vec4.addToRef(a, b, new Vec4());
  }

  /**
   * Subtracts one vector from another.
   *
   * @param a - The vector to subtract from.
   * @param b - The vector to subtract.
   * @returns A new vector holding `a - b`. **Allocates.**
   */
  static subtract(a: Vec4Like, b: Vec4Like): Vec4 {
    return Vec4.subtractToRef(a, b, new Vec4());
  }

  /**
   * Multiplies a vector by a number.
   *
   * @param v - The vector to scale.
   * @param scale - The factor.
   * @returns A new vector. **Allocates.**
   */
  static scale(v: Vec4Like, scale: number): Vec4 {
    return Vec4.scaleToRef(v, scale, new Vec4());
  }

  /**
   * A unit-length copy of a vector.
   *
   * @param v - The vector to normalize.
   * @returns A new vector. **Allocates.**
   */
  static normalize(v: Vec4Like): Vec4 {
    return Vec4.normalizeToRef(v, new Vec4());
  }

  /**
   * Linearly interpolates between two vectors.
   *
   * @param a - The vector returned at `t === 0`.
   * @param b - The vector returned at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @returns A new vector. **Allocates.**
   */
  static lerp(a: Vec4Like, b: Vec4Like, t: number): Vec4 {
    return Vec4.lerpToRef(a, b, t, new Vec4());
  }

  /**
   * Writes `a + b` into `out`.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static addToRef<TOut extends MutableVec4>(a: Vec4Like, b: Vec4Like, out: TOut): TOut {
    out.set(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
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
  static subtractToRef<TOut extends MutableVec4>(a: Vec4Like, b: Vec4Like, out: TOut): TOut {
    out.set(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w);
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
  static multiplyToRef<TOut extends MutableVec4>(a: Vec4Like, b: Vec4Like, out: TOut): TOut {
    out.set(a.x * b.x, a.y * b.y, a.z * b.z, a.w * b.w);
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
  static scaleToRef<TOut extends MutableVec4>(v: Vec4Like, scale: number, out: TOut): TOut {
    out.set(v.x * scale, v.y * scale, v.z * scale, v.w * scale);
    return out;
  }

  /**
   * Writes `-v` into `out`.
   *
   * @param v - The vector to flip.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   */
  static negateToRef<TOut extends MutableVec4>(v: Vec4Like, out: TOut): TOut {
    out.set(-v.x, -v.y, -v.z, -v.w);
    return out;
  }

  /**
   * Writes a unit-length copy of `v` into `out`; a zero-length input is written as zero.
   *
   * @param v - The vector to normalize.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   */
  static normalizeToRef<TOut extends MutableVec4>(v: Vec4Like, out: TOut): TOut {
    const length = Math.hypot(v.x, v.y, v.z, v.w);
    if (length === 0) {
      out.set(0, 0, 0, 0);
      return out;
    }
    const inv = 1 / length;
    out.set(v.x * inv, v.y * inv, v.z * inv, v.w * inv);
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
  static lerpToRef<TOut extends MutableVec4>(a: Vec4Like, b: Vec4Like, t: number, out: TOut): TOut {
    out.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t), lerp(a.w, b.w, t));
    return out;
  }

  /**
   * The dot product of two vectors.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @returns The dot product.
   */
  static dot(a: Vec4Like, b: Vec4Like): number {
    return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  }

  /**
   * The length of a vector.
   *
   * @param v - The vector to measure.
   * @returns The length.
   */
  static length(v: Vec4Like): number {
    return Math.hypot(v.x, v.y, v.z, v.w);
  }

  /**
   * The squared length of a vector.
   *
   * @param v - The vector to measure.
   * @returns The squared length.
   */
  static lengthSquared(v: Vec4Like): number {
    return v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w;
  }

  /**
   * Compares two vectors component by component, with a tolerance.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  static equalsWithEpsilon(a: Vec4Like, b: Vec4Like, epsilon: number = EPSILON): boolean {
    return (
      Math.abs(a.x - b.x) <= epsilon &&
      Math.abs(a.y - b.y) <= epsilon &&
      Math.abs(a.z - b.z) <= epsilon &&
      Math.abs(a.w - b.w) <= epsilon
    );
  }
}
