/**
 * The fenced `ts` blocks of the Agent Skills, shared by the two example checks
 * (`docs/architecture/16-docs-harness-and-skill.md` §4): `examples-compile` type-checks every block
 * against the built packages, and `examples-run` executes the subset tagged `ts run`.
 *
 * Collection happens once, here, so both checks agree on which blocks exist, what file name each
 * block gets inside a throw-away project, and which Markdown line a diagnostic points back at.
 */
import path from "node:path";
import { exists, readText } from "./fs-tree.ts";
import { extractFencedBlocks } from "./markdown.ts";
import { displayPath, listSkillMarkdown } from "./skill-files.ts";
import type { HarnessContext } from "./check-result.ts";
import type { SkillRoot } from "./skill-files.ts";

/** A `ts` block extracted from a skill Markdown file. */
export interface SkillExample {
  /** Repository-relative path of the Markdown file it came from. */
  readonly label: string;
  /** 1-based line of the opening fence. */
  readonly line: number;
  /** File name to give the block inside a temporary project; unique across the set. */
  readonly fileName: string;
  /** The block body. */
  readonly code: string;
  /** Whether the info string carried the `run` token (`ts run`). */
  readonly run: boolean;
}

/** Every `ts` block of a skill tree, sorted into the buckets the checks report on. */
export interface SkillExampleSet {
  /** Blocks that are type-checked, in file order. */
  readonly examples: readonly SkillExample[];
  /** `file:line` of every block that opted out with `ts ignore-check`. */
  readonly ignored: readonly string[];
  /** Number of blocks skipped because they live under `references/api/`. */
  readonly generated: number;
}

const IMPORT_SPECIFIER = /(?:from|import)\s+["']([^"']+)["']/gu;
const GENERATED_SEGMENT = `${path.sep}references${path.sep}api${path.sep}`;

/**
 * Maps an `@ignifx/*` or `ignifx` specifier to the package directory that must be built.
 *
 * @param specifier - The import specifier found in an example.
 * @returns The directory name under `packages/`, or `null` for third-party specifiers.
 */
export function packageDirectoryFor(specifier: string): string | null {
  if (specifier === "ignifx") {
    return "ignifx";
  }
  if (!specifier.startsWith("@ignifx/")) {
    return null;
  }
  return specifier.slice("@ignifx/".length).split("/")[0] ?? null;
}

/**
 * Lists the `@ignifx/*` packages an example set imports whose build output is missing.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param examples - The blocks to inspect.
 * @param entryFile - The `dist/` file that must exist, `index.d.ts` to compile or `index.js` to run.
 * @returns Directory names under `packages/` that are missing that file.
 */
export function missingBuilds(
  repositoryRoot: string,
  examples: readonly SkillExample[],
  entryFile: string,
): readonly string[] {
  const missing = new Set<string>();
  for (const example of examples) {
    for (const match of example.code.matchAll(IMPORT_SPECIFIER)) {
      const directory = packageDirectoryFor(match[1] ?? "");
      if (directory === null) {
        continue;
      }
      if (!exists(path.join(repositoryRoot, "packages", directory, "dist", entryFile))) {
        missing.add(directory);
      }
    }
  }
  return [...missing].toSorted((left, right) => left.localeCompare(right));
}

/**
 * Collects the `ts` blocks of every skill Markdown file and sorts them into buckets.
 *
 * Three kinds of block are never compiled or executed:
 *
 * - `ts ignore-check` — an explicit, justified opt-out (§4);
 * - blocks under `references/api/`, which TypeDoc renders from TSDoc `@example` fragments: they are
 *   snippets of a larger program, not standalone modules;
 * - blocks whose info string does not start with `ts`.
 *
 * @param context - The tree being inspected.
 * @param roots - The skills found in that tree.
 * @returns The blocks to compile plus the counts of the ones that were not.
 */
export function collectSkillExamples(context: HarnessContext, roots: readonly SkillRoot[]): SkillExampleSet {
  const examples: SkillExample[] = [];
  const ignored: string[] = [];
  let generated = 0;
  for (const file of listSkillMarkdown(roots)) {
    const label = displayPath(context.repositoryRoot, file, context.skillsDirectory);
    for (const [index, block] of extractFencedBlocks(readText(file)).entries()) {
      if (block.infoTokens[0] !== "ts") {
        continue;
      }
      if (block.infoTokens.includes("ignore-check")) {
        ignored.push(`${label}:${String(block.line)}`);
        continue;
      }
      if (file.includes(GENERATED_SEGMENT)) {
        generated += 1;
        continue;
      }
      const slug = label
        .split("/")
        .slice(-3)
        .join("-")
        .replaceAll(/[^a-z0-9]+/giu, "-")
        .toLowerCase();
      examples.push({
        label,
        line: block.line,
        fileName: `${slug}-${String(index)}.ts`,
        code: block.code,
        run: block.infoTokens.includes("run"),
      });
    }
  }
  return { examples, ignored, generated };
}
