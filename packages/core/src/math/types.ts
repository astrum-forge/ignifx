/**
 * The structural shape of a 2D vector. Public APIs accept this interface so that plain object
 * literals, typed views, and the engine's `Vec2` class are interchangeable.
 *
 * @public
 */
export interface Vec2Like {
  /** The x component. */
  readonly x: number;
  /** The y component. */
  readonly y: number;
}

/**
 * The structural shape of a 3D vector.
 *
 * @public
 */
export interface Vec3Like {
  /** The x component. */
  readonly x: number;
  /** The y component. */
  readonly y: number;
  /** The z component. */
  readonly z: number;
}

/**
 * The structural shape of a 4D vector.
 *
 * @public
 */
export interface Vec4Like {
  /** The x component. */
  readonly x: number;
  /** The y component. */
  readonly y: number;
  /** The z component. */
  readonly z: number;
  /** The w component. */
  readonly w: number;
}

/**
 * The structural shape of a quaternion.
 *
 * @public
 */
export interface QuatLike {
  /** The x component of the vector part. */
  readonly x: number;
  /** The y component of the vector part. */
  readonly y: number;
  /** The z component of the vector part. */
  readonly z: number;
  /** The scalar part. */
  readonly w: number;
}

/**
 * The structural shape of an RGBA color.
 *
 * @public
 */
export interface ColorLike {
  /** The red channel. */
  readonly r: number;
  /** The green channel. */
  readonly g: number;
  /** The blue channel. */
  readonly b: number;
  /** The alpha channel. */
  readonly a: number;
}

/**
 * A read-only 4x4 matrix stored as 16 numbers in **column-major** order (`m[column * 4 + row]`),
 * the layout WGSL's `mat4x4<f32>` expects and the one Babylon Lite uses, so a Lite `Mat4` is a
 * `Mat4Like` and vice versa. Translation lives in slots 12/13/14.
 *
 * The storage type is deliberately unspecified: it is a `Float32Array` in both Lite and ignifx
 * today (see {@link Mat4.elements}) but callers must only rely on indexed reads and `length`.
 *
 * @example
 * ```ts
 * function translationX(m: Mat4Like): number {
 *   return m[12] ?? 0;
 * }
 * ```
 *
 * @public
 */
export interface Mat4Like {
  /** Always exactly 16. */
  readonly length: 16;
  /** Element access in column-major order; `m[column * 4 + row]`. */
  readonly [index: number]: number;
}

/**
 * A writable 2-component vector — the `out` shape of every `Vec2` `ToRef` function.
 *
 * @example
 * ```ts
 * const out = new Vec2();
 * Vec2.addToRef(a, b, out);
 * ```
 *
 * @public
 */
export interface MutableVec2 {
  /** The X component. */
  x: number;
  /** The Y component. */
  y: number;
  /**
   * Assigns every component at once.
   *
   * @param x - The new X component.
   * @param y - The new Y component.
   */
  set(x: number, y: number): void;
  /**
   * Copies every component from another vector.
   *
   * @param v - The vector to read.
   */
  copyFrom(v: Vec2Like): void;
}

/**
 * A writable 3-component vector — the `out` shape of every `Vec3` `ToRef` function, and the type
 * `Transform.localPosition`/`localScale` expose. Babylon Lite's `ObservableVec3` (the live view over
 * a `SceneNode`'s TRS) satisfies this interface exactly, so writing through it notifies Lite's
 * hierarchy without any copy (`docs/architecture/02-scene-graph.md` section 5).
 *
 * @example
 * ```ts
 * // `transform.localPosition` is a live MutableVec3 over the Lite node.
 * Vec3.addToRef(transform.localPosition, velocity, transform.localPosition);
 * ```
 *
 * @public
 */
export interface MutableVec3 {
  /** The X component. */
  x: number;
  /** The Y component. */
  y: number;
  /** The Z component. */
  z: number;
  /**
   * Assigns every component at once. Live views use this to emit a single change notification.
   *
   * @param x - The new X component.
   * @param y - The new Y component.
   * @param z - The new Z component.
   */
  set(x: number, y: number, z: number): void;
  /**
   * Copies every component from another vector.
   *
   * @param v - The vector to read.
   */
  copyFrom(v: Vec3Like): void;
}

/**
 * A writable 4-component vector — the `out` shape of every `Vec4` `ToRef` function.
 *
 * @example
 * ```ts
 * const out = new Vec4();
 * Vec4.lerpToRef(a, b, 0.5, out);
 * ```
 *
 * @public
 */
export interface MutableVec4 {
  /** The X component. */
  x: number;
  /** The Y component. */
  y: number;
  /** The Z component. */
  z: number;
  /** The W component. */
  w: number;
  /**
   * Assigns every component at once.
   *
   * @param x - The new X component.
   * @param y - The new Y component.
   * @param z - The new Z component.
   * @param w - The new W component.
   */
  set(x: number, y: number, z: number, w: number): void;
  /**
   * Copies every component from another vector.
   *
   * @param v - The vector to read.
   */
  copyFrom(v: Vec4Like): void;
}

/**
 * A writable quaternion — the `out` shape of every `Quat` `ToRef` function, and the type
 * `Transform.localRotation` exposes. Babylon Lite's `ObservableQuat` satisfies it exactly, so
 * rotations are written straight into the Lite node (`docs/architecture/02-scene-graph.md` section 5).
 *
 * @example
 * ```ts
 * Quat.fromEulerDegreesToRef(0, 90, 0, transform.localRotation);
 * ```
 *
 * @public
 */
export interface MutableQuat {
  /** The imaginary X component. */
  x: number;
  /** The imaginary Y component. */
  y: number;
  /** The imaginary Z component. */
  z: number;
  /** The real (scalar) component. */
  w: number;
  /**
   * Assigns every component at once. Live views use this to emit a single change notification.
   *
   * @param x - The new imaginary X component.
   * @param y - The new imaginary Y component.
   * @param z - The new imaginary Z component.
   * @param w - The new real component.
   */
  set(x: number, y: number, z: number, w: number): void;
  /**
   * Copies every component from another quaternion.
   *
   * @param q - The quaternion to read.
   */
  copyFrom(q: QuatLike): void;
}
