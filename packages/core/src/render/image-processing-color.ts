import { assertNever } from "../errors/ignifx-error.js";
import type { ImageProcessingState, ToneMappingName } from "../lite/gpu/environment.js";

/**
 * Babylon Lite's PBR image processing, done once on the CPU for the clear colour
 * (`docs/architecture/07-rendering.md` §2.1).
 *
 * Every PBR fragment, fogged ones included, ends with the same steps
 * (`lib/material/pbr/pbr-template.js`, Lite 1.27.0): decode the fog colour with `pow(c, 2.2)`,
 * multiply by the exposure, apply the tone-mapping curve, encode with `pow(c, 1 / 2.2)`, clamp,
 * then apply contrast. The clear colour skips the shader, so without this a fully fogged floor and
 * the sky it should melt into land on different bytes.
 */

/**
 * A colour the CPU image-processing writes into.
 *
 * @internal
 */
export interface MutableRgba {
  /** The red channel. */
  r: number;
  /** The green channel. */
  g: number;
  /** The blue channel. */
  b: number;
  /** The alpha channel. */
  a: number;
}

/** Lite's gamma: a plain 2.2 power, not the piecewise sRGB curve. */
const GAMMA = 2.2;

/**
 * Whether image processing leaves an encoded colour unchanged.
 *
 * @param state - The image processing.
 * @returns `true` for exposure 1, contrast 1 and no curve, where decode and encode cancel out.
 *
 * @internal
 */
export function isIdentityImageProcessing(state: ImageProcessingState): boolean {
  return state.exposure === 1 && state.contrast === 1 && state.curve === "none";
}

/**
 * Whether two image-processing states are the same.
 *
 * @param left - One state.
 * @param right - The other.
 * @returns `true` when every field matches.
 *
 * @internal
 */
export function sameImageProcessing(left: ImageProcessingState, right: ImageProcessingState): boolean {
  return left.exposure === right.exposure && left.contrast === right.contrast && left.curve === right.curve;
}

/**
 * Applies Lite's PBR image processing to an sRGB colour, as a fully fogged fragment of that colour
 * would receive it.
 *
 * @param r - The sRGB red component, 0 to 1.
 * @param g - The sRGB green component, 0 to 1.
 * @param b - The sRGB blue component, 0 to 1.
 * @param a - The alpha, passed through.
 * @param state - The image processing to apply.
 * @param out - Receives the processed sRGB colour.
 * @returns `out`.
 *
 * @internal
 */
export function imageProcessedColor(
  r: number,
  g: number,
  b: number,
  a: number,
  state: ImageProcessingState,
  out: MutableRgba,
): MutableRgba {
  out.a = a;
  if (isIdentityImageProcessing(state)) {
    out.r = r;
    out.g = g;
    out.b = b;
    return out;
  }
  out.r = decode(r) * state.exposure;
  out.g = decode(g) * state.exposure;
  out.b = decode(b) * state.exposure;
  applyCurve(state.curve, out);
  out.r = finish(out.r, state.contrast);
  out.g = finish(out.g, state.contrast);
  out.b = finish(out.b, state.contrast);
  return out;
}

/**
 * Lite's fog-colour decode.
 *
 * @param value - The encoded channel.
 * @returns The linear channel.
 */
function decode(value: number): number {
  return Math.max(value, 0) ** GAMMA;
}

/**
 * Encodes, clamps and applies contrast, the steps every PBR fragment ends with.
 *
 * @param value - The tone-mapped linear channel.
 * @param contrast - The contrast multiplier.
 * @returns The presented channel, 0 to 1.
 */
function finish(value: number, contrast: number): number {
  const encoded = Math.min(Math.max(Math.max(value, 0) ** (1 / GAMMA), 0), 1);
  const high = encoded * encoded * (3 - 2 * encoded);
  const contrasted = contrast < 1 ? 0.5 + (encoded - 0.5) * contrast : encoded + (high - encoded) * (contrast - 1);
  return Math.max(contrasted, 0);
}

/**
 * Applies a tone-mapping curve in place, to an already exposed linear colour.
 *
 * @param curve - The curve.
 * @param color - The colour; overwritten.
 */
function applyCurve(curve: ToneMappingName, color: MutableRgba): void {
  switch (curve) {
    case "none": {
      return;
    }
    case "standard": {
      color.r = standard(color.r);
      color.g = standard(color.g);
      color.b = standard(color.b);
      return;
    }
    case "aces": {
      aces(color);
      return;
    }
    case "neutral": {
      neutral(color);
      return;
    }
    default: {
      assertNever(curve, "tone mapping");
    }
  }
}

/**
 * Lite's `StandardToneMapping` (`lib/material/pbr/tone-mapping.js`).
 *
 * @param value - The exposed channel.
 * @returns The tone-mapped channel.
 */
function standard(value: number): number {
  return 1 - 2 ** (-1.590579 * value);
}

/**
 * Lite's `AcesToneMapping`, the fitted RRT + ODT (`lib/material/pbr/pbr-aces-wgsl.js`).
 *
 * @param color - The exposed colour; overwritten.
 */
function aces(color: MutableRgba): void {
  // The WGSL matrices are built from columns, so each row here reads across them.
  const r = 0.59719 * color.r + 0.35458 * color.g + 0.04823 * color.b;
  const g = 0.076 * color.r + 0.90834 * color.g + 0.01566 * color.b;
  const b = 0.0284 * color.r + 0.13383 * color.g + 0.83777 * color.b;
  const fr = rrtAndOdtFit(r);
  const fg = rrtAndOdtFit(g);
  const fb = rrtAndOdtFit(b);
  color.r = saturate(1.60475 * fr - 0.53108 * fg - 0.07367 * fb);
  color.g = saturate(-0.10208 * fr + 1.10813 * fg - 0.00605 * fb);
  color.b = saturate(-0.00327 * fr - 0.07276 * fg + 1.07602 * fb);
}

/**
 * The rational fit inside ACES.
 *
 * @param value - One channel in the ACES working space.
 * @returns The fitted channel.
 */
function rrtAndOdtFit(value: number): number {
  const numerator = value * (value + 0.0245786) - 0.000090537;
  const denominator = value * (0.983729 * value + 0.432951) + 0.238081;
  return numerator / denominator;
}

/**
 * Lite's `NeutralToneMapping`, Khronos PBR Neutral (`lib/material/pbr/pbr-neutral-wgsl.js`).
 *
 * @param color - The exposed colour; overwritten.
 */
function neutral(color: MutableRgba): void {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  const lowest = Math.min(color.r, color.g, color.b);
  const offset = lowest < 0.08 ? lowest - 6.25 * lowest * lowest : 0.04;
  color.r -= offset;
  color.g -= offset;
  color.b -= offset;
  const peak = Math.max(color.r, color.g, color.b);
  if (peak < startCompression) {
    return;
  }
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const scale = newPeak / peak;
  const blend = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  color.r = color.r * scale + (newPeak - color.r * scale) * blend;
  color.g = color.g * scale + (newPeak - color.g * scale) * blend;
  color.b = color.b * scale + (newPeak - color.b * scale) * blend;
}

/**
 * Clamps to `[0, 1]`.
 *
 * @param value - The value.
 * @returns The clamped value.
 */
function saturate(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
