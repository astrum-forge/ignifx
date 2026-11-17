/**
 * The two pull-request-context checks of the harness
 * (`docs/architecture/16-docs-harness-and-skill.md` §4). Both need a diff base, so both report
 * `SKIPPED` on a plain working tree and only run under `--base <ref>`.
 */
import path from "node:path";
import { failed, passed, skipped, summarize } from "./check-result.ts";
import { runCommand } from "./run.ts";
import type { CheckResult, HarnessContext } from "./check-result.ts";

const API_REPORT = /^packages\/([^/]+)\/api\/.+\.api\.md$/u;
const API_REFERENCES = "skills/ignifx/references/api";

/**
 * Maps an API report to the API reference generated from the same entry point.
 *
 * Each entry point has an API Extractor config that writes `<entry>.api.md` (`apiReport.reportFileName`)
 * and a TypeDoc config that writes `<entry>.md` (`entryFileName`), so a subpath entry pairs with its
 * own page: `packages/electron/api/electron-main.api.md` with `references/api/electron-main.md`, not
 * with `electron.md`. `scripts/test/check-pull-request.test.ts` holds every package's configs to it.
 *
 * @param report - Repository-relative path of a changed file.
 * @returns The repository-relative reference path, or `null` when `report` is not an API report.
 */
export function apiReferenceFor(report: string): string | null {
  if (!API_REPORT.test(report)) {
    return null;
  }
  return `${API_REFERENCES}/${path.posix.basename(report, ".api.md")}.md`;
}

/**
 * Lists the API reports in a diff whose own generated reference is not in the same diff.
 *
 * An added, changed or deleted report needs its reference added, regenerated or deleted with it.
 *
 * @param changed - Repository-relative paths that differ from the base.
 * @returns One line per stale reference, sorted by report path.
 */
export function staleApiReferences(changed: readonly string[]): string[] {
  const changedSet = new Set(changed);
  const stale: string[] = [];
  for (const report of [...changed].toSorted((left, right) => left.localeCompare(right))) {
    const reference = apiReferenceFor(report);
    if (reference !== null && !changedSet.has(reference)) {
      stale.push(`${reference} was not regenerated although ${report} changed`);
    }
  }
  return stale;
}

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
 * Runs the `freshness` check: each changed API report must ship the API reference regenerated from
 * the same entry point.
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
  // "The package's last public change" (16 §4) is the API report changing, not any `src/` edit: a
  // refactor that leaves the public surface identical regenerates to the very same reference, so
  // keying on `src/` reported it stale for nothing. The pairing is per entry point, not per
  // package: keying on the package folder demanded `electron.md` for a change to
  // `electron-main.api.md` and let a stale `electron-main.md` through when `electron.md` changed.
  const reports = changed.filter((file) => API_REPORT.test(file)).length;
  const stale = staleApiReferences(changed);
  if (stale.length > 0) {
    return failed("freshness", `${String(stale.length)} stale API references`, [
      ...summarize(stale, 20),
      "fix: run `pnpm docs:api`",
    ]);
  }
  return passed("freshness", `${String(reports)} API reports changed against ${base}, references current`);
}
