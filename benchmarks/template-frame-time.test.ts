import { describe, expect, it } from "vitest";
import baselines from "./baselines.json" with { type: "json" };

/**
 * The Phase 12 frame-budget gate, as a **data assertion** rather than a measurement.
 *
 * The numbers under `frameTime.templates` are measured by
 * `tests/visual/tests/frame-time.spec.ts`, which builds each template, opens it at `?bench=1` in
 * Chromium on SwiftShader at 1280 by 720, runs 300 frames after a 120-frame warm-up, and reads the
 * engine CPU milliseconds each of them cost out of `app.diagnostics`. That suite compares the live
 * median against `budgetMs`; this file is what makes sure `budgetMs` itself cannot quietly be
 * edited upwards past what `docs/standards/coding-standards.md` §7 allows.
 *
 * Two claims are enforced:
 *
 * - **Every ceiling is inside the standards' budget.** §7 gives a 2D game 2 ms of engine CPU per
 *   frame and a 3D game 4 ms. Each template's recorded ceiling has to be at or under its own
 *   `standardsBudgetMs`, and each `standardsBudgetMs` has to be the number §7 actually states.
 * - **Every recorded median is inside its ceiling**, which is what the live suite asserts and what
 *   the committed row therefore has to agree with.
 *
 * ## Why CPU time and not frames per second
 *
 * SwiftShader is a software rasteriser, so wall-clock frame rate there measures the rasteriser
 * rather than the engine. Per-phase CPU time is what §7's budget is about and what an engine change
 * moves. The SwiftShader factor recorded beside these rows was measured rather than assumed, and
 * the measurement is why it is `1`: run against the host GPU instead, the ratio of engine CPU came
 * out between 0.43 and 2.11 across the four templates, i.e. noise around one rather than a penalty.
 * `baselines.json` records the numbers.
 */

/** The per-frame engine CPU budget, in milliseconds, by template dimension (coding standards §7). */
const STANDARDS_BUDGET_MS = { "2d": 2, "3d": 4 } as const;

/** The templates, and which of the two budgets each falls under. */
const TEMPLATES = [
  ["2d-topdown", "2d"],
  ["2d-sidescroller", "2d"],
  ["3d-third-person", "3d"],
  ["3d-first-person", "3d"],
] as const;

describe("the recorded template frame budgets", () => {
  it.each(TEMPLATES)("records %s against the §7 budget for a %s game", (name, dimension) => {
    const row = baselines.frameTime.templates[name];
    expect(row.standardsBudgetMs).toBe(STANDARDS_BUDGET_MS[dimension]);
    expect(
      row.budgetMs,
      `${name}: the ceiling in baselines.json is ${String(row.budgetMs)} ms, and coding standards §7 ` +
        `allows a ${dimension} template ${String(STANDARDS_BUDGET_MS[dimension])} ms.`,
    ).toBeLessThanOrEqual(STANDARDS_BUDGET_MS[dimension]);
  });

  it.each(TEMPLATES)("keeps %s's recorded median inside its own ceiling", (name) => {
    const row = baselines.frameTime.templates[name];
    expect(row.medianMs).toBeGreaterThan(0);
    expect(
      row.medianMs,
      `${name}: the recorded median is ${String(row.medianMs)} ms and the ceiling is ` +
        `${String(row.budgetMs)} ms. Re-run tests/visual/tests/frame-time.spec.ts and re-record.`,
    ).toBeLessThanOrEqual(row.budgetMs);
  });

  it.each(TEMPLATES)("records when %s was measured", (name) => {
    expect(baselines.frameTime.templates[name].recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("keeps the SwiftShader factor and the sentence that justifies it", () => {
    // The factor is 1 because it was measured and came out as noise around one, not because nobody
    // looked. If a future run finds a real penalty, both the number and the note have to change.
    expect(baselines.frameTime.swiftShaderFactor).toBeGreaterThan(0);
    expect(baselines.frameTime.swiftShaderFactorNote.length).toBeGreaterThan(120);
  });
});
