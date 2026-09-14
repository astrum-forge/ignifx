import { assertNever } from "@ignifx/core";
import { LOOKUP_SAMPLES } from "./types.js";
import type { ColorValue, GradientStop, ScalarValue } from "./types.js";
import type { ColorLike, CurveKey, CurveValue } from "@ignifx/core";

// Hermite curves, gradients, and the 64-sample lookup rows both evaluators read
// (`docs/plan/2026-09-terrain-particles-shaders.md` §4.1). The baking functions run once inside
// `defineParticles`; the sampling functions read preallocated rows through `out` parameters.

/** Floats per colour sample. */
const COLOR_FLOATS = 4;

/**
 * Evaluates a cubic Hermite curve at `t`, clamping to the end keys outside the key range
 * (`docs/architecture/06-serialization-and-scene-format.md` §3: keys are
 * `[time, value, inTangent, outTangent]`).
 *
 * @param curve - The curve; its keys must be sorted by time and non-empty.
 * @param t - Where to evaluate.
 * @returns The value; `0` for a curve with no keys.
 *
 * @public
 */
export function evaluateCurve(curve: CurveValue, t: number): number {
  const keys = curve.keys;
  const count = keys.length;
  const first = keys[0];
  if (first === undefined) {
    return 0;
  }
  if (t <= first[0]) {
    return first[1];
  }
  const last = keys[count - 1];
  if (last === undefined || t >= last[0]) {
    return last?.[1] ?? first[1];
  }
  let index = 1;
  while (index < count) {
    const key = keys[index];
    if (key !== undefined && key[0] >= t) {
      break;
    }
    index += 1;
  }
  const k0 = keys[index - 1];
  const k1 = keys[index];
  if (k0 === undefined || k1 === undefined) {
    return first[1];
  }
  return hermite(k0, k1, t);
}

/**
 * Interpolates between two keys.
 *
 * @param k0 - The key before `t`.
 * @param k1 - The key after `t`.
 * @param t - Where to evaluate.
 * @returns The interpolated value.
 */
function hermite(k0: CurveKey, k1: CurveKey, t: number): number {
  const dt = k1[0] - k0[0];
  if (dt <= 0) {
    return k1[1];
  }
  const s = (t - k0[0]) / dt;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * k0[1] + h10 * dt * k0[3] + h01 * k1[1] + h11 * dt * k1[2];
}

/**
 * Bakes a curve into {@link LOOKUP_SAMPLES} samples over `[0, 1]`.
 *
 * @param curve - The curve.
 * @returns The samples; sample `i` is the curve at `i / 63`.
 *
 * @public
 */
export function bakeCurve(curve: CurveValue): Float32Array {
  const samples = new Float32Array(LOOKUP_SAMPLES);
  for (let index = 0; index < LOOKUP_SAMPLES; index += 1) {
    samples[index] = evaluateCurve(curve, index / (LOOKUP_SAMPLES - 1));
  }
  return samples;
}

/**
 * Evaluates a gradient at `t` by linear interpolation between stops, clamping outside them.
 *
 * @param stops - The stops, sorted by time and non-empty.
 * @param t - Where to evaluate.
 * @param out - Receives the sRGB colour.
 * @returns `out`.
 *
 * @public
 */
export function evaluateGradient(stops: readonly GradientStop[], t: number, out: Float32Array): Float32Array {
  const first = stops[0];
  if (first === undefined) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    out[3] = 1;
    return out;
  }
  const last = stops[stops.length - 1] ?? first;
  if (t <= first[0]) {
    return writeStop(first, out);
  }
  if (t >= last[0]) {
    return writeStop(last, out);
  }
  let index = 1;
  while (index < stops.length) {
    const stop = stops[index];
    if (stop !== undefined && stop[0] >= t) {
      break;
    }
    index += 1;
  }
  const a = stops[index - 1];
  const b = stops[index];
  if (a === undefined || b === undefined) {
    return writeStop(first, out);
  }
  const span = b[0] - a[0];
  const s = span <= 0 ? 1 : (t - a[0]) / span;
  out[0] = a[1] + (b[1] - a[1]) * s;
  out[1] = a[2] + (b[2] - a[2]) * s;
  out[2] = a[3] + (b[3] - a[3]) * s;
  out[3] = a[4] + (b[4] - a[4]) * s;
  return out;
}

/**
 * Copies a stop's colour.
 *
 * @param stop - The stop.
 * @param out - Receives the colour.
 * @returns `out`.
 */
function writeStop(stop: GradientStop, out: Float32Array): Float32Array {
  out[0] = stop[1];
  out[1] = stop[2];
  out[2] = stop[3];
  out[3] = stop[4];
  return out;
}

/**
 * Bakes a gradient into {@link LOOKUP_SAMPLES} RGBA samples.
 *
 * @param stops - The stops.
 * @returns `LOOKUP_SAMPLES * 4` floats, sRGB.
 *
 * @public
 */
export function bakeGradient(stops: readonly GradientStop[]): Float32Array {
  const samples = new Float32Array(LOOKUP_SAMPLES * COLOR_FLOATS);
  const scratch = new Float32Array(COLOR_FLOATS);
  for (let index = 0; index < LOOKUP_SAMPLES; index += 1) {
    evaluateGradient(stops, index / (LOOKUP_SAMPLES - 1), scratch);
    samples.set(scratch, index * COLOR_FLOATS);
  }
  return samples;
}

