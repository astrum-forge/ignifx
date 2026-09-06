import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { QuatLike, Vec2Like, Vec3Like } from "../math/types.js";

/**
 * One tweened property: what kind of value it holds, where it started, where it is going, and how
 * to write it back (`docs/architecture/12-3d-toolkit.md` §4).
 *
 * A channel allocates its two endpoint buffers once, when the tween is created, and never again —
 * which is what keeps `Tweens.advance` allocation-free on the per-frame path (coding standards §7).
 */

/**
 * The four value shapes a tween can interpolate.
 *
 * @public
 */
export const TWEEN_VALUE_KINDS = ["number", "vec2", "vec3", "quat"] as const;

/**
 * The union of {@link TWEEN_VALUE_KINDS}.
 *
 * @public
 */
export type TweenValueKind = (typeof TWEEN_VALUE_KINDS)[number];

/**
 * A value a tween knows how to interpolate: a plain number, or an object with `x`/`y`(`/z`(`/w`))
 * components.
 *
 * @public
 */
export type TweenableValue = number | Vec2Like | Vec3Like | QuatLike;

/** A mutable four-component scratch, wide enough for every {@link TweenValueKind}. */
interface Components {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Builds a zeroed component scratch.
 *
 * @returns The scratch.
 */
function components(): Components {
  return { x: 0, y: 0, z: 0, w: 1 };
}

/**
 * Classifies a runtime value.
 *
 * @param value - The value read off the target, or the one the caller asked for.
 * @returns The kind, or `null` when the value is not tweenable.
 */
function classify(value: unknown): TweenValueKind | null {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the typeof guards below check it.
  const record = value as Partial<Components>;
  if (typeof record.x !== "number" || typeof record.y !== "number") {
    return null;
  }
  if (typeof record.w === "number") {
    return "quat";
  }
  if (typeof record.z === "number") {
    return "vec3";
  }
  return "vec2";
}

/**
 * Whether writing `key` back onto `target` will reach an accessor rather than throw.
 *
 * @remarks
 * `Transform.localPosition` is a getter with no setter and hands back the live vector, so a tween
 * mutates it in place and must **not** assign; `Transform.position` is a getter/setter pair that
 * hands back a copy, so the tween has to assign for the write to land. The difference is invisible
 * from the value, so the descriptor is read once, at creation.
 *
 * @param target - The object being tweened.
 * @param key - The property name.
 * @returns `true` when a plain data property or an accessor with a setter lives at `key`.
 */
function isWritable(target: object, key: string): boolean {
  let cursor: object | null = target;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor !== undefined) {
      return descriptor.set !== undefined || descriptor.writable === true;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `getPrototypeOf` is typed `any`.
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  // Nothing declares the key anywhere on the chain, so a write creates an own data property.
  return true;
}

/**
 * Builds the error a non-tweenable field produces.
 *
 * @param key - The field name.
 * @returns The error to throw.
 */
function notTweenable(key: string): IgnifxError {
  return new IgnifxError(
    CoreErrorCode.tweenFieldNotTweenable,
    `${key} is not a number, Vec2, Vec3, or Quat on the tween target.`,
    {
      context: { field: key },
      hint: "Tween a numeric field, or a value with x/y(/z(/w)) components.",
    },
  );
}

/**
 * One property of one tween.
 *
 * @internal
 */
export class TweenChannel {
  /** The property name on the target. */
  readonly key: string;

  /** What shape the value has. */
  readonly kind: TweenValueKind;

  /** Whether the write has to be assigned back, or lands through in-place mutation alone. */
  readonly assigns: boolean;

  /** Where the value was when the tween started. */
  readonly from: Components = components();

  /** Where the value is going. */
  readonly to: Components = components();

  /**
   * Builds a channel, classifying the target's current value and the requested destination.
   *
   * @param target - The object being tweened.
   * @param key - The property name.
   * @param destination - The value the property should reach.
   * @throws IgnifxError with code `IGX-0110` when the field or the destination is not tweenable, or
   * when the two disagree about shape.
   */
  constructor(target: object, key: string, destination: TweenableValue) {
    const current: unknown = readField(target, key);
    const kind = classify(current);
    if (kind === null || classify(destination) !== kind) {
      throw notTweenable(key);
    }
    const assigns = isWritable(target, key);
    if (kind === "number" && !assigns) {
      // A read-only number cannot be tweened at all: there is no object to mutate in place.
      throw notTweenable(key);
    }
    this.key = key;
    this.kind = kind;
    this.assigns = assigns;
    read(destination, this.to);
  }

