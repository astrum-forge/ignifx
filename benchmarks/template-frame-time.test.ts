import { describe, expect, it } from "vitest";
import baselines from "./baselines.json" with { type: "json" };

/**
 * Check recorded template medians and ceilings against the standards' engine CPU budgets.
 * The live browser measurements run in tests/visual/tests/frame-time.spec.ts.
 * CPU time excludes software rasterisation cost, which makes wall-clock FPS unsuitable here.
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

/** Coding standards §7: the `medium` tier's whole-frame GPU budget on its reference device, the M1. */
const MEDIUM_TIER_GPU_FRAME_MS = 12;

describe("the recorded template GPU budgets", () => {
  const GPU_TEMPLATES = ["3d-third-person", "3d-first-person"] as const;

  it.each(GPU_TEMPLATES)("keeps %s's GPU ceiling inside the §7 medium-tier frame", (name) => {
    const row = baselines.gpuTime.templates[name];
    expect(row.standardsBudgetMs).toBe(MEDIUM_TIER_GPU_FRAME_MS);
    expect(row.budgetMs).toBeLessThanOrEqual(MEDIUM_TIER_GPU_FRAME_MS);
    expect(row.medianMs).toBeGreaterThan(0);
    expect(
      row.medianMs,
      `${name}: the recorded GPU median is ${String(row.medianMs)} ms and the ceiling is ` +
        `${String(row.budgetMs)} ms. Re-run \`pnpm test:gpu-budget\` and re-record.`,
    ).toBeLessThanOrEqual(row.budgetMs);
    expect(row.recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
});

/** Coding standards §7: each quality tier's whole-frame GPU budget. */
const TIER_GPU_FRAME_MS = { low: 12, medium: 12, high: 10 } as const;

describe("the recorded per-tier GPU budgets", () => {
  const TIERS = ["low", "medium", "high"] as const;
  const GPU_TEMPLATES = ["3d-third-person", "3d-first-person"] as const;
  const CASES = TIERS.flatMap((tier) => GPU_TEMPLATES.map((name) => [tier, name] as const));

  it.each(CASES)("keeps the %s tier's %s ceiling inside the tier's §7 frame", (tier, name) => {
    const row = baselines.gpuTime.tiers[tier].templates[name];
    expect(row.standardsBudgetMs).toBe(TIER_GPU_FRAME_MS[tier]);
    expect(row.budgetMs).toBeLessThanOrEqual(TIER_GPU_FRAME_MS[tier]);
    expect(row.medianMs).toBeGreaterThan(0);
    expect(row.medianMs).toBeLessThanOrEqual(row.budgetMs);
    expect(row.recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
});
