import { EPSILON, lerp } from "./math-utils.js";
import type { MutableVec2, Vec2Like } from "./types.js";

/**
 * A 2-component vector: a position or direction in the 2D toolkit's world space (Y up, X right,
 * metres — ADR-0011), a UV coordinate, or a 2D scale.
 *
 * Instance methods mutate the receiver and return `this`; `ToRef` statics write into a final `out`
 * argument and allocate nothing; the remaining statics allocate and say so.
 *
 * @example
 * ```ts
 * const velocity = new Vec2(1, 0);
 * velocity.scale(speed);
 * Vec2.addToRef(position, velocity, position);
 * ```
 *
 * @public
 */
export class Vec2 {
  /** The X component; positive is right. */
  x: number;
  /** The Y component; positive is up. */
  y: number;

  /**
   * Creates a vector.
   *
   * @param x - The X component. Defaults to 0.
   * @param y - The Y component. Defaults to 0.
   */
  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * Assigns every component at once.
   *
   * @param x - The new X component.
   * @param y - The new Y component.
   * @returns This vector.
   */
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Copies every component from another vector.
   *
   * @param v - The vector to read.
   * @returns This vector.
   */
  copyFrom(v: Vec2Like): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  /**
   * Copies this vector into a new one.
   *
   * @returns A new vector. **Allocates.**
   */
  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  /**
   * Adds another vector to this one.
   *
   * @param v - The vector to add.
   * @returns This vector.
   */
  add(v: Vec2Like): this {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  /**
   * Adds a scaled vector to this one, without a temporary.
   *
   * @param v - The vector to add.
   * @param scale - The factor to multiply `v` by first.
   * @returns This vector.
   */
  addScaled(v: Vec2Like, scale: number): this {
    this.x += v.x * scale;
    this.y += v.y * scale;
    return this;
  }

  /**
   * Subtracts another vector from this one.
   *
   * @param v - The vector to subtract.
   * @returns This vector.
   */
  subtract(v: Vec2Like): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  /**
   * Multiplies this vector by another component by component.
   *
   * @param v - The vector to multiply by.
   * @returns This vector.
   */
  multiply(v: Vec2Like): this {
    this.x *= v.x;
    this.y *= v.y;
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
    return this;
  }

  /**
   * Scales this vector to unit length; a zero-length vector is left at zero rather than becoming
   * `NaN`.
   *
   * @returns This vector.
   */
  normalize(): this {
    const length = Math.hypot(this.x, this.y);
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
  lerp(target: Vec2Like, t: number): this {
    return Vec2.lerpToRef(this, target, t, this);
  }

  /**
   * The dot product of this vector with another.
   *
   * @param v - The other vector.
   * @returns The dot product.
   */
  dot(v: Vec2Like): number {
    return this.x * v.x + this.y * v.y;
  }

  /**
   * The 2D cross product — the Z component of the 3D cross product. Its sign says which side of
   * this vector the other one falls on.
   *
   * @param v - The other vector.
   * @returns The scalar cross product.
   */
  cross(v: Vec2Like): number {
    return this.x * v.y - this.y * v.x;
  }

  /**
   * The length of this vector, in metres.
   *
   * @returns The length.
   */
  length(): number {
    return Math.hypot(this.x, this.y);
  }

  /**
   * The squared length of this vector.
   *
   * @returns The squared length.
   */
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  /**
   * The distance from this vector to another, in metres.
   *
   * @param v - The other position.
   * @returns The distance.
   */
  distance(v: Vec2Like): number {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  /**
   * The squared distance from this vector to another.
   *
   * @param v - The other position.
   * @returns The squared distance.
   */
  distanceSquared(v: Vec2Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  /**
   * Compares this vector with another, component by component, with a tolerance.
   *
   * @param v - The vector to compare against.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  equalsWithEpsilon(v: Vec2Like, epsilon: number = EPSILON): boolean {
    return Vec2.equalsWithEpsilon(this, v, epsilon);
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
    return out;
  }

  /**
   * The zero vector.
   *
   * @returns A new `(0, 0)`. **Allocates.**
   */
  static zero(): Vec2 {
    return new Vec2(0, 0);
  }

  /**
   * The vector whose components are both one.
   *
   * @returns A new `(1, 1)`. **Allocates.**
   */
  static one(): Vec2 {
    return new Vec2(1, 1);
  }

  /**
   * Copies any vector-shaped value into a `Vec2`.
   *
   * @param v - The vector to copy.
   * @returns A new vector. **Allocates.**
   */
  static from(v: Vec2Like): Vec2 {
    return new Vec2(v.x, v.y);
  }

  /**
   * Adds two vectors.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @returns A new vector. **Allocates.**
   */
  static add(a: Vec2Like, b: Vec2Like): Vec2 {
    return Vec2.addToRef(a, b, new Vec2());
  }

  /**
   * Subtracts one vector from another.
   *
   * @param a - The vector to subtract from.
   * @param b - The vector to subtract.
   * @returns A new vector holding `a - b`. **Allocates.**
   */
  static subtract(a: Vec2Like, b: Vec2Like): Vec2 {
    return Vec2.subtractToRef(a, b, new Vec2());
  }

  /**
   * Multiplies a vector by a number.
   *
   * @param v - The vector to scale.
   * @param scale - The factor.
   * @returns A new vector. **Allocates.**
   */
  static scale(v: Vec2Like, scale: number): Vec2 {
    return Vec2.scaleToRef(v, scale, new Vec2());
  }

  /**
   * A unit-length copy of a vector.
   *
   * @param v - The vector to normalize.
   * @returns A new vector. **Allocates.**
   */
  static normalize(v: Vec2Like): Vec2 {
    return Vec2.normalizeToRef(v, new Vec2());
  }

  /**
   * Linearly interpolates between two vectors.
   *
   * @param a - The vector returned at `t === 0`.
   * @param b - The vector returned at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @returns A new vector. **Allocates.**
   */
  static lerp(a: Vec2Like, b: Vec2Like, t: number): Vec2 {
    return Vec2.lerpToRef(a, b, t, new Vec2());
  }

  /**
   * Writes `a + b` into `out`.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param out - The vector to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static addToRef<TOut extends MutableVec2>(a: Vec2Like, b: Vec2Like, out: TOut): TOut {
    out.set(a.x + b.x, a.y + b.y);
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
  static subtractToRef<TOut extends MutableVec2>(a: Vec2Like, b: Vec2Like, out: TOut): TOut {
    out.set(a.x - b.x, a.y - b.y);
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
  static multiplyToRef<TOut extends MutableVec2>(a: Vec2Like, b: Vec2Like, out: TOut): TOut {
    out.set(a.x * b.x, a.y * b.y);
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
  static scaleToRef<TOut extends MutableVec2>(v: Vec2Like, scale: number, out: TOut): TOut {
    out.set(v.x * scale, v.y * scale);
    return out;
  }

  /**
   * Writes `-v` into `out`.
   *
   * @param v - The vector to flip.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   */
  static negateToRef<TOut extends MutableVec2>(v: Vec2Like, out: TOut): TOut {
    out.set(-v.x, -v.y);
    return out;
  }

  /**
   * Writes a unit-length copy of `v` into `out`; a zero-length input is written as zero.
   *
   * @param v - The vector to normalize.
   * @param out - The vector to write; may alias `v`.
   * @returns `out`.
   */
  static normalizeToRef<TOut extends MutableVec2>(v: Vec2Like, out: TOut): TOut {
    const length = Math.hypot(v.x, v.y);
    if (length === 0) {
      out.set(0, 0);
      return out;
    }
    const inv = 1 / length;
    out.set(v.x * inv, v.y * inv);
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
  static lerpToRef<TOut extends MutableVec2>(a: Vec2Like, b: Vec2Like, t: number, out: TOut): TOut {
    out.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
    return out;
  }

  /**
   * The dot product of two vectors.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @returns The dot product.
   */
  static dot(a: Vec2Like, b: Vec2Like): number {
    return a.x * b.x + a.y * b.y;
  }

  /**
   * The 2D cross product of two vectors — the Z component of their 3D cross product.
   *
   * @param a - The left-hand vector.
   * @param b - The right-hand vector.
   * @returns The scalar cross product.
   */
  static cross(a: Vec2Like, b: Vec2Like): number {
    return a.x * b.y - a.y * b.x;
  }

  /**
   * The length of a vector, in metres.
   *
   * @param v - The vector to measure.
   * @returns The length.
   */
  static length(v: Vec2Like): number {
    return Math.hypot(v.x, v.y);
  }

  /**
   * The squared length of a vector.
   *
   * @param v - The vector to measure.
   * @returns The squared length.
   */
  static lengthSquared(v: Vec2Like): number {
    return v.x * v.x + v.y * v.y;
  }

  /**
   * The distance between two positions, in metres.
   *
   * @param a - The first position.
   * @param b - The second position.
   * @returns The distance.
   */
  static distance(a: Vec2Like, b: Vec2Like): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Compares two vectors component by component, with a tolerance.
   *
   * @param a - The first vector.
   * @param b - The second vector.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  static equalsWithEpsilon(a: Vec2Like, b: Vec2Like, epsilon: number = EPSILON): boolean {
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
  }
}

/**
 * The frozen zero vector, `(0, 0)`.
 *
 * @public
 */
export const VEC2_ZERO: Vec2Like = Object.freeze({ x: 0, y: 0 });

/**
 * The frozen vector whose components are both one, `(1, 1)` — the identity 2D scale.
 *
 * @public
 */
export const VEC2_ONE: Vec2Like = Object.freeze({ x: 1, y: 1 });
