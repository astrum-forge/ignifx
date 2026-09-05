/**
 * The single output sink for the repository tooling scripts.
 *
 * Coding standards §5.5 bans `console.*` in engine code; tooling is exempt (`.oxlintrc.json`
 * overrides `scripts/**`), but every line still goes through here so that CI log grouping
 * (`::group::` on GitHub Actions) can be added in one place rather than in three scripts.
 */

/** Marker printed in front of a check that passed. */
export const PASS_MARK = "✔";

/** Marker printed in front of a check that failed. */
export const FAIL_MARK = "✘";

/** Marker printed in front of a check that did not run. */
export const SKIP_MARK = "–";

/**
 * Writes one line to standard output.
 *
 * @param line - The text to print.
 */
export function log(line: string): void {
  console.log(line);
}

/**
 * Writes one line to standard error.
 *
 * @param line - The text to print.
 */
export function logError(line: string): void {
  console.error(line);
}

/**
 * Writes an indented continuation line under the check it belongs to.
 *
 * @param line - The text to print.
 */
export function logDetail(line: string): void {
  console.log(`    ${line}`);
}
