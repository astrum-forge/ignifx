import { describe, expect, it } from "vitest";
import { ascentOf, computeHudPlacement, computePivotPlacement, HUD_ANCHORS } from "../../src/text/hud-layout.js";
import type { HudAnchor, HudPlacementInput } from "../../src/text/hud-layout.js";

/**
 * Where a shaped block goes on the screen (`docs/architecture/13-ui.md` §2). The numbers are the
 * ones the Chromium `HudText` pixel test then asserts on for real.
 */

/** A 100x40 block on an 800x600 target, at 32 px. */
function input(anchor: HudAnchor, offsetX = 0, offsetY = 0): HudPlacementInput {
  return {
    anchor,
    offsetX,
    offsetY,
    targetWidth: 800,
    targetHeight: 600,
    blockWidth: 100,
    blockHeight: 40,
    fontSize: 32,
  };
}

describe("computeHudPlacement", () => {
  it("puts a topLeft block's box top-left at the offset", () => {
    const out = computeHudPlacement(input("topLeft", 16, 16), { x: 0, y: 0 });
    expect(out.x).toBe(16);
    expect(out.y).toBe(16 + ascentOf(32));
  });

  it("pulls a topRight block back by its own width", () => {
    const out = computeHudPlacement(input("topRight", -16, 16), { x: 0, y: 0 });
    expect(out.x).toBe(800 - 16 - 100);
  });

  it("centres a centre-anchored block on both axes", () => {
    const out = computeHudPlacement(input("center"), { x: 0, y: 0 });
    expect(out.x).toBe(400 - 50);
    expect(out.y).toBe(300 - 20 + ascentOf(32));
  });

  it("lifts a bottom-anchored block clear of the bottom edge", () => {
    const out = computeHudPlacement(input("bottomLeft", 0, -8), { x: 0, y: 0 });
    expect(out.x).toBe(0);
    expect(out.y).toBe(600 - 8 - 40 + ascentOf(32));
  });

  it("keeps every anchor inside the target for a block that fits", () => {
    for (const anchor of HUD_ANCHORS) {
      const out = computeHudPlacement(input(anchor), { x: 0, y: 0 });
      expect(out.x, anchor).toBeGreaterThanOrEqual(0);
      expect(out.x, anchor).toBeLessThanOrEqual(800 - 100);
    }
  });

  it("writes into the caller's object rather than allocating", () => {
    const out = { x: -1, y: -1 };
    expect(computeHudPlacement(input("topLeft"), out)).toBe(out);
  });
});

describe("computePivotPlacement", () => {
  it("centres a block on the point by default", () => {
    const out = computePivotPlacement("center", 400, 300, 100, 40, 32, { x: 0, y: 0 });
    expect(out.x).toBe(350);
    expect(out.y).toBe(300 - 20 + ascentOf(32));
  });

  it("hangs a bottom-pivoted block above the point", () => {
    const out = computePivotPlacement("bottom", 400, 300, 100, 40, 32, { x: 0, y: 0 });
    expect(out.x).toBe(350);
    expect(out.y).toBe(300 - 40 + ascentOf(32));
  });

  it("puts a topLeft pivot's box corner on the point", () => {
    const out = computePivotPlacement("topLeft", 10, 20, 100, 40, 32, { x: 0, y: 0 });
    expect(out.x).toBe(10);
    expect(out.y).toBe(20 + ascentOf(32));
  });
});
