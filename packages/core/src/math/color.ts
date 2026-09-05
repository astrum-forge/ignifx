import { clamp01, EPSILON, lerp } from "./math-utils.js";
import type { ColorLike } from "./types.js";

/**
 * Matches `#rrggbb`, `#rrggbbaa`, and the same two without the leading `#`.
 */
const HEX_PATTERN = /^#?(?:[\da-f]{6}|[\da-f]{8})$/iu;

/**
 * Formats a 0-255 channel as two lowercase hex digits.
 *
 * @param value - The channel value, already rounded into 0-255.
 * @returns Two hex digits.
 */
function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * An RGBA colour whose components are **linear** and normally in 0-1 (values above 1 are allowed
 * and mean HDR intensity). Lighting maths only works in linear space, which is why this is the
 * space ignifx stores; scene files and hex strings are sRGB, and
 * {@link Color.fromHex}/{@link Color.fromSrgb} are the doors between the two
 * (`docs/architecture/06-serialization-and-scene-format.md` section 3).
 *
 * Every method says which space it works in. The rule of thumb: if it takes or returns a hex string
 * or has `Srgb` in its name, it is sRGB; everything else is linear.
 *
 * @example
 * ```ts
 * const tint = Color.fromHex("#ff8800") ?? new Color(1, 1, 1, 1); // parsed as sRGB, stored linear
 * tint.scaleRgb(2);                                              // twice as bright, same alpha
 * tint.toHex();                                                  // back to sRGB: "#ffbe00"
 * ```
 *
 * @public
 */
export class Color {
  /** The linear red component. */
  r: number;
  /** The linear green component. */
  g: number;
  /** The linear blue component. */
  b: number;
  /** The alpha component in 0-1. Alpha is always linear, never gamma encoded. */
  a: number;

