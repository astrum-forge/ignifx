/**
 * The `examples-compile` check of the documentation harness
 * (`docs/architecture/16-docs-harness-and-skill.md` §4). Every fenced block whose info string
 * starts with `ts` is written to a throw-away project outside the repository and type-checked
 * against the built packages.
 *
 * Three kinds of block are not compiled:
 *
 * - `ts ignore-check` — an explicit, justified opt-out (§4);
 * - blocks under `references/api/`, which TypeDoc renders from TSDoc `@example` fragments: they are
 *   snippets of a larger program, not standalone modules, and compiling them would mean rewriting
 *   the engine's TSDoc examples into full programs. Phase 11 owns that decision;
 * - nothing else — `ts run` blocks are compiled here and executed from Phase 1 onwards.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { failed, passed, summarize } from "./check-result.ts";
import { exists, readText } from "./fs-tree.ts";
import { extractFencedBlocks } from "./markdown.ts";
import { runCommand } from "./run.ts";
import { displayPath, listSkillMarkdown } from "./skill-files.ts";
import type { CheckResult, HarnessContext } from "./check-result.ts";
import type { SkillRoot } from "./skill-files.ts";

/** A `ts` block that will be type-checked. */
interface Example {
  /** Repository-relative path of the Markdown file it came from. */
  readonly label: string;
  /** 1-based line of the opening fence. */
  readonly line: number;
  /** File name to give the block inside the temporary project. */
  readonly fileName: string;
  /** The block body. */
  readonly code: string;
}

const IMPORT_SPECIFIER = /(?:from|import)\s+["']([^"']+)["']/gu;
const GENERATED_SEGMENT = `${path.sep}references${path.sep}api${path.sep}`;

/**
 * Maps an `@ignifx/*` or `ignifx` specifier to the package directory that must be built.
 *
 * @param specifier - The import specifier found in an example.
 * @returns The directory name under `packages/`, or `null` for third-party specifiers.
 */
function packageDirectoryFor(specifier: string): string | null {
  if (specifier === "ignifx") {
    return "ignifx";
  }
  if (!specifier.startsWith("@ignifx/")) {
    return null;
  }
  return specifier.slice("@ignifx/".length).split("/")[0] ?? null;
}

/**
 * Writes the temporary project that the examples are type-checked in.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param examples - The blocks to type-check.
 * @returns Absolute path to the temporary project directory.
 */
function writeTemporaryProject(repositoryRoot: string, examples: readonly Example[]): string {
  const project = mkdtempSync(path.join(tmpdir(), "ignifx-docs-examples-"));
  mkdirSync(path.join(project, "blocks"), { recursive: true });
  // The blocks are ES modules; without this `nodenext` resolution treats them as CommonJS.
  writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");
  for (const example of examples) {
    writeFileSync(path.join(project, "blocks", example.fileName), `${example.code}\nexport {};\n`, "utf8");
  }
  const tsconfig = {
    extends: path.join(repositoryRoot, "tsconfig.base.json"),
    compilerOptions: {
      noEmit: true,
      composite: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      isolatedDeclarations: false,
      types: ["@webgpu/types"],
      typeRoots: [path.join(repositoryRoot, "node_modules"), path.join(repositoryRoot, "node_modules", "@types")],
      paths: {
        "@ignifx/*": [path.join(repositoryRoot, "packages", "*", "dist", "index.d.ts")],
        ignifx: [path.join(repositoryRoot, "packages", "ignifx", "dist", "index.d.ts")],
      },
    },
    include: ["blocks/**/*.ts"],
  };
  writeFileSync(path.join(project, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");
  return project;
}

/**
 * Collects the `ts` blocks of every skill Markdown file and sorts them into buckets.
 *
 * @param context - The tree being inspected.
 * @param roots - The skills found in that tree.
 * @returns The blocks to compile plus the counts of the ones that were not.
 */
function collectExamples(
  context: HarnessContext,
  roots: readonly SkillRoot[],
): {
  readonly examples: readonly Example[];
  readonly ignored: readonly string[];
  readonly generated: number;
  readonly runnable: number;
} {
  const examples: Example[] = [];
  const ignored: string[] = [];
  let generated = 0;
  let runnable = 0;
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
      if (block.infoTokens.includes("run")) {
        runnable += 1;
      }
      const slug = label
        .split("/")
        .slice(-3)
        .join("-")
        .replaceAll(/[^a-z0-9]+/giu, "-")
        .toLowerCase();
      examples.push({ label, line: block.line, fileName: `${slug}-${String(index)}.ts`, code: block.code });
    }
  }
  return { examples, ignored, generated, runnable };
}

