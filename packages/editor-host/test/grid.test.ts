import { describe, expect, it } from "vitest";
import { groundGridPlacement, PIXEL_GRID_ZOOM, screenGridPlacement } from "../src/scene/grid.js";
import type { View2D } from "../src/scene/view-2d.js";

/** A 2D view at the origin, 800 × 600 backing pixels, 100 layer pixels per metre. */
const VIEW: View2D = { centerX: 3, centerY: -2, zoom: 1, pixelsPerUnit: 100, widthPx: 800, heightPx: 600 };

describe("the 3D view's ground grid", () => {
  it("centres under the eye and keeps the asked spacing near the ground", () => {
    const placement = groundGridPlacement({ x: 4, y: 6, z: -9 }, 1, 5000);
    expect(placement).toMatchObject({ plane: "ground", centerX: 4, centerY: -9, step: 1, majorEvery: 10 });
    // It reaches far enough to fade out before its edge: 100 lines at least.
    expect(placement.extent).toBeGreaterThanOrEqual(200);
  });

  it("steps up tenfold per decade of height, and stays inside the far plane", () => {
    expect(groundGridPlacement({ x: 0, y: 300, z: 0 }, 1, 5000).step).toBe(10);
    expect(groundGridPlacement({ x: 0, y: -3000, z: 0 }, 1, 5000).step).toBe(100);
    expect(groundGridPlacement({ x: 0, y: 3000, z: 0 }, 1, 5000).extent).toBeLessThanOrEqual(2 * 0.9 * 5000);
    expect(groundGridPlacement({ x: 0, y: 2, z: 0 }, 0.5, 5000).step).toBe(0.5);
  });

  it("measures the eye's height from a raised plane and carries the overlay flag", () => {
    const placement = groundGridPlacement({ x: 0, y: 302, z: 0 }, 1, 5000, 300, true);
    expect(placement).toMatchObject({ plane: "ground", height: 300, overlay: true, step: 1 });
    expect(groundGridPlacement({ x: 0, y: 0, z: 0 }, 1, 5000, 300).step).toBe(10);
    expect(groundGridPlacement({ x: 0, y: 6, z: 0 }, 1, 5000)).toMatchObject({ height: 0, overlay: false });
  });
});

describe("the 2D view's grid", () => {
  it("draws metre lines over the whole view at zoom 1", () => {
    const placement = screenGridPlacement(VIEW, 1);
    expect(placement).toMatchObject({ plane: "screen", centerX: 3, centerY: -2, step: 1, majorEvery: 10 });
    expect(placement.extent).toBeGreaterThanOrEqual(8);
  });

  it("thins lines that would be closer than a few pixels", () => {
    // 12.5 screen pixels a metre: 1 cm and 10 cm lines would be closer than 8 pixels.
    expect(screenGridPlacement({ ...VIEW, zoom: 0.125 }, 0.01).step).toBeCloseTo(1);
  });

  it("draws every layer pixel once zoomed in, with a major line every size", () => {
    const placement = screenGridPlacement({ ...VIEW, pixelsPerUnit: 16, zoom: PIXEL_GRID_ZOOM }, 1);
    expect(placement.step).toBeCloseTo(1 / 16);
    expect(placement.majorEvery).toBe(16);
  });
});