  /**
   * Creates a colour from linear components.
   *
   * @param r - The linear red component. Defaults to 0.
   * @param g - The linear green component. Defaults to 0.
   * @param b - The linear blue component. Defaults to 0.
   * @param a - The alpha component. Defaults to 1 (opaque).
   */
  constructor(r: number = 0, g: number = 0, b: number = 0, a: number = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  /**
   * Assigns every component at once, in linear space.
   *
   * @param r - The new linear red component.
   * @param g - The new linear green component.
   * @param b - The new linear blue component.
   * @param a - The new alpha component.
   * @returns This colour.
   */
  set(r: number, g: number, b: number, a: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  /**
   * Copies every component from another colour.
   *
   * @param c - The colour to read.
   * @returns This colour.
   */
  copyFrom(c: ColorLike): this {
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    this.a = c.a;
    return this;
  }

  /**
   * Copies this colour into a new one.
   *
   * @returns A new colour. **Allocates.**
   */
  clone(): Color {
    return new Color(this.r, this.g, this.b, this.a);
  }

  /**
   * Multiplies this colour by another, component by component including alpha — the usual way a
   * tint is applied.
   *
   * @param c - The colour to multiply by.
   * @returns This colour.
   */
  multiply(c: ColorLike): this {
    this.r *= c.r;
    this.g *= c.g;
    this.b *= c.b;
    this.a *= c.a;
    return this;
  }

  /**
   * Scales the linear RGB components, leaving alpha alone. This is what "brighter" means: alpha is
   * coverage, not colour.
   *
   * @param factor - The intensity factor.
   * @returns This colour.
   */
  scaleRgb(factor: number): this {
    this.r *= factor;
    this.g *= factor;
    this.b *= factor;
    return this;
  }

  /**
   * Moves this colour towards a target, in linear space (which is where blending belongs; lerping
   * sRGB values darkens midpoints).
   *
   * @param target - The colour reached at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @returns This colour.
   */
  lerp(target: ColorLike, t: number): this {
    return Color.lerpToRef(this, target, t, this);
  }

  /**
   * Compares this colour with another, component by component, with a tolerance.
   *
   * @param c - The colour to compare against.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  equalsWithEpsilon(c: ColorLike, epsilon: number = EPSILON): boolean {
    return Color.equalsWithEpsilon(this, c, epsilon);
  }

  /**
   * Writes the **linear** components into a `Float32Array`, the form a shader wants. The output
   * comes first to mirror Babylon Lite's `toArray` helpers.
   *
   * @param out - The array to write into.
   * @param offset - The index of the red component. Defaults to 0.
   * @returns `out`.
   */
  toArray(out: Float32Array, offset: number = 0): Float32Array {
    out[offset] = this.r;
    out[offset + 1] = this.g;
    out[offset + 2] = this.b;
    out[offset + 3] = this.a;
    return out;
  }

  /**
   * Writes this colour's **sRGB-encoded** components into `out`, for display, pickers and files.
   * Components are clamped into 0-1 by the encoding curve.
   *
   * @param out - The colour to write; may be this colour. Its fields hold sRGB values afterwards,
   * not linear ones.
   * @returns `out`.
   */
  toSrgbToRef<TOut extends Color>(out: TOut): TOut {
    return out.set(Color.linearToSrgb(this.r), Color.linearToSrgb(this.g), Color.linearToSrgb(this.b), this.a);
  }

  /**
   * Encodes this colour as an sRGB hex string.
   *
   * @returns `#rrggbb` for an opaque colour, `#rrggbbaa` when alpha is below 1. **Allocates a
   * string.**
   *
   * @example
   * ```ts
   * new Color(1, 1, 1, 1).toHex(); // "#ffffff"
   * ```
   */
  toHex(): string {
    const r = hexByte(Math.round(Color.linearToSrgb(this.r) * 255));
    const g = hexByte(Math.round(Color.linearToSrgb(this.g) * 255));
    const b = hexByte(Math.round(Color.linearToSrgb(this.b) * 255));
    const alpha = clamp01(this.a);
    if (alpha >= 1) {
      return `#${r}${g}${b}`;
    }
    return `#${r}${g}${b}${hexByte(Math.round(alpha * 255))}`;
  }

  /**
   * Opaque white.
   *
   * @returns A new linear `(1, 1, 1, 1)`. **Allocates.**
   */
  static white(): Color {
    return new Color(1, 1, 1, 1);
  }

  /**
   * Opaque black.
   *
   * @returns A new linear `(0, 0, 0, 1)`. **Allocates.**
   */
  static black(): Color {
    return new Color(0, 0, 0, 1);
  }

  /**
   * Fully transparent black.
   *
   * @returns A new linear `(0, 0, 0, 0)`. **Allocates.**
   */
  static transparent(): Color {
    return new Color(0, 0, 0, 0);
  }

  /**
   * Copies any colour-shaped value into a `Color`.
   *
   * @param c - The linear colour to copy.
   * @returns A new colour. **Allocates.**
   */
  static from(c: ColorLike): Color {
    return new Color(c.r, c.g, c.b, c.a);
  }

  /**
   * Converts one **sRGB** channel to linear, using the IEC 61966-2-1 curve Babylon Lite uses
   * (`lib/math/color.js`).
   *
   * @param channel - The sRGB channel value; clamped into 0-1.
   * @returns The linear value.
   */
  static srgbToLinear(channel: number): number {
    const c = clamp01(channel);
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /**
   * Converts one **linear** channel to sRGB, the inverse of {@link Color.srgbToLinear}.
   *
   * @param channel - The linear channel value; clamped into 0-1, so HDR intensity is lost.
   * @returns The sRGB value.
   */
  static linearToSrgb(channel: number): number {
    const c = clamp01(channel);
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  /**
   * Builds a colour from **sRGB** components, converting RGB to linear and taking alpha as-is.
   *
   * @param r - The sRGB red component, 0-1.
   * @param g - The sRGB green component, 0-1.
   * @param b - The sRGB blue component, 0-1.
   * @param a - The alpha component, 0-1. Defaults to 1.
   * @returns A new colour holding linear components. **Allocates.**
   */
  static fromSrgb(r: number, g: number, b: number, a: number = 1): Color {
    return Color.fromSrgbToRef(r, g, b, a, new Color());
  }

  /**
   * Writes a colour built from **sRGB** components into `out`.
   *
   * @param r - The sRGB red component, 0-1.
   * @param g - The sRGB green component, 0-1.
   * @param b - The sRGB blue component, 0-1.
   * @param a - The alpha component, 0-1.
   * @param out - The colour to write; holds linear components afterwards.
   * @returns `out`.
   */
  static fromSrgbToRef<TOut extends Color>(r: number, g: number, b: number, a: number, out: TOut): TOut {
    return out.set(Color.srgbToLinear(r), Color.srgbToLinear(g), Color.srgbToLinear(b), a);
  }

  /**
   * Parses an **sRGB** hex string into a linear colour.
   *
   * @param hex - `#rrggbb` or `#rrggbbaa`, with or without the leading `#`, in either case.
   * @returns A new colour, or `null` when the string is not a hex colour. Colours arrive from files
   * and user input, so a bad one is expected absence rather than API misuse (coding standards
   * section 5.5): the caller decides whether to substitute a default or raise a load error.
   * **Allocates.**
   *
   * @example
   * ```ts
   * const tint = Color.fromHex("#ff8800aa") ?? Color.white();
   * ```
   */
  static fromHex(hex: string): Color | null {
    const out = new Color();
    return Color.fromHexToRef(hex, out) ? out : null;
  }

  /**
   * Parses an **sRGB** hex string into `out` as linear components.
   *
   * @param hex - `#rrggbb` or `#rrggbbaa`, with or without the leading `#`, in either case.
   * @param out - The colour to write; left untouched when parsing fails.
   * @returns `true` when `hex` was a valid hex colour.
   */
  static fromHexToRef(hex: string, out: Color): boolean {
    if (!HEX_PATTERN.test(hex)) {
      return false;
    }
    const body = hex.startsWith("#") ? hex.slice(1) : hex;
    const r = Number.parseInt(body.slice(0, 2), 16) / 255;
    const g = Number.parseInt(body.slice(2, 4), 16) / 255;
    const b = Number.parseInt(body.slice(4, 6), 16) / 255;
    const a = body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1;
    Color.fromSrgbToRef(r, g, b, a, out);
    return true;
  }

  /**
   * Writes the component-wise product `a * b` into `out`, in linear space.
   *
   * @param a - The first colour.
   * @param b - The second colour.
   * @param out - The colour to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static multiplyToRef<TOut extends Color>(a: ColorLike, b: ColorLike, out: TOut): TOut {
    return out.set(a.r * b.r, a.g * b.g, a.b * b.b, a.a * b.a);
  }

  /**
   * Writes `c` with its RGB scaled and its alpha untouched into `out`.
   *
   * @param c - The colour to scale.
   * @param factor - The intensity factor.
   * @param out - The colour to write; may alias `c`.
   * @returns `out`.
   */
  static scaleRgbToRef<TOut extends Color>(c: ColorLike, factor: number, out: TOut): TOut {
    return out.set(c.r * factor, c.g * factor, c.b * factor, c.a);
  }

  /**
   * Writes the linear-space interpolation of `a` and `b` into `out`.
   *
   * @param a - The colour written at `t === 0`.
   * @param b - The colour written at `t === 1`.
   * @param t - The interpolant; not clamped.
   * @param out - The colour to write; may alias `a` or `b`.
   * @returns `out`.
   */
  static lerpToRef<TOut extends Color>(a: ColorLike, b: ColorLike, t: number, out: TOut): TOut {
    return out.set(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t), lerp(a.a, b.a, t));
  }

  /**
   * Compares two colours component by component, with a tolerance.
   *
   * @param a - The first colour.
   * @param b - The second colour.
   * @param epsilon - The largest per-component difference still considered equal.
   * @returns `true` when every component matches within `epsilon`.
   */
  static equalsWithEpsilon(a: ColorLike, b: ColorLike, epsilon: number = EPSILON): boolean {
    return (
      Math.abs(a.r - b.r) <= epsilon &&
      Math.abs(a.g - b.g) <= epsilon &&
      Math.abs(a.b - b.b) <= epsilon &&
      Math.abs(a.a - b.a) <= epsilon
    );
  }
}
