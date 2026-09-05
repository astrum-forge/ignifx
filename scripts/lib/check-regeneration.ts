/**
 * The `regeneration-diff` and `migrations-guard` checks
 * (`docs/architecture/16-docs-harness-and-skill.md` §4, `CONSTITUTION.md` §4.2).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { failed, passed, summarize } from "./check-result.ts";
import { exists, listFilesRecursive } from "./fs-tree.ts";
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
 * Generated files under a directory (recursively), excluding the hand-written READMEs.
 *
 * @param root - Absolute repository root.
 * @param directories - Repository-relative directories holding generated output.
 * @returns Repository-relative file paths, sorted.
 */
function generatedFiles(root: string, directories: readonly string[]): readonly string[] {
  const files: string[] = [];
  for (const directory of directories) {
    const absolute = path.join(root, directory);
    if (!exists(absolute)) {
      continue;
    }
    for (const file of listFilesRecursive(absolute, ".md")) {
      if (path.basename(file) !== "README.md") {
        files.push(path.relative(root, file).split(path.sep).join("/"));
      }
    }
    for (const file of listFilesRecursive(absolute, ".json")) {
      files.push(path.relative(root, file).split(path.sep).join("/"));
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

/**
 * Snapshots the content of every generated file so a regeneration can be compared against it.
 *
 * @param root - Absolute repository root.
 * @param files - Repository-relative file paths.
 * @returns A map of file → content hash.
 */
function snapshot(root: string, files: readonly string[]): ReadonlyMap<string, string> {
  const hashes = new Map<string, string>();
  for (const file of files) {
    hashes.set(
      file,
      createHash("sha256")
        .update(readFileSync(path.join(root, file)))
        .digest("hex"),
    );
  }
  return hashes;
}

/**
 * Runs the three generators in order.
 *
 * @param root - Absolute repository root.
 * @returns A failed check result when a generator exits non-zero, otherwise `null`.
 */
function runGenerators(root: string): CheckResult | null {
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
  return null;
}

/**
 * Runs the three generators and fails when the tree's generated output differs from a fresh
 * regeneration. The comparison is against the working tree as it was before the generators ran —
 * not against git HEAD — so a locally regenerated, not-yet-committed file counts as up to date,
 * while a stale committed file (the CI case) is caught.
 *
 * @param context - The tree being inspected.
 * @returns The check result.
 */
export function checkRegeneration(context: HarnessContext): CheckResult {
  const root = context.repositoryRoot;
  // Only generated output is compared: the hand-written concepts pages and the two READMEs are
  // edited by people and must not fail this check (16-docs-harness-and-skill.md §1).
  const directories = [
    "skills/ignifx/references/api",
    "skills/ignifx/references/formats",
    "skills/ignifx/references/recipes",
    ...apiReportDirectories(root),
  ];
  const before = snapshot(root, generatedFiles(root, directories));
  const failure = runGenerators(root);
  if (failure !== null) {
    return failure;
  }
  const afterFiles = generatedFiles(root, directories);
  const after = snapshot(root, afterFiles);
  const drifted: string[] = [];
  for (const [file, hash] of after) {
    const previous = before.get(file);
    if (previous === undefined) {
      drifted.push(`${file} (new)`);
    } else if (previous !== hash) {
      drifted.push(file);
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) {
      drifted.push(`${file} (removed)`);
    }
  }
  if (drifted.length === 0) {
    return passed("regeneration-diff", `${String(afterFiles.length)} generated files up to date`);
  }
  return failed("regeneration-diff", "generated output differs from a fresh regeneration", [
    ...summarize(drifted, 20),
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
