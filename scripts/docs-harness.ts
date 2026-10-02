#!/usr/bin/env node
/**
 * `pnpm docs:harness` — the CI `docs-harness` job as a single command
 * (`docs/architecture/16-docs-harness-and-skill.md` §4, `CONSTITUTION.md` §5.2 and §5.5).
 *
 * Each rule is a named check that prints one line and either passes, fails, or reports itself as
 * skipped; the process exits 1 if any check failed. The checks:
 *
 * | Check | What it enforces |
 * |---|---|
 * | `skill-lint` | SKILL.md size, frontmatter, section template, links, nesting, deprecation, migration, wording and import rules |
 * | `examples-compile` | every fenced `ts` block in the skills type-checks against the built packages |
 * | `examples-run` | every block tagged `ts run` executes under Node and exits 0 |
 * | `regeneration-diff` | `docs:api` + `docs:schemas` + `docs:recipes` + `docs:llms` reproduce the committed output |
 * | `migrations-guard` | `docs/migrations/` holds only `README.md` while the version is `0.x` |
 * | `api-report-gate` | a changed `api/*.api.md` ships with a changeset and a skill update |
 * | `freshness` | a package whose `src/` changed ships a regenerated `references/api/<pkg>.md` |
 *
 * Options:
 *
 * - `--skills-dir <dir>` — check a tree of entry skills other than `<repo>/skills` (used by tests).
 * - `--no-regenerate` — skip `regeneration-diff`; use it when the generators have just been run.
 * - `--base <ref>` — enable the two pull-request checks by diffing against a git ref.
 * - `--allow-docs-not-needed` — the CI workflow passes this when the PR carries the
 *   `docs-not-needed` label, which waives the "a skill file changed" half of `api-report-gate`.
 * - `--verbose` — also print the notes under passing checks (per-block timings, skipped blocks).
 *
 * The three slow checks — `examples-compile`, `examples-run` and `regeneration-diff` — run side by
 * side. They share no output: the first two work in throw-away projects under the OS temp
 * directory, and the regeneration only rewrites generated pages, which `collectSkillExamples` has
 * already read (and skips) before any of them starts.
 */
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { checkExamplesCompile, checkExamplesRun } from "./lib/check-examples.ts";
import { checkApiReportGate, checkFreshness } from "./lib/check-pull-request.ts";
import { checkMigrationsGuard, checkRegeneration } from "./lib/check-regeneration.ts";
import { skipped } from "./lib/check-result.ts";
import { checkSkillLint } from "./lib/check-skill-lint.ts";
import { FAIL_MARK, PASS_MARK, SKIP_MARK, log, logDetail } from "./lib/log.ts";
import { findSkillRoots } from "./lib/skill-files.ts";
import { releaseVersion, repositoryRoot } from "./lib/workspace.ts";
import type { CheckResult, HarnessContext } from "./lib/check-result.ts";

/**
 * Prints one check result and its notes.
 *
 * @param result - The result to print.
 * @param verbose - Whether a passing check's notes are printed too.
 */
function report(result: CheckResult, verbose: boolean): void {
  if (result.status === "pass") {
    log(`${PASS_MARK} ${result.name} (${result.detail})`);
  } else if (result.status === "fail") {
    log(`${FAIL_MARK} ${result.name}: ${result.detail}`);
  } else {
    log(`${SKIP_MARK} ${result.name}: ${result.detail}`);
  }
  if (result.status === "pass" && !verbose) {
    return;
  }
  for (const note of result.notes) {
    logDetail(`· ${note}`);
  }
}

/**
 * Runs every check and prints the report.
 *
 * @returns The process exit code: 1 when any check failed, otherwise 0.
 */
async function main(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2), ["skills-dir", "base"]);
  const root = repositoryRoot(import.meta.url);
  const context: HarnessContext = {
    repositoryRoot: root,
    skillsDirectory: path.resolve(parsed.options.get("skills-dir") ?? path.join(root, "skills")),
    releaseVersion: releaseVersion(root),
    base: parsed.options.get("base") ?? null,
    allowDocsNotNeeded: parsed.flags.has("allow-docs-not-needed"),
  };
  const roots = findSkillRoots(root, context.skillsDirectory);
  const started = process.hrtime.bigint();

  const lint = checkSkillLint(context, roots);
  const slow = await Promise.all([
    checkExamplesCompile(context, roots),
    checkExamplesRun(context, roots),
    parsed.flags.has("no-regenerate")
      ? skipped("regeneration-diff", "SKIPPED (--no-regenerate)")
      : checkRegeneration(context),
  ]);
  const results: CheckResult[] = [
    lint,
    ...slow,
    checkMigrationsGuard(context),
    checkApiReportGate(context),
    checkFreshness(context),
  ];

  const verbose = parsed.flags.has("verbose");
  for (const result of results) {
    report(result, verbose);
  }
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const count = (status: CheckResult["status"]): number => results.filter((result) => result.status === status).length;
  log(
    `docs:harness — ${String(count("pass"))} passed, ${String(count("fail"))} failed,` +
      ` ${String(count("skip"))} skipped in ${seconds.toFixed(1)}s`,
  );
  return count("fail") > 0 ? 1 : 0;
}

process.exitCode = await main();
