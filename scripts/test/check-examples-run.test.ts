import { afterEach, describe, expect, it } from "vitest";
import { checkExamplesRun } from "../lib/check-examples-run.ts";
import { writeSkill } from "./support/skill-tree.ts";
import type { CheckResult } from "../lib/check-result.ts";
import type { SkillFixture } from "./support/skill-tree.ts";

const fixtures: SkillFixture[] = [];

/**
 * Builds a fixture skill whose "First app" section holds one block, and runs `examples-run` on it.
 *
 * @param info - The fence info string, for example `ts run`.
 * @param code - The block body.
 * @returns The check result.
 */
function runBlock(info: string, code: string): CheckResult {
  const fixture = writeSkill("demo", { bodies: { "First app": `\`\`\`${info}\n${code}\n\`\`\`` } });
  fixtures.push(fixture);
  return checkExamplesRun(fixture.context, [fixture.root]);
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.cleanup();
  }
});

describe("examples-run", () => {
  it("passes a `ts run` block that exits 0, and reports its runtime", () => {
    const result = runBlock("ts run", 'const greeting: string = "ok";\nif (greeting !== "ok") throw new Error("no");');
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("1 `ts run` blocks executed");
    expect(result.notes.join("\n")).toMatch(/SKILL\.md:\d+ — \d+ms/u);
  });

  it("fails a `ts run` block that throws, naming the Markdown file and line", () => {
    const result = runBlock("ts run", 'throw new Error("boom");');
    expect(result.status).toBe("fail");
    const notes = result.notes.join("\n");
    // The fence sits on the line after the "## First app" heading and its blank line.
    expect(notes).toMatch(/SKILL\.md:\d+: exited 1/u);
    expect(notes).toContain("boom");
  });

  it("leaves untagged blocks alone", () => {
    expect(runBlock("ts", 'throw new Error("never executed");').status).toBe("pass");
  });
});
