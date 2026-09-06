/**
 * The easing table tweens resolve `ease` against (`docs/architecture/12-3d-toolkit.md` §4).
 *
 * Every curve maps a normalized time `t` in `[0, 1]` to a normalized value that starts at `0` and
 * ends at `1`. `elasticOut` and `backOut` overshoot on the way — that is the point of them — so a
 * tween never clamps the value it interpolates, only the time it feeds in.
 *
 * The table is a frozen record of plain functions rather than a `switch`, so a custom curve and a
 * named one are the same thing at the call site: {@link resolveEase} returns a function either way
 * and the tween keeps it, which is what makes advancing a tween allocation-free.
 */

/** `c1` of the standard `backOut` overshoot constant. */
const BACK_OVERSHOOT = 1.70158;

/** `c3` of `backOut`: the overshoot constant plus one. */
const BACK_C3 = BACK_OVERSHOOT + 1;

/** The angular frequency `elasticOut` oscillates at. */
const ELASTIC_PERIOD = (2 * Math.PI) / 3;

/** The exponential decay `elasticOut` applies. */
const ELASTIC_DECAY = 10;

/** The elastic curve's phase offset. */
const ELASTIC_PHASE = 0.75;

/** The `bounceOut` gravity constant. */
const BOUNCE_N1 = 7.5625;

/** The `bounceOut` time divisor. */
const BOUNCE_D1 = 2.75;

/** Where `bounceOut`'s second bounce starts. */
const BOUNCE_STEP_2 = 1 / BOUNCE_D1;

/** Where `bounceOut`'s third bounce starts. */
const BOUNCE_STEP_3 = 2 / BOUNCE_D1;

/** Where `bounceOut`'s fourth bounce starts. */
const BOUNCE_STEP_4 = 2.5 / BOUNCE_D1;

/**
 * Linear interpolation: the identity curve.
 *
 * @param t - Normalized time in `[0, 1]`.
 * @returns `t`.
 */
function linear(t: number): number {
  return t;
}

/**
 * Quadratic ease in.
 *
 * @param t - Normalized time.
 * @returns The eased value.
 */
function quadIn(t: number): number {
  return t * t;
}

/**
 * Quadratic ease out.
 *
 * @param t - Normalized time.
 * @returns The eased value.
 */
function quadOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Quadratic ease in and out.
 *
 * @param t - Normalized time.
 * @returns The eased value.
 */
function quadInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Cubic ease in.
 *
 * @param t - Normalized time.
 * @returns The eased value.
 */
function cubicIn(t: number): number {
  return t * t * t;
}

/**
 * Cubic ease out.
 *
 * @param t - Normalized time.
 * @returns The eased value.
 */
function cubicOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Cubic ease in and out.
 *
 * @param t - Normalized time.
 * @returns The eased value.
 */
function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Sinusoidal ease in and out.
 *
 * @param t - Normalized time.
 * @returns The eased value.
 */
function sineInOut(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/**
 * Ease out with a backward overshoot before settling.
 *
 * @param t - Normalized time.
 * @returns The eased value, which exceeds `1` mid-curve.
 */
function backOut(t: number): number {
  return 1 + BACK_C3 * (t - 1) ** 3 + BACK_OVERSHOOT * (t - 1) ** 2;
}

/**
 * Ease out with a decaying oscillation.
 *
 * @param t - Normalized time.
 * @returns The eased value, which oscillates either side of `1`.
 */
function elasticOut(t: number): number {
  if (t === 0 || t === 1) {
    return t;
  }
  return 2 ** (-ELASTIC_DECAY * t) * Math.sin((t * ELASTIC_DECAY - ELASTIC_PHASE) * ELASTIC_PERIOD) + 1;
}

/**
 * Ease out with four decaying bounces.
 *
 * @param t - Normalized time.
 * @returns The eased value in `[0, 1]`.
 */
function bounceOut(t: number): number {
  if (t < BOUNCE_STEP_2) {
    return BOUNCE_N1 * t * t;
  }
  if (t < BOUNCE_STEP_3) {
    const shifted = t - 1.5 / BOUNCE_D1;
    return BOUNCE_N1 * shifted * shifted + 0.75;
  }
  if (t < BOUNCE_STEP_4) {
    const shifted = t - 2.25 / BOUNCE_D1;
    return BOUNCE_N1 * shifted * shifted + 0.9375;
  }
  const shifted = t - 2.625 / BOUNCE_D1;
  return BOUNCE_N1 * shifted * shifted + 0.984375;
}

/**
 * A curve mapping normalized time to a normalized value. Custom curves have this shape.
 *
 * @param t - Normalized time in `[0, 1]`.
 * @returns The eased value; `0` at `t = 0` and `1` at `t = 1`, free to overshoot in between.
 *
 * @public
 */
export type EasingFunction = (t: number) => number;

/**
 * Every named easing curve, keyed by the name `TweenOptions.ease` accepts.
 *
 * @example
 * ```ts
 * const halfway = EASINGS.cubicInOut(0.5); // 0.5
 * ```
 *
 * @public
 */
export const EASINGS: Readonly<Record<string, EasingFunction>> = Object.freeze({
  linear,
  quadIn,
  quadOut,
  quadInOut,
  cubicIn,
  cubicOut,
  cubicInOut,
  sineInOut,
  backOut,
  elasticOut,
  bounceOut,
});

/**
 * The names {@link EASINGS} declares, in table order (coding standards §5.2 — an `as const` table
 * and the union derived from it, never an enum).
 *
 * @public
 */
export const EASING_NAMES = [
  "linear",
  "quadIn",
  "quadOut",
  "quadInOut",
  "cubicIn",
  "cubicOut",
  "cubicInOut",
  "sineInOut",
  "backOut",
  "elasticOut",
  "bounceOut",
] as const;

/**
 * The union of the named easing curves.
 *
 * @public
 */
export type EasingName = (typeof EASING_NAMES)[number];

/**
 * Resolves an `ease` option to the function a tween will call.
 *
 * @param ease - A name from {@link EASING_NAMES}, a custom curve, or `undefined` for `linear`.
 * @returns The curve, or `null` when the name is not one the table declares.
 *
 * @example
 * ```ts
 * const curve = resolveEase("cubicOut");
 * ```
 *
 * @public
 */
export function resolveEase(ease: EasingName | EasingFunction | undefined): EasingFunction | null {
  if (ease === undefined) {
    return linear;
  }
  if (typeof ease === "function") {
    return ease;
  }
  return EASINGS[ease] ?? null;
}
