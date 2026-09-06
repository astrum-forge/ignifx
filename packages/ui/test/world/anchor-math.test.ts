import { describe, expect, it } from "vitest";
import { computeAnchorPlacement, createAnchorPlacement } from "../../src/world/anchor-math.js";
import type { UiPixelMapping } from "../../src/dom/scaling.js";
import type { AnchorInput } from "../../src/world/anchor-math.js";

/**
 * `WorldAnchor` placement (`docs/architecture/13-ui.md` §2). Pure arithmetic driven by a fake
 * camera, exactly as the brief asks; the Chromium suite then proves the same numbers land on the
 * same pixels.
 */

/** A one-to-one render-target-pixel to UI-unit mapping. */
const IDENTITY: UiPixelMapping = { scaleX: 1, originX: 0, scaleY: 1, originY: 0 };

/**
 * Builds an input with sensible defaults.
 *
 * @param overrides - The fields to change.
 * @returns The input.
 */
function input(overrides: Partial<AnchorInput> = {}): AnchorInput {
  return {
    screenX: 400,
    screenY: 300,
    inFront: true,
    distance: 10,
    viewWidth: 800,
    viewHeight: 600,
    mapping: IDENTITY,
    hideWhenBehindCamera: true,
    clampToScreen: false,
    scaleWithDistance: false,
    referenceDistance: 10,
    minScale: 0.25,
    maxScale: 2,
    ...overrides,
  };
}

describe("in front of the camera", () => {
  it("converts a projected pixel into a UI unit", () => {
    const out = computeAnchorPlacement(input(), createAnchorPlacement());
    expect(out).toEqual({ visible: true, x: 400, y: 300, scale: 1 });
  });

  it("applies the layout's scale and letterbox offset", () => {
    const out = computeAnchorPlacement(
      input({ mapping: { scaleX: 0.5, originX: 50, scaleY: 0.5, originY: 0 } }),
      createAnchorPlacement(),
    );
    expect(out.x).toBe(150);
    expect(out.y).toBe(150);
  });

  it("hides a point that is off the edge when it does not clamp", () => {
    expect(computeAnchorPlacement(input({ screenX: -20 }), createAnchorPlacement()).visible).toBe(false);
    expect(computeAnchorPlacement(input({ screenY: 900 }), createAnchorPlacement()).visible).toBe(false);
  });

  it("clamps an off-edge point to the border and keeps it visible", () => {
    const out = computeAnchorPlacement(input({ screenX: -20, clampToScreen: true }), createAnchorPlacement());
    expect(out).toEqual({ visible: true, x: 0, y: 300, scale: 1 });
    const right = computeAnchorPlacement(input({ screenX: 5000, clampToScreen: true }), createAnchorPlacement());
    expect(right.x).toBe(800);
  });
});

describe("behind the camera", () => {
  it("hides the element when hideWhenBehindCamera is set", () => {
    const out = computeAnchorPlacement(input({ inFront: false }), createAnchorPlacement());
    expect(out.visible).toBe(false);
  });

  it("hides it even without that flag when it does not clamp, because the projection is mirrored", () => {
    const out = computeAnchorPlacement(input({ inFront: false, hideWhenBehindCamera: false }), createAnchorPlacement());
    expect(out.visible).toBe(false);
  });

  it("reflects about the viewport centre before clamping, so a marker goes to the right edge", () => {
    const out = computeAnchorPlacement(
      input({ inFront: false, hideWhenBehindCamera: false, clampToScreen: true, screenX: 900, screenY: 300 }),
      createAnchorPlacement(),
    );
    expect(out.visible).toBe(true);
    expect(out.x).toBe(0);
    expect(out.y).toBe(300);
  });
});

describe("distance scaling", () => {
  it("is 1 at the reference distance", () => {
    const out = computeAnchorPlacement(input({ scaleWithDistance: true }), createAnchorPlacement());
    expect(out.scale).toBe(1);
  });

  it("shrinks further away and grows closer, within the clamps", () => {
    expect(
      computeAnchorPlacement(input({ scaleWithDistance: true, distance: 20 }), createAnchorPlacement()).scale,
    ).toBe(0.5);
    expect(computeAnchorPlacement(input({ scaleWithDistance: true, distance: 5 }), createAnchorPlacement()).scale).toBe(
      2,
    );
  });

  it("clamps to minScale and maxScale", () => {
    expect(
      computeAnchorPlacement(input({ scaleWithDistance: true, distance: 1000 }), createAnchorPlacement()).scale,
    ).toBe(0.25);
    expect(computeAnchorPlacement(input({ scaleWithDistance: true, distance: 0 }), createAnchorPlacement()).scale).toBe(
      2,
    );
  });
});
