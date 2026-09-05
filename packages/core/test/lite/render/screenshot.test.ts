import { describe, expect, it } from "vitest";
import {
  createPixelRgba,
  pixelLuminance,
  pixelsDiffer,
  samplePixel,
  type CapturedFrame,
} from "../../../src/lite/screenshot.js";

/**
 * The pure readers over a captured frame. They are the assertion vocabulary every pixel proof in the
 * browser tests uses, so they are checked here where a frame can be fabricated exactly.
 */

/** Builds a frame whose pixel at `(x, y)` is `(x, y, x + y, 255)`. */
function gradientFrame(width: number, height: number): CapturedFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = x;
      data[offset + 1] = y;
      data[offset + 2] = x + y;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("sampling a captured frame", () => {
  it("reads row-major with the top row first", () => {
    const frame = gradientFrame(4, 3);
    const pixel = createPixelRgba();

    expect(samplePixel(frame, 0, 0, pixel)).toBe(pixel);
    expect(pixel).toEqual({ r: 0, g: 0, b: 0, a: 255 });

    samplePixel(frame, 3, 2, pixel);
    expect(pixel).toEqual({ r: 3, g: 2, b: 5, a: 255 });
  });

  it("returns null outside the frame", () => {
    const frame = gradientFrame(2, 2);
    const pixel = createPixelRgba();
    expect(samplePixel(frame, -1, 0, pixel)).toBeNull();
    expect(samplePixel(frame, 0, -1, pixel)).toBeNull();
    expect(samplePixel(frame, 2, 0, pixel)).toBeNull();
    expect(samplePixel(frame, 0, 2, pixel)).toBeNull();
  });

  it("returns null for a fractional coordinate rather than reading a neighbour", () => {
    const frame = gradientFrame(2, 2);
    expect(samplePixel(frame, 0.5, 0, createPixelRgba())).toBeNull();
  });

  it("writes into the caller's pixel, so a sampling loop allocates nothing", () => {
    const frame = gradientFrame(2, 2);
    const pixel = createPixelRgba();
    samplePixel(frame, 0, 0, pixel);
    samplePixel(frame, 1, 1, pixel);
    expect(pixel.r).toBe(1);
  });
});

describe("comparing pixels", () => {
  it("weighs green most heavily", () => {
    expect(pixelLuminance({ r: 255, g: 0, b: 0, a: 255 })).toBeCloseTo(54.213, 3);
    expect(pixelLuminance({ r: 0, g: 255, b: 0, a: 255 })).toBeCloseTo(182.376, 3);
    expect(pixelLuminance({ r: 255, g: 255, b: 255, a: 255 })).toBeCloseTo(255, 3);
  });

  it("treats a difference inside the tolerance as equal", () => {
    const a = { r: 100, g: 100, b: 100, a: 255 };
    expect(pixelsDiffer(a, { r: 102, g: 100, b: 100, a: 255 }, 2)).toBe(false);
    expect(pixelsDiffer(a, { r: 103, g: 100, b: 100, a: 255 }, 2)).toBe(true);
    expect(pixelsDiffer(a, { r: 100, g: 100, b: 100, a: 250 }, 2)).toBe(true);
  });
});