/**
 * Lists the `@ignifx/*` packages an example set imports whose `dist/` has not been built.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param examples - The blocks to type-check.
 * @returns Directory names under `packages/` that are missing `dist/index.d.ts`.
 */
function missingBuilds(repositoryRoot: string, examples: readonly Example[]): readonly string[] {
  const missing = new Set<string>();
  for (const example of examples) {
    for (const match of example.code.matchAll(IMPORT_SPECIFIER)) {
      const directory = packageDirectoryFor(match[1] ?? "");
      if (directory === null) {
        continue;
      }
      if (!exists(path.join(repositoryRoot, "packages", directory, "dist", "index.d.ts"))) {
        missing.add(directory);
      }
    }
  }
  return [...missing].toSorted((left, right) => left.localeCompare(right));
}

/**
 * Rewrites tsc diagnostics so they point at the Markdown file and line the block came from.
 *
 * @param output - Raw tsc output.
 * @param examples - The blocks that were written to the temporary project.
 * @returns The diagnostic lines, relocated onto the source Markdown.
 */
function rewriteDiagnostics(output: string, examples: readonly Example[]): readonly string[] {
  const byFileName = new Map(examples.map((example) => [example.fileName, example]));
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = /([A-Za-z0-9._-]+\.ts)\((\d+),(\d+)\):(.*)$/u.exec(line);
      const example = match === null ? undefined : byFileName.get(match[1] ?? "");
      if (match === null || example === undefined) {
        return line;
      }
      return `${example.label}:${String(example.line + Number(match[2] ?? "0"))}:${match[4] ?? ""}`;
    });
}

/**
 * Runs the `examples-compile` check.
 *
 * @param context - The tree being inspected.
 * @param roots - The skills found in that tree.
 * @returns The check result.
 */
export function checkExamplesCompile(context: HarnessContext, roots: readonly SkillRoot[]): CheckResult {
  const { examples, ignored, generated, runnable } = collectExamples(context, roots);
  const notes: string[] = [];
  if (ignored.length > 0) {
    notes.push(`ignore-check blocks (not compiled): ${ignored.join(", ")}`);
  }
  if (generated > 0) {
    notes.push(`${String(generated)} blocks under references/api/ are TypeDoc @example fragments and are not compiled`);
  }
  if (runnable > 0) {
    notes.push(`${String(runnable)} \`ts run\` blocks compiled; run checks arrive in Phase 1`);
  }
  const detail = `${String(examples.length)} blocks checked, ${String(ignored.length)} skipped (ignore-check)`;
  if (examples.length === 0) {
    return passed("examples-compile", detail, notes);
  }
  const missing = missingBuilds(context.repositoryRoot, examples);
  if (missing.length > 0) {
    return failed(
      "examples-compile",
      `packages without a built dist/: ${missing.join(", ")} — run pnpm build first`,
      notes,
    );
  }
  const project = writeTemporaryProject(context.repositoryRoot, examples);
  try {
    const result = runCommand("pnpm", ["exec", "tsc", "-p", project], context.repositoryRoot);
    if (result.code !== 0) {
      const diagnostics = rewriteDiagnostics(result.output, examples);
      return failed("examples-compile", `${detail} — tsc reported errors`, [...notes, ...summarize(diagnostics, 20)]);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
  return passed("examples-compile", detail, notes);
}