  /**
   * Latches the starting value. Called when the tween's delay elapses, not when it is created, so a
   * delayed tween starts from wherever the target actually is.
   *
   * @param target - The object being tweened.
   */
  capture(target: object): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- classified at construction.
    const current = readField(target, this.key) as TweenableValue | undefined;
    if (current !== undefined) {
      read(current, this.from);
    }
  }

  /**
   * Writes the interpolated value at `t`.
   *
   * @param target - The object being tweened.
   * @param t - The eased progress; free to fall outside `[0, 1]` when the curve overshoots.
   */
  apply(target: object, t: number): void {
    const record = writable(target);
    if (this.kind === "number") {
      record[this.key] = this.from.x + (this.to.x - this.from.x) * t;
      return;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- classified as a vector at construction.
    const current = record[this.key] as Components;
    if (this.kind === "quat") {
      slerpInto(this.from, this.to, t, current);
    } else {
      current.x = this.from.x + (this.to.x - this.from.x) * t;
      current.y = this.from.y + (this.to.y - this.from.y) * t;
      if (this.kind === "vec3") {
        current.z = this.from.z + (this.to.z - this.from.z) * t;
      }
    }
    if (this.assigns) {
      record[this.key] = current;
    }
  }
}

/**
 * Reads one property of a target by name.
 *
 * @remarks
 * A tween addresses fields the compiler cannot see, so the index signature has to be asserted
 * somewhere; doing it in one two-line helper is what keeps the rest of the file honest.
 *
 * @param target - The object being tweened.
 * @param key - The property name.
 * @returns The value, or `undefined`.
 */
function readField(target: object, key: string): unknown {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
  return (target as Readonly<Record<string, unknown>>)[key];
}

/**
 * Views a target as an indexable object so a tween can write the field it was given.
 *
 * @param target - The object being tweened.
 * @returns The same object, indexable.
 */
function writable(target: object): Record<string, unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see `readField`.
  return target as Record<string, unknown>;
}

/** Below this dot product the two quaternions are close enough that `nlerp` is indistinguishable. */
const SLERP_LINEAR_THRESHOLD = 0.9995;

/**
 * Spherically interpolates two quaternions into an existing object, without allocating.
 *
 * @remarks
 * `Quat.slerpToRef` wants a `MutableQuat`, which is the `Quat` class surface rather than a bare
 * `{ x, y, z, w }`; a tween writes into whatever object the target already holds, so it does the
 * four lines itself. The shortest arc is taken by flipping `b` when the dot product is negative,
 * matching `Quat.slerpToRef`.
 *
 * @param a - The start rotation.
 * @param b - The end rotation.
 * @param t - The interpolation factor.
 * @param out - The object to write into.
 */
function slerpInto(a: Components, b: Components, t: number, out: Components): void {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let sign = 1;
  if (dot < 0) {
    dot = -dot;
    sign = -1;
  }
  let scaleA = 1 - t;
  let scaleB = t * sign;
  if (dot < SLERP_LINEAR_THRESHOLD) {
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    scaleA = Math.sin((1 - t) * theta) / sinTheta;
    scaleB = (Math.sin(t * theta) / sinTheta) * sign;
  }
  out.x = a.x * scaleA + b.x * scaleB;
  out.y = a.y * scaleA + b.y * scaleB;
  out.z = a.z * scaleA + b.z * scaleB;
  out.w = a.w * scaleA + b.w * scaleB;
}

/**
 * Copies a tweenable value into a component scratch.
 *
 * @param value - The number or vector-like value.
 * @param out - The scratch to fill.
 */
function read(value: TweenableValue, out: Components): void {
  if (typeof value === "number") {
    out.x = value;
    return;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- numbers were ruled out above.
  const record = value as Partial<Components>;
  out.x = record.x ?? 0;
  out.y = record.y ?? 0;
  out.z = record.z ?? 0;
  out.w = record.w ?? 1;
}
