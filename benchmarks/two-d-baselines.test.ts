import { describe, expect, it } from "vitest";
import baselines from "./baselines.json" with { type: "json" };

/**
 * The Phase 6 performance gate, as a **data assertion** rather than a measurement.
 *
 * The numbers under `twoD` were measured by spike S6.1 in `@ignifx/2d`'s own browser and node
 * suites — 1,000 moving sprites over a 100x100 tilemap, with the render loop stopped so that the
 * sample is sprite-sync CPU time and nothing else. Re-running that here would double the cost of
 * `pnpm test` and would measure a different machine every time, so this file asserts the recorded
 * numbers instead: it is the thing that turns "we wrote it down" into "CI notices when someone
 * edits it down".
 *
 * Two claims are enforced, both from `docs/plan/engineering-plan.md`'s Phase 6 exit criteria and
 * `docs/standards/coding-standards.md` §7:
 *
 * - **Under budget.** The 2D engine gets 2 ms of CPU per frame. Both environments' medians are
 *   about eight times under it.
 * - **Nothing is written while nothing moves.** A sprite whose transform has not changed must not
 *   be re-uploaded, so `syncedWhileIdle` is exactly zero, not merely small.
 *
 * The pixel-perfect numbers from S6.3 are asserted the same way: at every device pixel ratio the
 * suite tried, a one-pixel checkerboard read back with **no** blended pixels, and the deliberate
 * counter-example (a linear-sampled atlas at a fractional zoom) blended every pixel it had — which
 * is what makes the zero meaningful rather than a tautology.
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
