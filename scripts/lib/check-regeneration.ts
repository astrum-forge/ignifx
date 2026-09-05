/**
 * The `regeneration-diff` and `migrations-guard` checks
 * (`docs/architecture/16-docs-harness-and-skill.md` §4, `CONSTITUTION.md` §4.2).
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { failed, passed, summarize } from "./check-result.ts";
import { exists } from "./fs-tree.ts";
import { runCommand, tailLines } from "./run.ts";
import type { CheckResult, HarnessContext } from "./check-result.ts";

/**
 * Expands the `packages/*&ast;/api` paths that exist, since `git diff` is run without a shell.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @returns Repository-relative paths of the API report directories.
 */
function apiReportDirectories(repositoryRoot: string): readonly string[] {
  const packagesDirectory = path.join(repositoryRoot, "packages");
  if (!exists(packagesDirectory)) {
    return [];
  }
  return readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && exists(path.join(packagesDirectory, entry.name, "api")))
    .map((entry) => `packages/${entry.name}/api`)
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * Runs the three generators and fails when the committed output differs from the regenerated one.
 *
 * @param context - The tree being inspected.
 * @returns The check result.
 */
export function checkRegeneration(context: HarnessContext): CheckResult {
  const root = context.repositoryRoot;
  const generators: readonly (readonly [string, readonly string[]])[] = [
    ["pnpm", ["docs:api"]],
    ["node", [path.join("scripts", "docs-schemas.ts")]],
    ["node", [path.join("scripts", "docs-recipes.ts")]],
  ];
  for (const [command, args] of generators) {
    const result = runCommand(command, args, root);
    if (result.code !== 0) {
      const label = `${command} ${args.join(" ")}`;
      return failed(
        "regeneration-diff",
        `\`${label}\` exited ${String(result.code)}`,
        tailLines(result.output, 15).split("\n"),
      );
    }
  }
  // Only generated output is compared: the hand-written concepts pages and the two READMEs are
  // edited by people and must not fail this check (16-docs-harness-and-skill.md §1).
  const paths = [
    "skills/ignifx/references/api",
    "skills/ignifx/references/formats",
    "skills/ignifx/references/recipes",
    ":(exclude)skills/ignifx/references/formats/README.md",
    ":(exclude)skills/ignifx/references/recipes/README.md",
    ...apiReportDirectories(root),
  ];
  const diff = runCommand("git", ["diff", "--exit-code", "--stat", "--", ...paths], root);
  if (diff.code === 0) {
    const generatedPaths = paths.filter((entry) => !entry.startsWith(":(exclude)"));
    return passed("regeneration-diff", `${String(generatedPaths.length)} generated paths clean`, [
      "note: `git diff` sees tracked files only; output that has never been committed cannot drift",
    ]);
  }
  return failed("regeneration-diff", "committed output differs from regenerated output", [
    ...summarize(
      diff.output.split("\n").filter((line) => line.trim() !== ""),
      20,
    ),
    "fix: commit the regenerated files (never hand-edit them — coding standards §15)",
  ]);
}

/**
 * Fails when anything other than `README.md` exists under `docs/migrations/` before 1.0.
 *
 * @param context - The tree being inspected.
 * @returns The check result.
 */
export function checkMigrationsGuard(context: HarnessContext): CheckResult {
  const directory = path.join(context.repositoryRoot, "docs", "migrations");
  if (!context.releaseVersion.startsWith("0.")) {
    return passed("migrations-guard", `not applicable at version ${context.releaseVersion}`);
  }
  if (!exists(directory)) {
    return passed("migrations-guard", "docs/migrations/ does not exist");
  }
  const offenders = readdirSync(directory)
    .filter((entry) => entry !== "README.md")
    .toSorted((left, right) => left.localeCompare(right));
  if (offenders.length > 0) {
    return failed(
      "migrations-guard",
      `docs/migrations/ must hold only README.md while the version is 0.x (CONSTITUTION.md §4.2)`,
      offenders.map((entry) => `docs/migrations/${entry}`),
    );
  }
  return passed("migrations-guard", `README.md only, version ${context.releaseVersion}`);
}
