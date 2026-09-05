/**
 * Scalar helpers shared by the vector, quaternion and matrix types and by game code.
 *
 * Angles are **degrees** in every public API unless the name ends in `Rad`/`Radians`
 * (coding standards §5.1, ADR-0011). Every function here is a pure scalar function: none of them
 * allocate, so they are safe in per-frame code (coding standards §7).
 */

/**
 * The default tolerance for approximate float comparisons. Chosen for single-precision positions in
 * metres: `Float32Array` round-tripping loses roughly 1e-7 of relative precision, so 1e-6 is the
 * smallest value that does not report false differences on data that has been through the GPU.
 *
 * @public
 */
export const EPSILON: number = 1e-6;

/**
 * Multiplier that converts degrees to radians.
 *
 * @public
 */
export const DEG_TO_RAD: number = Math.PI / 180;

/**
 * Multiplier that converts radians to degrees.
 *
 * @public
 */
export const RAD_TO_DEG: number = 180 / Math.PI;

/**
 * Converts an angle from degrees to radians.
 *
 * @param degrees - The angle in degrees.
 * @returns The same angle in radians.
 *
 * @public
 */
export function degToRad(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/**
 * Converts an angle from radians to degrees.
 *
 * @param radians - The angle in radians.
 * @returns The same angle in degrees.
 *
 * @public
 */
export function radToDeg(radians: number): number {
  return radians * RAD_TO_DEG;
}

/**
 * Constrains a value to an inclusive range.
 *
 * @param value - The value to constrain.
 * @param min - The lower bound.
 * @param max - The upper bound.
 * @returns `min` when `value` is smaller, `max` when it is larger, otherwise `value` unchanged.
 * `NaN` propagates.
 *
 * @example
 * ```ts
 * clamp(12, 0, 10); // 10
 * ```
 *
 * @public
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Constrains a value to the 0–1 range.
 *
 * @param value - The value to constrain.
 * @returns The value clamped into `[0, 1]`.
 *
 * @public
 */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Linearly interpolates between two values. The interpolant is **not** clamped, so values outside
 * `[0, 1]` extrapolate; wrap `t` in {@link clamp01} when that is not wanted.
 *
 * @param a - The value returned at `t === 0`.
 * @param b - The value returned at `t === 1`.
 * @param t - The interpolant.
 * @returns The interpolated value.
 *
 * @example
 * ```ts
 * lerp(0, 10, 0.25); // 2.5
 * ```
 *
 * @public
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The inverse of {@link lerp}: finds the interpolant that maps `a`–`b` onto `value`.
 *
 * @param a - The value that maps to 0.
 * @param b - The value that maps to 1.
 * @param value - The value to locate.
 * @returns The interpolant, clamped into `[0, 1]`. Returns 0 when `a` and `b` are equal.
 *
 * @public
 */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) {
    return 0;
  }
  return clamp01((value - a) / (b - a));
}

/**
 * Smoothly interpolates between two edges with a Hermite curve (the GLSL `smoothstep`), easing in
 * and out instead of the straight ramp of {@link lerp}.
 *
 * @param edge0 - The value below which the result is 0.
 * @param edge1 - The value above which the result is 1.
 * @param x - The value to map.
 * @returns A value in `[0, 1]`. Degenerate edges (`edge0 === edge1`) step from 0 to 1 at the edge.
 *
 * @example
 * ```ts
 * smoothStep(0, 1, 0.5); // 0.5, but with zero slope at 0 and 1
 * ```
 *
 * @public
 */
export function smoothStep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Moves a value towards a target without overshooting it.
 *
 * @param current - The value to move.
 * @param target - The value to move towards.
 * @param maxDelta - The largest step allowed this call; negative values move away from the target.
 * @returns The stepped value, exactly `target` once the remaining distance fits in `maxDelta`.
 *
 * @example
 * ```ts
 * // frame-rate independent approach at 2 units per second
 * health = moveTowards(health, 100, 2 * time.deltaTime);
 * ```
 *
 * @public
 */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }
  return current + (delta < 0 ? -maxDelta : maxDelta);
}

