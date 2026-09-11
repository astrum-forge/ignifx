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

/** One recorded frame-budget row; the template rows and the website example rows share the shape. */
interface FrameRow {
  readonly medianMs: number;
  readonly worstMs: number;
  readonly budgetMs: number;
  readonly standardsBudgetMs: number;
  readonly recordedOn: string;
}

/**
 * Separates the recorded rows of `frameTime.examples` from its prose `note`.
 *
 * @param value - One property of the `examples` block.
 * @returns Whether it is a row rather than the note.
 */
function isFrameRow(value: unknown): value is FrameRow {
  return typeof value === "object" && value !== null && "medianMs" in value && "budgetMs" in value;
}

/** The website examples with a recorded row, keyed by catalogue slug. */
const EXAMPLE_ROWS: readonly (readonly [string, FrameRow])[] = Object.entries(baselines.frameTime.examples).flatMap(
  ([name, value]) => (isFrameRow(value) ? [[name, value] as const] : []),
);

describe("the recorded website example frame budgets", () => {
  // The rows are measured by the `website example frame budgets` block of
  // `tests/visual/tests/frame-time.spec.ts` against `/examples/<slug>/run/?bench=1` on the site
  // build; this file holds them to the same two claims as the template rows, on every runner.
  it("records the launch examples", () => {
    expect(EXAMPLE_ROWS.length).toBeGreaterThanOrEqual(2);
  });

  for (const [name, row] of EXAMPLE_ROWS) {
    it(`keeps ${name} inside the §7 budget for its dimension and inside its own ceiling`, () => {
      expect([STANDARDS_BUDGET_MS["2d"], STANDARDS_BUDGET_MS["3d"]], name).toContain(row.standardsBudgetMs);
      expect(row.budgetMs, `${name}: ceiling above the coding-standards §7 budget`).toBeLessThanOrEqual(
        row.standardsBudgetMs,
      );
      expect(row.medianMs, name).toBeGreaterThan(0);
      expect(
        row.medianMs,
        `${name}: the recorded median is ${String(row.medianMs)} ms and the ceiling is ${String(row.budgetMs)} ms.`,
      ).toBeLessThanOrEqual(row.budgetMs);
      expect(row.recordedOn, name).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    });
  }
});
