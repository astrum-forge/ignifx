/**
 * The `examples-run` check of the documentation harness
 * (`docs/architecture/16-docs-harness-and-skill.md` §4, row "Examples run"). Every fenced block
 * whose info string is `ts run` is executed as a real program: a block that is documented as
 * headless has to actually reach the end of itself under Node.
 *
 * How a block is executed:
 *
 * 1. Every `ts run` block is written into one throw-away project outside the repository, the same
 *    project layout `examples-compile` uses, with `"type": "module"` so the blocks are ES modules.
 * 2. The project gets a `node_modules/` of symbolic links — `ignifx` and one `@ignifx/<name>` per
 *    workspace package — pointing at `packages/<dir>`. Node resolves a symbolic link to its real
 *    path before it looks for `node_modules`, so each package's own dependencies (`@babylonjs/lite`
 *    and friends) resolve out of `packages/<dir>/node_modules` exactly as they do in the workspace.
 *    Links, not an import map or a loader hook: they need no flags, they behave the same on macOS
 *    and Linux, and they let `package.json` `exports` do the resolving instead of a second
 *    hand-written copy of it. `junction` is passed as the link type so a Windows checkout does not
 *    need elevated privileges; POSIX ignores the argument.
 * 3. Each block runs as its own `node <file>.ts` process. Node ≥ 24 strips types from `.ts` files
 *    without a flag (`--experimental-strip-types` is on by default since Node 23.6), so the blocks
 *    execute exactly as written, with no build step and no transform of the documented source.
 *
 * A block passes when the process exits 0 within {@link RUN_TIMEOUT_MS}. Failures name the Markdown
 * file and the line of the opening fence, the way compile diagnostics do.
 *
 * Blocks that need a DOM, a GPU, or an asset file that only exists in a real project are never
 * tagged `run`; they stay `ts` and are type-checked only.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { failed, passed, summarize } from "./check-result.ts";
import { runCommand, tailLines } from "./run.ts";
import { collectSkillExamples, missingBuilds } from "./skill-examples.ts";
import { listWorkspacePackages } from "./workspace.ts";
import type { CheckResult, HarnessContext } from "./check-result.ts";
import type { SkillExample } from "./skill-examples.ts";
import type { SkillRoot } from "./skill-files.ts";

/** How long a single block may run before it is killed and reported as a failure. */
export const RUN_TIMEOUT_MS = 30_000;

/** How many lines of a failing block's output are quoted under the failure. */
const OUTPUT_TAIL_LINES = 8;

/** Cap on the note lines printed under the check, failures and timings alike. */
const MAX_NOTES = 80;

/** What one executed block cost, for the harness report. */
interface RunOutcome {
  /** The block that ran. */
  readonly example: SkillExample;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  /** The failure message, or `null` when the block exited 0. */
  readonly failure: string | null;
  /** Output of a failing block, already trimmed to its tail. */
  readonly output: string;
}

/**
 * Writes the throw-away project the blocks execute in.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param examples - The blocks tagged `ts run`.
 * @returns Absolute path to the temporary project directory.
 */
function writeRunnableProject(repositoryRoot: string, examples: readonly SkillExample[]): string {
  const project = mkdtempSync(path.join(tmpdir(), "ignifx-docs-run-"));
  writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");
  mkdirSync(path.join(project, "blocks"), { recursive: true });
  const scoped = path.join(project, "node_modules", "@ignifx");
  mkdirSync(scoped, { recursive: true });
  for (const workspacePackage of listWorkspacePackages(repositoryRoot)) {
    if (workspacePackage.name === "ignifx") {
      symlinkSync(workspacePackage.absolutePath, path.join(project, "node_modules", "ignifx"), "junction");
      continue;
    }
    if (workspacePackage.name.startsWith("@ignifx/")) {
      const link = path.join(scoped, workspacePackage.name.slice("@ignifx/".length));
      symlinkSync(workspacePackage.absolutePath, link, "junction");
    }
  }
  for (const example of examples) {
    writeFileSync(path.join(project, "blocks", example.fileName), `${example.code}\n`, "utf8");
  }
  return project;
}

/**
 * Executes one block and classifies the outcome.
 *
 * @param project - Absolute path to the throw-away project.
 * @param example - The block to run.
 * @returns What the block cost and whether it failed.
 */
function runExample(project: string, example: SkillExample): RunOutcome {
  const file = path.join("blocks", example.fileName);
  const result = runCommand("node", [file], project, { timeoutMs: RUN_TIMEOUT_MS });
  const location = `${example.label}:${String(example.line)}`;
  if (result.timedOut) {
    return {
      example,
      durationMs: result.durationMs,
      failure: `${location}: still running after ${String(RUN_TIMEOUT_MS / 1000)}s — it was killed`,
      output: tailLines(result.output, OUTPUT_TAIL_LINES),
    };
  }
  if (result.code !== 0) {
    return {
      example,
      durationMs: result.durationMs,
      failure: `${location}: exited ${String(result.code)}`,
      output: tailLines(result.output, OUTPUT_TAIL_LINES),
    };
  }
  return { example, durationMs: result.durationMs, failure: null, output: "" };
}

/**
 * Turns the outcomes into the lines printed under the check.
 *
 * @param outcomes - One entry per executed block, in execution order.
 * @returns The failure lines when anything failed, otherwise one timing line per block.
 */
function outcomeNotes(outcomes: readonly RunOutcome[]): readonly string[] {
  const failures = outcomes.filter((outcome) => outcome.failure !== null);
  if (failures.length > 0) {
    const lines: string[] = [];
    for (const outcome of failures) {
      lines.push(outcome.failure ?? "");
      for (const line of outcome.output.split("\n").filter((entry) => entry !== "")) {
        lines.push(`  ${line}`);
      }
    }
    return summarize(lines, MAX_NOTES);
  }
  return summarize(
    outcomes.map(
      (outcome) => `${outcome.example.label}:${String(outcome.example.line)} — ${String(outcome.durationMs)}ms`,
    ),
    MAX_NOTES,
  );
}

/**
 * Runs the `examples-run` check.
 *
 * @param context - The tree being inspected.
 * @param roots - The skills found in that tree.
 * @returns The check result.
 */
export function checkExamplesRun(context: HarnessContext, roots: readonly SkillRoot[]): CheckResult {
  const runnable = collectSkillExamples(context, roots).examples.filter((example) => example.run);
  if (runnable.length === 0) {
    return passed("examples-run", "no blocks are tagged `ts run`");
  }
  const missing = missingBuilds(context.repositoryRoot, runnable, "index.js");
  if (missing.length > 0) {
    return failed("examples-run", `packages without a built dist/: ${missing.join(", ")} — run pnpm build first`);
  }
  const project = writeRunnableProject(context.repositoryRoot, runnable);
  let outcomes: readonly RunOutcome[];
  try {
    outcomes = runnable.map((example) => runExample(project, example));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
  const failures = outcomes.filter((outcome) => outcome.failure !== null).length;
  const totalMs = outcomes.reduce((sum, outcome) => sum + outcome.durationMs, 0);
  const notes = outcomeNotes(outcomes);
  if (failures > 0) {
    return failed("examples-run", `${String(failures)} of ${String(runnable.length)} \`ts run\` blocks failed`, notes);
  }
  return passed(
    "examples-run",
    `${String(runnable.length)} \`ts run\` blocks executed in ${(totalMs / 1000).toFixed(1)}s`,
    notes,
  );
}
