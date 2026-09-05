import type { Screenshot } from "@babylonjs/lite";

/**
 * Screenshot half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §5): the pure
 * readers over a captured frame. Taking the capture needs a running render loop, so
 * `captureFrame` lives in `./gpu/screenshot-capture.ts`.
 *
 * Everything here is `@internal`.
 *
 * ## What a Lite screenshot is (verified against `@babylonjs/lite@1.27.0` `index.d.ts` 10146)
 *
 * `data` is tightly packed RGBA8, four bytes per pixel, row-major with the **top** row first — the
 * layout `ImageData` wants. Alpha is forced to 255 because the swapchain is presented opaque, and
 * the values are the final presented 8-bit colours (BGRA is swizzled to RGBA for canvases whose
 * preferred format is BGRA), so a test comparing two captures compares what the user saw.
 */

/** Bytes per pixel in a screenshot's RGBA8 buffer. */
const BYTES_PER_PIXEL = 4;

/**
 * A captured frame, re-exported under an ignifx name so feature code can name the type without
 * importing `@babylonjs/lite` (coding standards §4).
 *
 * @internal
 */
export type CapturedFrame = Screenshot;

/**
 * One pixel's colour, as the 0–255 integers a screenshot stores.
 *
 * @internal
 */
export interface PixelRgba {
  /** Red, 0 to 255. */
  r: number;
  /** Green, 0 to 255. */
  g: number;
  /** Blue, 0 to 255. */
  b: number;
  /** Alpha, 0 to 255. Always 255 in a swapchain capture. */
  a: number;
}

/**
 * Creates a reusable pixel sink.
 *
 * @returns A fresh, opaque black pixel. **Allocates.**
 *
 * @internal
 */
export function createPixelRgba(): PixelRgba {
  return { r: 0, g: 0, b: 0, a: 255 };
}

/**
 * Reads one pixel out of a captured frame.
 *
 * @remarks
 * `x` and `y` are in capture pixels with the origin at the **top** left, the same convention as
 * `PixelViewport` and {@link screenToRay}'s input. This is the reader every visual assertion in the
 * browser tests goes through, which is why it lives here rather than in the GPU file: it is pure,
 * and it is checked by Node tests.
 *
 * @param frame - The captured frame.
 * @param x - The pixel column.
 * @param y - The pixel row.
 * @param out - Receives the colour.
 * @returns `out` when the coordinate is inside the frame, or `null` when it is not.
 *
 * @example
 * ```ts
 * const pixel = createPixelRgba();
 * samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel);
 * ```
 *
 * @internal
 */
export function samplePixel(frame: CapturedFrame, x: number, y: number, out: PixelRgba): PixelRgba | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
    return null;
  }
  const offset = (y * frame.width + x) * BYTES_PER_PIXEL;
  const data = frame.data;
  out.r = channel(data, offset);
  out.g = channel(data, offset + 1);
  out.b = channel(data, offset + 2);
  out.a = channel(data, offset + 3);
  return out;
}

/**
 * The perceptual luminance of a pixel, on the same 0–255 scale as its components.
 *
 * @remarks
 * Uses the Rec. 709 luma weights on the stored (already sRGB-encoded) values. The visual tests
 * compare luminance rather than absolute colours because a software adapter's rounding differs
 * from a hardware one's (`docs/standards/coding-standards.md` §10).
 *
 * @param pixel - The pixel to weigh.
 * @returns The luminance, 0 to 255.
 *
 * @internal
 */
export function pixelLuminance(pixel: PixelRgba): number {
  return 0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b;
}

/**
 * Reports whether two pixels differ by more than a per-channel tolerance.
 *
 * @param a - The first pixel.
 * @param b - The second pixel.
 * @param tolerance - The largest per-channel difference still counted as equal, 0 to 255.
 * @returns `true` when any channel differs by more than `tolerance`.
 *
 * @internal
 */
export function pixelsDiffer(a: PixelRgba, b: PixelRgba, tolerance: number): boolean {
  return (
    Math.abs(a.r - b.r) > tolerance ||
    Math.abs(a.g - b.g) > tolerance ||
    Math.abs(a.b - b.b) > tolerance ||
    Math.abs(a.a - b.a) > tolerance
  );
}

/**
 * Reads one byte of a capture buffer.
 *
 * @remarks
 * `noUncheckedIndexedAccess` widens the read to `number | undefined`; {@link samplePixel} has
 * already bounds-checked the coordinate, so the fallback is unreachable and exists once here rather
 * than four times per sample.
 *
 * @param data - The RGBA8 buffer.
 * @param index - The byte offset.
 * @returns The byte.
 */
function channel(data: Uint8ClampedArray, index: number): number {
  return data[index] ?? 0;
}
