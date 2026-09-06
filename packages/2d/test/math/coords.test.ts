import { Vec2 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIXELS_PER_UNIT,
  pivotedPositionToRef,
  pixelsToWorldToRef,
  sizeForZoom,
  snapPixel,
  snapZoomToInteger,
  spriteRotationFromLite,
  spriteRotationToLite,
  viewRotationToLite,
  worldToPixelsToRef,
  zoomForSize,
} from "../../src/math/coords.js";

/**
 * The one conversion every other module in `@ignifx/2d` goes through
 * (`docs/architecture/11-2d-toolkit.md` §1 and §3, ADR-0011). If the sign of the Y flip or of a
 * rotation is wrong here, every sprite in the engine is wrong in the same way — which is exactly
 * why it lives in one file with one suite.
 */

describe("world and pixel space", () => {
  it("flips Y and scales by the pixels-per-unit", () => {
    const out = worldToPixelsToRef(1.5, 0.5, 100, new Vec2());
    expect(out.x).toBe(150);
    expect(out.y).toBe(-50);
  });

  it("round trips through the inverse", () => {
    const pixels = worldToPixelsToRef(-2.25, 3.75, 16, new Vec2());
    const world = pixelsToWorldToRef(pixels.x, pixels.y, 16, new Vec2());
    expect(world.x).toBeCloseTo(-2.25, 10);
    expect(world.y).toBeCloseTo(3.75, 10);
  });

  it("defaults to 100 pixels per metre", () => {
    expect(DEFAULT_PIXELS_PER_UNIT).toBe(100);
  });

  it("writes into a caller-owned vector rather than allocating", () => {
    const out = new Vec2();
    expect(worldToPixelsToRef(1, 1, 100, out)).toBe(out);
    expect(pixelsToWorldToRef(1, 1, 100, out)).toBe(out);
  });
});

describe("rotation signs", () => {
  // The asymmetry is real and is the single easiest thing to get backwards. A sprite's quad is
  // built in Lite's +Y-down pixel space, so an ignifx counter-clockwise turn is the negated angle
  // there. A view transform is applied to offsets that have *already* been flipped, and the two
  // flips cancel, so the sign survives.
  it("negates a sprite rotation and converts it to radians", () => {
    expect(spriteRotationToLite(90)).toBeCloseTo(-Math.PI / 2, 12);
    expect(spriteRotationToLite(-45)).toBeCloseTo(Math.PI / 4, 12);
    expect(spriteRotationToLite(0)).toBe(-0);
  });

  it("keeps the sign of a view rotation", () => {
    expect(viewRotationToLite(90)).toBeCloseTo(Math.PI / 2, 12);
    expect(viewRotationToLite(-45)).toBeCloseTo(-Math.PI / 4, 12);
  });

  it("inverts a sprite rotation", () => {
    expect(spriteRotationFromLite(spriteRotationToLite(33))).toBeCloseTo(33, 10);
  });
});

describe("zoom", () => {
  it("fits the orthographic half-height into the viewport", () => {
    // 360 px tall, 1.8 m half-height, 100 px per metre: the viewport is exactly 3.6 m tall.
    expect(zoomForSize(360, 1.8, 100)).toBeCloseTo(1, 12);
    expect(zoomForSize(720, 1.8, 100)).toBeCloseTo(2, 12);
  });

  it("round trips through sizeForZoom", () => {
    const zoom = zoomForSize(1080, 4.5, 32);
    expect(sizeForZoom(1080, zoom, 32)).toBeCloseTo(4.5, 10);
  });

  it("refuses to divide by zero", () => {
    expect(zoomForSize(360, 0, 100)).toBe(1);
    expect(zoomForSize(360, -1, 100)).toBe(1);
    expect(sizeForZoom(360, 0, 100)).toBe(0);
    expect(sizeForZoom(360, 1, 0)).toBe(0);
  });
});

describe("pixel-perfect snapping", () => {
  it("snaps a zoom at or above 1 down to a whole number", () => {
    expect(snapZoomToInteger(2.7)).toBe(2);
    expect(snapZoomToInteger(1)).toBe(1);
    expect(snapZoomToInteger(1.99)).toBe(1);
  });

  it("snaps a zoom below 1 to the reciprocal of a whole number", () => {
    expect(snapZoomToInteger(0.3)).toBeCloseTo(1 / 3, 12);
    expect(snapZoomToInteger(0.5)).toBeCloseTo(0.5, 12);
  });

  it("never returns zero", () => {
    expect(snapZoomToInteger(0)).toBe(1);
    expect(snapZoomToInteger(-4)).toBe(1);
  });

  it("snaps a coordinate to the grid the zoom draws on", () => {
    expect(snapPixel(10.4, 1)).toBe(10);
    expect(snapPixel(10.6, 1)).toBe(11);
    // At zoom 2 one screen pixel is half a layer pixel, so the grid is finer.
    expect(snapPixel(10.26, 2)).toBeCloseTo(10.5, 10);
    expect(snapPixel(10.4, 0)).toBe(10.4);
  });
});

describe("pivots", () => {
  const CENTRE = { x: 0.5, y: 0.5 };

  it("leaves a centre-pivoted sprite where it is", () => {
    const out = pivotedPositionToRef(100, -50, CENTRE, 32, 32, 0, new Vec2());
    expect(out.x).toBe(100);
    expect(out.y).toBe(-50);
  });

  it("lifts a bottom-centre pivot by half the height", () => {
    // Pivot y=1 is the frame's BOTTOM edge in Lite's top-left-origin frame space, and layer pixels
    // run +Y down, so the drawn centre must sit half a height *above* the anchor: -16.
    const out = pivotedPositionToRef(0, 0, { x: 0.5, y: 1 }, 32, 40, 0, new Vec2());
    expect(out.x).toBe(0);
    expect(out.y).toBe(-20);
  });

  it("rotates the pivot offset with the sprite", () => {
    const out = pivotedPositionToRef(0, 0, { x: 0, y: 0.5 }, 40, 40, Math.PI / 2, new Vec2());
    // The unrotated offset is (+20, 0); a quarter turn in Lite's space sends it to (0, +20).
    expect(out.x).toBeCloseTo(0, 10);
    expect(out.y).toBeCloseTo(20, 10);
  });

  it("writes into a caller-owned vector", () => {
    const out = new Vec2();
    expect(pivotedPositionToRef(1, 2, CENTRE, 3, 4, 0, out)).toBe(out);
    expect(pivotedPositionToRef(5, 6, CENTRE, 3, 4, 1, out)).toBe(out);
  });
});
