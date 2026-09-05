/**
 * The two pull-request-context checks of the harness
 * (`docs/architecture/16-docs-harness-and-skill.md` §4). Both need a diff base, so both report
 * `SKIPPED` on a plain working tree and only run under `--base <ref>`.
 */
import path from "node:path";
import { failed, passed, skipped, summarize } from "./check-result.ts";
import { exists } from "./fs-tree.ts";
import { runCommand } from "./run.ts";
import type { CheckResult, HarnessContext } from "./check-result.ts";

const API_REPORT = /^packages\/([^/]+)\/api\/.+\.api\.md$/u;
const PACKAGE_SOURCE = /^packages\/([^/]+)\/src\/.+$/u;

/**
 * Lists the repository-relative paths that differ from a base ref.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param base - The git ref to compare against.
 * @returns The changed paths, or `null` when git could not produce a diff.
 */
function changedPaths(repositoryRoot: string, base: string): readonly string[] | null {
  const result = runCommand("git", ["diff", "--name-only", base, "--"], repositoryRoot);
  if (result.code !== 0) {
    return null;
  }
  return result.output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Runs the `api-report-gate` check: a changed API report needs a changeset and a skill update.
 *
 * @param context - The tree being inspected.
 * @returns The check result.
 */
export function checkApiReportGate(context: HarnessContext): CheckResult {
  const base = context.base;
  if (base === null) {
    return skipped("api-report-gate", "SKIPPED (needs --base <ref>)");
  }
  const changed = changedPaths(context.repositoryRoot, base);
  if (changed === null) {
    return failed("api-report-gate", `could not diff against \`${base}\``);
  }
  const reports = changed.filter((file) => API_REPORT.test(file));
  if (reports.length === 0) {
    return passed("api-report-gate", `no API report changed against ${base}`);
  }
  const problems: string[] = [];
  if (!changed.some((file) => file.startsWith(".changeset/") && file.endsWith(".md"))) {
    problems.push("no changeset under .changeset/*.md (CONSTITUTION.md §4.5)");
  }
  if (!changed.some((file) => file.startsWith("skills/")) && !context.allowDocsNotNeeded) {
    problems.push(
      "no file under skills/ changed (CONSTITUTION.md §5.2); the `docs-not-needed` PR label overrides this",
    );
  }
  if (problems.length > 0) {
    return failed("api-report-gate", `${String(reports.length)} API reports changed`, [...reports, ...problems]);
  }
  return passed(
    "api-report-gate",
    `${String(reports.length)} API reports changed, changeset and skill updates present`,
  );
}

/**
 * Runs the `freshness` check: a package whose `src/` changed must ship a regenerated API reference.
 *
 * @param context - The tree being inspected.
 * @returns The check result.
 */
export function checkFreshness(context: HarnessContext): CheckResult {
  const base = context.base;
  if (base === null) {
    return skipped("freshness", "SKIPPED (needs --base <ref>)");
  }
  const changed = changedPaths(context.repositoryRoot, base);
  if (changed === null) {
    return failed("freshness", `could not diff against \`${base}\``);
  }
  const touched = new Set<string>();
  for (const file of changed) {
    const match = PACKAGE_SOURCE.exec(file);
    if (match !== null && match[1] !== undefined) {
      touched.add(match[1]);
    }
  }
  const stale: string[] = [];
  for (const directory of [...touched].toSorted((left, right) => left.localeCompare(right))) {
    const reference = `skills/ignifx/references/api/${directory}.md`;
    if (!exists(path.join(context.repositoryRoot, reference))) {
      continue;
    }
    if (!changed.includes(reference)) {
      stale.push(`${reference} was not regenerated although packages/${directory}/src/ changed`);
    }
  }
  if (stale.length > 0) {
    return failed("freshness", `${String(stale.length)} stale API references`, [
      ...summarize(stale, 20),
      "fix: run `pnpm docs:api`",
    ]);
  }
  return passed("freshness", `${String(touched.size)} packages changed against ${base}, references current`);
}