/**
 * Wraps a value into `[0, length)`, the way a looping animation time behaves. Unlike `%` the result
 * is never negative.
 *
 * @param t - The value to wrap.
 * @param length - The positive period to wrap into.
 * @returns The wrapped value, clamped into `[0, length]` so float error cannot escape the range.
 *
 * @example
 * ```ts
 * repeat(-1, 4); // 3
 * ```
 *
 * @public
 */
export function repeat(t: number, length: number): number {
  return clamp(t - Math.floor(t / length) * length, 0, length);
}

/**
 * Bounces a value back and forth between 0 and `length`, the way a ping-pong animation behaves.
 *
 * @param t - The value to fold.
 * @param length - The positive half-period to fold into.
 * @returns A value in `[0, length]` that rises then falls as `t` increases.
 *
 * @example
 * ```ts
 * pingPong(5, 4); // 3
 * ```
 *
 * @public
 */
export function pingPong(t: number, length: number): number {
  return length - Math.abs(repeat(t, length * 2) - length);
}

/**
 * Compares two numbers with an absolute tolerance. Use this instead of `===` on anything that has
 * been through a matrix, a quaternion or a `Float32Array`.
 *
 * @param a - The first value.
 * @param b - The second value.
 * @param epsilon - The largest difference still considered equal. Defaults to {@link EPSILON}.
 * @returns `true` when the values differ by no more than `epsilon`. `NaN` is never approximately
 * equal to anything, including itself.
 *
 * @public
 */
export function approximately(a: number, b: number, epsilon: number = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/**
 * The sign of a value, with zero treated as positive (matching Unity's `Mathf.Sign`, and unlike
 * `Math.sign`, which returns 0 and `-0`).
 *
 * @param value - The value to inspect.
 * @returns `-1` for negative values, `1` for positive values and for both `0` and `-0`, and `NaN`
 * for `NaN`.
 *
 * @public
 */
export function sign(value: number): number {
  if (Number.isNaN(value)) {
    return Number.NaN;
  }
  return value < 0 ? -1 : 1;
}

/**
 * Wraps an angle in degrees into `[-180, 180)`, the range rotations are most readable in.
 *
 * @param degrees - The angle to wrap.
 * @returns The equivalent angle in `[-180, 180)`; exactly `180` wraps to `-180`.
 *
 * @example
 * ```ts
 * wrapAngleDegrees(370); // 10
 * wrapAngleDegrees(-190); // 170
 * ```
 *
 * @public
 */
export function wrapAngleDegrees(degrees: number): number {
  return repeat(degrees + 180, 360) - 180;
}

/**
 * The shortest signed rotation from one angle to another, in degrees.
 *
 * @param fromDegrees - The starting angle.
 * @param toDegrees - The target angle.
 * @returns The signed difference in `[-180, 180)`.
 *
 * @example
 * ```ts
 * deltaAngleDegrees(350, 10); // 20, not -340
 * ```
 *
 * @public
 */
export function deltaAngleDegrees(fromDegrees: number, toDegrees: number): number {
  return wrapAngleDegrees(toDegrees - fromDegrees);
}

/**
 * Interpolates between two angles in degrees the short way around the circle.
 *
 * @param fromDegrees - The angle returned at `t === 0`.
 * @param toDegrees - The angle approached at `t === 1`.
 * @param t - The interpolant; not clamped, matching {@link lerp}.
 * @returns The interpolated angle. It is not wrapped, so feeding the result back in is stable.
 *
 * @example
 * ```ts
 * lerpAngleDegrees(350, 10, 0.5); // 360
 * ```
 *
 * @public
 */
export function lerpAngleDegrees(fromDegrees: number, toDegrees: number, t: number): number {
  return fromDegrees + deltaAngleDegrees(fromDegrees, toDegrees) * t;
}
