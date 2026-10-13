import { describe, expect, it } from "vitest";
import { imageProcessedColor, isIdentityImageProcessing } from "../../src/render/image-processing-color.js";
import type { ImageProcessingState } from "../../src/lite/gpu/environment.js";
import type { MutableRgba } from "../../src/render/image-processing-color.js";

/**
 * The clear colour's CPU image processing, against the steps Babylon Lite 1.27.0's PBR fragment
 * runs (`lib/material/pbr/pbr-template.js`, `pbr-aces-wgsl.js`, `pbr-neutral-wgsl.js`).
 */

/**
 * Processes a grey.
 *
 * @param value - The sRGB grey.
 * @param state - The image processing.
 * @returns The processed colour.
 */
function grey(value: number, state: ImageProcessingState): MutableRgba {
  return imageProcessedColor(value, value, value, 1, state, { r: 0, g: 0, b: 0, a: 0 });
}

describe("the clear colour's image processing", () => {
  it("leaves the colour exactly as authored with no exposure, contrast or curve", () => {
    const state: ImageProcessingState = { exposure: 1, contrast: 1, curve: "none" };
    expect(isIdentityImageProcessing(state)).toBe(true);
    expect(imageProcessedColor(0.5, 0.25, 1, 0.5, state, { r: 0, g: 0, b: 0, a: 0 })).toEqual({
      r: 0.5,
      g: 0.25,
      b: 1,
      a: 0.5,
    });
  });

  it("maps an sRGB 0.5 through ACES to about 0.408, byte 104", () => {
    const out = grey(0.5, { exposure: 1, contrast: 1, curve: "aces" });
    // Decoded 0.5 ** 2.2 = 0.2176, fitted 0.1389, encoded 0.1389 ** (1 / 2.2) = 0.4076.
    expect(out.r).toBeCloseTo(0.4076, 3);
    expect(Math.round(out.r * 255)).toBe(104);
    expect(out.g).toBeCloseTo(out.r, 4);
    expect(out.b).toBeCloseTo(out.r, 4);
  });

  it("applies the standard curve, 1 - 2^(-1.590579 x)", () => {
    const out = grey(0.5, { exposure: 1, contrast: 1, curve: "standard" });
    const linear = 0.5 ** 2.2;
    expect(out.r).toBeCloseTo((1 - 2 ** (-1.590579 * linear)) ** (1 / 2.2), 6);
  });

  it("only offsets a grey below the neutral curve's compression start", () => {
    const out = grey(0.5, { exposure: 1, contrast: 1, curve: "neutral" });
    expect(out.r).toBeCloseTo((0.5 ** 2.2 - 0.04) ** (1 / 2.2), 6);
  });

  it("compresses a bright colour with the neutral curve", () => {
    const out = grey(1, { exposure: 2, contrast: 1, curve: "neutral" });
    expect(out.r).toBeLessThan(1);
    expect(out.r).toBeGreaterThan(0.9);
  });

  it("scales the linear value by the exposure before encoding", () => {
    const out = grey(0.5, { exposure: 2, contrast: 1, curve: "none" });
    expect(out.r).toBeCloseTo(0.5 * 2 ** (1 / 2.2), 6);
  });

  it("pulls towards 0.5 below contrast 1 and towards the smoothstep above it", () => {
    const low = grey(0.25, { exposure: 1, contrast: 0.5, curve: "none" });
    expect(low.r).toBeCloseTo(0.375, 6);
    const high = grey(0.25, { exposure: 1, contrast: 2, curve: "none" });
    expect(high.r).toBeCloseTo(0.25 * 0.25 * (3 - 0.5), 6);
  });

  it("clamps a channel exposure pushes past white", () => {
    expect(grey(1, { exposure: 4, contrast: 1, curve: "none" }).r).toBe(1);
  });
});
