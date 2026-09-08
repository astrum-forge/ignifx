/**
 * SVG serialisation for the press kit.
 *
 * Every document this module writes is the shape `05-press-kit.md` §6 requires: a `viewBox`, an
 * `xmlns`, `role="img"` and an `aria-label`, no `<style>` element, no script, no embedded font and
 * no editor metadata. Coordinates are rounded to two decimals, which at the kit's scale — a
 * hundredth of an em for the lockups, a pixel for the badges — is finer than any raster it feeds.
 */

/** How many decimals path and geometry coordinates keep. */
const COORDINATE_DECIMALS = 2;

/** How many decimals a `transform` keeps. A scale factor multiplies error, so it keeps more. */
const TRANSFORM_DECIMALS = 5;

/**
 * Formats a number for an SVG attribute: fixed decimals, trailing zeros dropped, no `-0`.
 *
 * @param value - The number.
 * @param decimals - How many decimals to keep.
 * @returns The formatted number.
 * @throws When the value is not finite, which always means a geometry bug upstream.
 */
export function num(value: number, decimals: number = COORDINATE_DECIMALS): string {
  if (!Number.isFinite(value)) {
    throw new Error(`refusing to write a non-finite coordinate (${String(value)})`);
  }
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Escapes text for an XML attribute value.
 *
 * @param value - The raw text.
 * @returns The escaped text.
 */
function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** A `translate`/`scale` transform, in the order SVG applies them: translate first, then scale. */
export interface Placement {
  /** Horizontal translation, in the parent's units. */
  readonly x: number;
  /** Vertical translation, in the parent's units. */
  readonly y: number;
  /** Uniform scale. */
  readonly scale: number;
}

/**
 * Renders a {@link Placement} as a `transform` attribute value.
 *
 * @param placement - The placement.
 * @returns The attribute value.
 */
export function transform(placement: Placement): string {
  const parts = [`translate(${num(placement.x, TRANSFORM_DECIMALS)} ${num(placement.y, TRANSFORM_DECIMALS)})`];
  if (placement.scale !== 1) {
    parts.push(`scale(${num(placement.scale, TRANSFORM_DECIMALS)})`);
  }
  return parts.join(" ");
}

/** One press SVG. */
export interface SvgDocument {
  /** The `viewBox` width, in user units. */
  readonly width: number;
  /** The `viewBox` height, in user units. */
  readonly height: number;
  /** What a screen reader announces. */
  readonly ariaLabel: string;
  /** The element markup inside `<svg>`. */
  readonly body: string;
  /**
   * An explicit `viewBox`, when the drawing's coordinate origin is not `0 0` — the silhouette is
   * drawn in the master's canvas coordinates and framed by shifting the box, not the path.
   */
  readonly viewBox?: string;
}

/** A size in pixels. */
export interface PixelSize {
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
}

/**
 * Serialises an SVG document.
 *
 * @param document - The document.
 * @param pixelSize - Intrinsic size for the `width`/`height` attributes. Defaults to the user-unit
 *   size; the rasteriser passes the target pixel size instead, so librsvg renders the vector at
 *   full resolution rather than resampling a smaller raster. Pass `null` to omit both attributes,
 *   which `05-press-kit.md` §3 asks for on `ignifx-mark.svg` so it scales to its container.
 * @returns The file contents, newline-terminated.
 */
export function renderSvg(document: SvgDocument, pixelSize?: PixelSize | null): string {
  const size = pixelSize === null ? null : (pixelSize ?? { width: document.width, height: document.height });
  const viewBox = document.viewBox ?? `0 0 ${num(document.width)} ${num(document.height)}`;
  // The mark is raster, so the colour files embed a PNG through `xlink:href` — the attribute the
  // designer's own wrapper uses, and the one every tool reads, new or old. The namespace is only
  // declared when something needs it, so the vector-only files stay minimal.
  const xlink = document.body.includes("xlink:") ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : "";
  const intrinsic =
    size === null
      ? ""
      : ` width="${num(size.width, TRANSFORM_DECIMALS)}" height="${num(size.height, TRANSFORM_DECIMALS)}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${xlink}${intrinsic}` +
    ` viewBox="${viewBox}"` +
    ` role="img" aria-label="${attribute(document.ariaLabel)}">` +
    document.body +
    "</svg>\n"
  );
}