/**
 * Samples a baked scalar row with the linear rule both evaluators share: `x = t * 63`, then a lerp
 * between samples `floor(x)` and `floor(x) + 1`.
 *
 * @param samples - A row of {@link LOOKUP_SAMPLES} floats.
 * @param t - The normalized time, clamped to `[0, 1]`.
 * @returns The interpolated value.
 *
 * @public
 */
export function sampleRow(samples: Float32Array, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const x = clamped * (LOOKUP_SAMPLES - 1);
  const index = Math.floor(x);
  const next = index + 1 >= LOOKUP_SAMPLES ? index : index + 1;
  const a = samples[index] ?? 0;
  const b = samples[next] ?? a;
  return a + (b - a) * (x - index);
}

/**
 * The smallest value a scalar can produce: the constant, the range's `min`, or the curve's minimum.
 *
 * @param value - The scalar.
 * @returns The minimum.
 *
 * @public
 */
export function scalarMin(value: ScalarValue): number {
  switch (value.kind) {
    case "constant":
      return value.value;
    case "random":
      return Math.min(value.min, value.max);
    case "curve":
      return rowMin(value.samples);
    default:
      return assertNever(value, "scalar value");
  }
}

/**
 * The largest value a scalar can produce.
 *
 * @param value - The scalar.
 * @returns The maximum.
 *
 * @public
 */
export function scalarMax(value: ScalarValue): number {
  switch (value.kind) {
    case "constant":
      return value.value;
    case "random":
      return Math.max(value.min, value.max);
    case "curve":
      return rowMax(value.samples);
    default:
      return assertNever(value, "scalar value");
  }
}

/**
 * The smallest sample of a row.
 *
 * @param samples - The row.
 * @returns The minimum, or `0` for an empty row.
 */
export function rowMin(samples: Float32Array): number {
  let min = Number.POSITIVE_INFINITY;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    if (sample < min) {
      min = sample;
    }
  }
  return min === Number.POSITIVE_INFINITY ? 0 : min;
}

/**
 * The largest sample of a row.
 *
 * @param samples - The row.
 * @returns The maximum, or `0` for an empty row.
 */
export function rowMax(samples: Float32Array): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    if (sample > max) {
      max = sample;
    }
  }
  return max === Number.NEGATIVE_INFINITY ? 0 : max;
}

/**
 * Resolves a scalar at spawn: the constant, a pick inside the range by `unit`, or the curve sampled
 * at `t` (the normalized position in the emission cycle).
 *
 * @param value - The scalar.
 * @param unit - A uniform random number in `[0, 1)`.
 * @param t - The normalized cycle time, for a curve.
 * @returns The resolved number.
 *
 * @public
 */
export function resolveScalar(value: ScalarValue, unit: number, t: number): number {
  switch (value.kind) {
    case "constant":
      return value.value;
    case "random":
      return value.min + (value.max - value.min) * unit;
    case "curve":
      return sampleRow(value.samples, t);
    default:
      return assertNever(value, "scalar value");
  }
}

/**
 * Whether a scalar is a constant `1`, so a module can skip it entirely.
 *
 * @param value - The scalar.
 * @returns `true` for a constant equal to one.
 *
 * @public
 */
export function isUnitScalar(value: ScalarValue): boolean {
  return value.kind === "constant" && value.value === 1;
}

/**
 * The colour a random or constant start colour resolves to for one particle, in sRGB, without
 * allocating. A gradient start colour samples at `t`.
 *
 * @param value - The colour value.
 * @param unit - A uniform random number in `[0, 1)`; picks between `min` and `max`.
 * @param t - The normalized cycle time, for a gradient.
 * @param out - Receives `r, g, b, a`.
 * @returns `out`.
 *
 * @public
 */
export function resolveColor(value: ColorValue, unit: number, t: number, out: Float32Array): Float32Array {
  switch (value.kind) {
    case "constant":
      return writeColor(value.value, out);
    case "random":
      out[0] = value.min.r + (value.max.r - value.min.r) * unit;
      out[1] = value.min.g + (value.max.g - value.min.g) * unit;
      out[2] = value.min.b + (value.max.b - value.min.b) * unit;
      out[3] = value.min.a + (value.max.a - value.min.a) * unit;
      return out;
    case "gradient":
      return evaluateGradient(value.stops, t, out);
    default:
      return assertNever(value, "colour value");
  }
}

/**
 * Copies a colour into four floats.
 *
 * @param color - The colour.
 * @param out - Receives it.
 * @returns `out`.
 */
function writeColor(color: ColorLike, out: Float32Array): Float32Array {
  out[0] = color.r;
  out[1] = color.g;
  out[2] = color.b;
  out[3] = color.a;
  return out;
}

/**
 * Decodes an sRGB channel to linear — the exact formula the generated WGSL uses, so the CPU
 * evaluator and the shader agree (`Color.srgbToLinear` in core is the same function; it is
 * restated here so the two hosts can be read side by side).
 *
 * @param value - The sRGB channel in `0`–`1`.
 * @returns The linear channel.
 *
 * @public
 */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
