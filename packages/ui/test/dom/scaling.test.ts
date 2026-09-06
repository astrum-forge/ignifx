import { describe, expect, it } from "vitest";
import { computeUiLayout, layoutsEqual, pixelMapping, resolveReferenceResolution } from "../../src/dom/scaling.js";
import type { UiSurfaceMetrics } from "../../src/dom/scaling.js";

/**
 * The three scaling modes (`docs/architecture/13-ui.md` §1). Pure arithmetic, so the whole of it
 * runs under Node with no DOM.
 */

/**
 * Builds a metrics record.
 *
 * @param cssWidth - The canvas's CSS width.
 * @param cssHeight - The canvas's CSS height.
 * @param dpr - The device pixel ratio the backing store is sized at.
 * @returns The metrics.
 */
function metrics(cssWidth: number, cssHeight: number, dpr = 1): UiSurfaceMetrics {
  return { cssWidth, cssHeight, deviceWidth: cssWidth * dpr, deviceHeight: cssHeight * dpr };
}

describe('"css" scaling', () => {
  it("gives the root the canvas's CSS size and no transform", () => {
    const layout = computeUiLayout("css", metrics(800, 600, 2), [1920, 1080]);
    expect(layout).toEqual({ mode: "css", width: 800, height: 600, scale: 1, offsetX: 0, offsetY: 0 });
  });

  it("maps a render-target pixel to a CSS pixel through the device pixel ratio", () => {
    const measured = metrics(400, 300, 2);
    const map = pixelMapping(computeUiLayout("css", measured, [1920, 1080]), measured);
    expect(map.scaleX * 800 - map.originX).toBe(400);
    expect(map.scaleY * 600 - map.originY).toBe(300);
  });
});

describe('"fit" scaling', () => {
  it("scales the reference resolution up to fill a larger canvas", () => {
    const layout = computeUiLayout("fit", metrics(800, 600), [400, 300]);
    expect(layout.width).toBe(400);
    expect(layout.height).toBe(300);
    expect(layout.scale).toBe(2);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
  });

  it("letterboxes rather than stretching when the aspect ratios differ", () => {
    const layout = computeUiLayout("fit", metrics(1000, 600), [400, 300]);
    expect(layout.scale).toBe(2);
    expect(layout.offsetX).toBe(100);
    expect(layout.offsetY).toBe(0);
  });

  it("pillarboxes a canvas that is taller than the reference aspect", () => {
    const layout = computeUiLayout("fit", metrics(800, 800), [400, 300]);
    expect(layout.scale).toBe(2);
    expect(layout.offsetY).toBe(100);
  });

  it("subtracts the letterbox offset when converting a render-target pixel", () => {
    const measured = metrics(1000, 600);
    const layout = computeUiLayout("fit", measured, [400, 300]);
    const map = pixelMapping(layout, measured);
    // The canvas centre in render-target pixels is (500, 300); in UI units it is the middle of the
    // 400x300 reference box.
    expect(500 * map.scaleX - map.originX).toBeCloseTo(200, 10);
    expect(300 * map.scaleY - map.originY).toBeCloseTo(150, 10);
  });
});

describe('"dpi" scaling', () => {
  it("gives the root the backing-store size and scales it back down by the pixel ratio", () => {
    const layout = computeUiLayout("dpi", metrics(400, 300, 2), [1920, 1080]);
    expect(layout.width).toBe(800);
    expect(layout.height).toBe(600);
    expect(layout.scale).toBe(0.5);
  });

  it("makes one UI unit exactly one render-target pixel", () => {
    const measured = metrics(400, 300, 2);
    const map = pixelMapping(computeUiLayout("dpi", measured, [1920, 1080]), measured);
    expect(100 * map.scaleX - map.originX).toBe(100);
    expect(550 * map.scaleY - map.originY).toBe(550);
  });
});

describe("degenerate measurements", () => {
  it("treats a zero-sized canvas as one pixel rather than dividing by zero", () => {
    const layout = computeUiLayout("dpi", { cssWidth: 0, cssHeight: 0, deviceWidth: 0, deviceHeight: 0 }, [0, 0]);
    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(layout.width).toBe(1);
  });

  it("replaces an absent or non-finite reference resolution with one pixel", () => {
    expect(resolveReferenceResolution([])).toEqual({ width: 1, height: 1 });
    expect(resolveReferenceResolution([Number.NaN, -4])).toEqual({ width: 1, height: 1 });
  });
});

describe("layoutsEqual", () => {
  it("reports two identical layouts as equal so the host writes nothing", () => {
    const left = computeUiLayout("fit", metrics(800, 600), [400, 300]);
    const right = computeUiLayout("fit", metrics(800, 600), [400, 300]);
    expect(layoutsEqual(left, right)).toBe(true);
  });

  it("reports a mode change as a difference", () => {
    const left = computeUiLayout("css", metrics(800, 600), [400, 300]);
    const right = computeUiLayout("dpi", metrics(800, 600), [400, 300]);
    expect(layoutsEqual(left, right)).toBe(false);
  });
});
