/**
 * The colour grade, baked into the 3D lookup table `lut.post.wgsl` samples.
 *
 * @remarks
 * A 16 x 16 x 16 cube stored the way every colourist's tool stores one: sixteen 16 x 16 slices laid
 * side by side into a 256 x 16 strip, one slice per blue level. The shader blends between the two
 * nearest slices by hand and lets the sampler's own bilinear filter cover red and green.
 *
 * Baking it here rather than shipping a PNG is the point of the example: `TextureAsset.fromPixels`
 * takes tightly packed RGBA8 bytes and publishes them as an ordinary texture asset, so a table a
 * tool exported and a table a function computed reach the shader by the same route. The bytes are
 * **not retained** — they are copied into the GPU texture at creation — so this array is free to be
 * collected as soon as the call returns.
 *
 * ## What the grade does
 *
 * A teal-and-orange trade: shadows pulled towards teal, highlights pushed towards amber, a gentle
 * S-curve for contrast and a little extra saturation. It is deliberately visible rather than
 * tasteful, because an invisible grade proves nothing.
 *
 * ## The one caveat, stated honestly
 *
 * A custom effect runs on the chain's **linear** colour, before the image-processing pass that tone
 * maps and encodes the frame — `imageProcessing` is always last (`docs/architecture/07-rendering.md`
 * §2.7). A film LUT is normally authored against the *display* signal, so applying one here is not
 * colour-managed grading; it is a lookup table demonstrated end to end. The values below were chosen
 * to look right in this position.
 */

/** The cube's edge, in entries. Sixteen is the size nearly every exported `.cube` file uses. */
export const LUT_SIZE = 16;

/** The strip's width in texels: one 16-wide slice per blue level. */
export const LUT_WIDTH = LUT_SIZE * LUT_SIZE;

/**
 * Builds the strip's RGBA8 bytes, row-major, top row first, straight alpha.
 *
 * @returns `LUT_WIDTH * LUT_SIZE * 4` bytes, ready for `TextureAsset.fromPixels`.
 */
export function bakeLutStrip(): Uint8Array {
  const data = new Uint8Array(LUT_WIDTH * LUT_SIZE * 4);
  const last = LUT_SIZE - 1;
  for (let blue = 0; blue < LUT_SIZE; blue += 1) {
    for (let green = 0; green < LUT_SIZE; green += 1) {
      for (let red = 0; red < LUT_SIZE; red += 1) {
        const offset = (green * LUT_WIDTH + blue * LUT_SIZE + red) * 4;
        const graded = grade(red / last, green / last, blue / last);
        data[offset] = toByte(graded[0]);
        data[offset + 1] = toByte(graded[1]);
        data[offset + 2] = toByte(graded[2]);
        data[offset + 3] = 255;
      }
    }
  }
  return data;
}

/**
 * Grades one entry of the cube.
 *
 * @param r - Red, 0 to 1.
 * @param g - Green, 0 to 1.
 * @param b - Blue, 0 to 1.
 * @returns The graded triple, each 0 to 1.
 */
function grade(r: number, g: number, b: number): readonly [number, number, number] {
  const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
  // An S-curve about the mid-point: `smoothstep` is the cheapest one that keeps 0 at 0 and 1 at 1.
  const contrast = (value: number): number => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t) * 0.72 + t * 0.28;
  };
  // Split-tone: how far this entry is towards the shadows, and how far towards the highlights.
  const shadow = clamp01(1 - luminance * 1.8);
  const highlight = clamp01((luminance - 0.45) * 1.9);
  const shifted: readonly [number, number, number] = [
    contrast(r) - shadow * 0.03 + highlight * 0.11,
    contrast(g) + shadow * 0.01 + highlight * 0.05,
    contrast(b) + shadow * 0.06 - highlight * 0.07,
  ];
  const mean = (shifted[0] + shifted[1] + shifted[2]) / 3;
  return [
    clamp01(mean + (shifted[0] - mean) * 1.18),
    clamp01(mean + (shifted[1] - mean) * 1.18),
    clamp01(mean + (shifted[2] - mean) * 1.18),
  ];
}

/**
 * Clamps a value into `0..1`.
 *
 * @param value - The value.
 * @returns The clamped value.
 */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a `0..1` component to a byte.
 *
 * @param value - The component.
 * @returns The byte.
 */
function toByte(value: number): number {
  return Math.round(clamp01(value) * 255);
}
