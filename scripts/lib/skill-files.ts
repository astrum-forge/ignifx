/**
 * Locates the Agent Skills in the tree: the entry skills under the skills directory
 * (`skills/<name>/SKILL.md`) and the per-package subsystem skills declared by each package's
 * `ignifx.skill` manifest entry (`packages/<pkg>/skills/<name>/SKILL.md`), as laid out in
 * `docs/architecture/16-docs-harness-and-skill.md` §1 and `04-extensions.md` §4.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { exists, listDirectories, listFilesRecursive } from "./fs-tree.ts";

/** One skill directory. */
export interface SkillRoot {
  /** Absolute path to the skill directory (the one holding `SKILL.md`). */
  readonly directory: string;
  /** Absolute path to its `SKILL.md`. */
  readonly skillFile: string;
  /** The directory name, which the frontmatter `name` must equal. */
  readonly name: string;
  /** Path shown in messages, relative to the repository root where possible. */
  readonly label: string;
}

/**
 * Collects the skill directories under one parent directory.
 *
 * @param parent - Absolute path to a directory whose children are skill directories.
 * @param repositoryRoot - Absolute path to the repository root, used to build labels.
 * @returns The skill roots found, sorted by name.
 */
function skillsUnder(parent: string, repositoryRoot: string): readonly SkillRoot[] {
  const roots: SkillRoot[] = [];
  for (const name of listDirectories(parent)) {
    const directory = path.join(parent, name);
    const skillFile = path.join(directory, "SKILL.md");
    if (exists(skillFile)) {
      roots.push({ directory, skillFile, name, label: displayPath(repositoryRoot, skillFile, parent) });
    }
  }
  return roots;
}

/**
 * Reads the `ignifx.skill` manifest entry of one package (`docs/architecture/04-extensions.md` §4).
 *
 * @param packageDirectory - Absolute path to the package.
 * @returns The absolute path of the declared `SKILL.md`, or `null` when the package declares none.
 */
function declaredSkillFile(packageDirectory: string): string | null {
  const manifestFile = path.join(packageDirectory, "package.json");
  if (!exists(manifestFile)) {
    return null;
  }
  const manifest: unknown = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("ignifx" in manifest)) {
    return null;
  }
  const block = manifest.ignifx;
  if (typeof block !== "object" || block === null || !("skill" in block) || typeof block.skill !== "string") {
    return null;
  }
  return path.resolve(packageDirectory, block.skill);
}

/**
 * Finds every skill in the tree: the entry skills under `skillsDirectory`, then one subsystem skill
 * per package that declares `ignifx.skill` in its `package.json`. Discovery goes through the
 * manifest, not through directory globbing, so a packed copy of the entry skill inside the
 * umbrella package (`packages/ignifx/skills/`, written at `prepack`) is never linted twice.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param skillsDirectory - Absolute path to the entry-skill directory (usually `<root>/skills`).
 * @returns The entry skills followed by the per-package subsystem skills.
 */
export function findSkillRoots(repositoryRoot: string, skillsDirectory: string): readonly SkillRoot[] {
  const roots = [...skillsUnder(skillsDirectory, repositoryRoot)];
  const packagesDirectory = path.join(repositoryRoot, "packages");
  for (const directory of listDirectories(packagesDirectory)) {
    const skillFile = declaredSkillFile(path.join(packagesDirectory, directory));
    if (skillFile !== null && exists(skillFile)) {
      const skillDirectory = path.dirname(skillFile);
      roots.push({
        directory: skillDirectory,
        skillFile,
        name: path.basename(skillDirectory),
        label: displayPath(repositoryRoot, skillFile, skillDirectory),
      });
    }
  }
  return roots;
}

/**
 * Builds the path shown in harness messages for a file.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param file - Absolute path to the file.
 * @param fallbackRoot - Directory to make the path relative to when the file sits outside the
 *   repository, which happens under `--skills-dir`.
 * @returns A short, stable path for messages.
 */
export function displayPath(repositoryRoot: string, file: string, fallbackRoot: string): string {
  const relative = path.relative(repositoryRoot, file);
  if (!relative.startsWith("..")) {
    return relative.split(path.sep).join("/");
  }
  return path.relative(path.dirname(fallbackRoot), file).split(path.sep).join("/");
}

/**
 * Lists every Markdown file belonging to a set of skills.
 *
 * @param roots - The skill roots to scan.
 * @returns Absolute paths of all `.md` files under those roots, without duplicates.
 */
export function listSkillMarkdown(roots: readonly SkillRoot[]): readonly string[] {
  const files = new Set<string>();
  for (const root of roots) {
    for (const file of listFilesRecursive(root.directory, ".md")) {
      files.add(file);
    }
  }
  return [...files].toSorted((left, right) => left.localeCompare(right));
}
