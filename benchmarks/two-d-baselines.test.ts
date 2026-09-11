import { describe, expect, it } from "vitest";
import baselines from "./baselines.json" with { type: "json" };

/**
 * Check recorded 2D sync and pixel-perfect results against their budgets.
 * The S6.1 and S6.3 suites collect the measurements; this file does not rerun them.
 * Idle sprites must have zero sync writes, and nearest-sampled pixel art must have no blended pixels.
 */

/** The per-frame CPU budget the 2D engine has, in milliseconds (coding standards §7). */
const FRAME_BUDGET_MS = 2;

/** The environments S6.1 measured. */
const ENVIRONMENTS = ["browser", "node"] as const;

describe("the recorded 2D baselines (S6.1)", () => {
  it.each(ENVIRONMENTS)("keeps %s sprite sync at scale inside the 2 ms frame budget", (environment) => {
    const sample = baselines.twoD.spriteSyncAtScale[environment];

    expect(sample.loadedMedianMs).toBeGreaterThan(0);
    expect(
      sample.loadedMedianMs,
      `${environment}: ${String(baselines.twoD.spriteSyncAtScale.movers)} movers and ` +
        `${String(baselines.twoD.spriteSyncAtScale.tiles)} tiles cost ${String(sample.loadedMedianMs)} ms ` +
        `per frame at the median, and the budget is ${String(FRAME_BUDGET_MS)} ms.`,
    ).toBeLessThan(FRAME_BUDGET_MS);
  });

  it.each(ENVIRONMENTS)("writes no sprite in %s while nothing moves", (environment) => {
    expect(baselines.twoD.spriteSyncAtScale[environment].syncedWhileIdle).toBe(0);
  });

  it("records a scale worth calling 'at scale'", () => {
    expect(baselines.twoD.spriteSyncAtScale.movers).toBeGreaterThanOrEqual(1000);
    expect(baselines.twoD.spriteSyncAtScale.tiles).toBeGreaterThanOrEqual(10_000);
    // The browser run culls the tilemap to what the camera can see; the headless one has no
    // surface to cull against, which is why it carries every tile and is the harder measurement.
    expect(baselines.twoD.spriteSyncAtScale.browser.chunkedTileSprites).toBeLessThan(
      baselines.twoD.spriteSyncAtScale.node.chunkedTileSprites,
    );
  });
});

describe("the recorded pixel-perfect baselines (S6.3)", () => {
  it("blends no pixel at any device pixel ratio", () => {
    const { blendedPixelsAtDpr1, blendedPixelsAtDpr1_5, blendedPixelsAtDpr2 } = baselines.twoD.pixelPerfect;

    expect([blendedPixelsAtDpr1, blendedPixelsAtDpr1_5, blendedPixelsAtDpr2]).toEqual([0, 0, 0]);
  });

  it("keeps the counter-example that makes the zero meaningful", () => {
    expect(baselines.twoD.pixelPerfect.counterExampleBlendedPixels).toBeGreaterThan(0);
  });
});
