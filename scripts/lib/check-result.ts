/**
 * The shared vocabulary of the documentation harness: one named check, its outcome, and the
 * context every check needs. Helpers here never exit the process — the entry script turns the
 * collected results into an exit code (coding standards §5.5).
 */

/** How a check ended. */
export type CheckStatus = "pass" | "fail" | "skip";

/** The outcome of one named check. */
export interface CheckResult {
  /** Stable check name, printed verbatim so CI logs can be grepped. */
  readonly name: string;
  /** Whether the check passed, failed, or did not run. */
  readonly status: CheckStatus;
  /** One-line summary: a count when it passed, the reason when it failed. */
  readonly detail: string;
  /** Extra lines printed indented under the check. */
  readonly notes: readonly string[];
}

/** Everything the checks need to know about the tree they are inspecting. */
export interface HarnessContext {
  /** Absolute path to the repository root. */
  readonly repositoryRoot: string;
  /** Absolute path to the directory holding the entry skills (`--skills-dir`). */
  readonly skillsDirectory: string;
  /** Version of `@ignifx/core`, the anchor of the fixed version line. */
  readonly releaseVersion: string;
  /** Git ref to diff against for the pull-request checks, or `null` when not supplied. */
  readonly base: string | null;
  /** Whether the CI `docs-not-needed` label was passed through. */
  readonly allowDocsNotNeeded: boolean;
}

/**
 * Builds a passing result.
 *
 * @param name - Check name.
 * @param detail - One-line summary of what was inspected.
 * @param notes - Extra lines to print under the check.
 * @returns The result.
 */
export function passed(name: string, detail: string, notes: readonly string[] = []): CheckResult {
  return { name, status: "pass", detail, notes };
}

/**
 * Builds a failing result.
 *
 * @param name - Check name.
 * @param detail - One-line reason for the failure.
 * @param notes - Extra lines to print under the check, typically the offending files.
 * @returns The result.
 */
export function failed(name: string, detail: string, notes: readonly string[] = []): CheckResult {
  return { name, status: "fail", detail, notes };
}

/**
 * Builds a skipped result.
 *
 * @param name - Check name.
 * @param detail - Why the check did not run and how to enable it.
 * @returns The result.
 */
export function skipped(name: string, detail: string): CheckResult {
  return { name, status: "skip", detail, notes: [] };
}

/**
 * Caps a list of problem lines so a failure message stays readable.
 *
 * @param problems - All problems found.
 * @param limit - Maximum number of lines to keep.
 * @returns The kept lines plus a "and N more" line when truncated.
 */
export function summarize(problems: readonly string[], limit: number): readonly string[] {
  if (problems.length <= limit) {
    return problems;
  }
  return [...problems.slice(0, limit), `… and ${String(problems.length - limit)} more`];
}
