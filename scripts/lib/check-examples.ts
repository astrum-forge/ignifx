/**
 * The `examples-compile` check of the documentation harness
 * (`docs/architecture/16-docs-harness-and-skill.md` §4). Every fenced block whose info string
 * starts with `ts` is written to a throw-away project outside the repository and type-checked
 * against the built packages. Blocks tagged `ts run` are compiled here as well and then executed by
 * `examples-run` (`check-examples-run.ts`); `skill-examples.ts` collects both sets.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { failed, passed, summarize } from "./check-result.ts";
import { runCommand } from "./run.ts";
import { collectSkillExamples, missingBuilds } from "./skill-examples.ts";
import type { CheckResult, HarnessContext } from "./check-result.ts";
import type { SkillExample } from "./skill-examples.ts";
import type { SkillRoot } from "./skill-files.ts";

// Re-exported so the entry script reaches both example checks through one module.
export { checkExamplesRun } from "./check-examples-run.ts";

/**
 * Writes the temporary project that the examples are type-checked in.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param examples - The blocks to type-check.
 * @returns Absolute path to the temporary project directory.
 */
function writeTemporaryProject(repositoryRoot: string, examples: readonly SkillExample[]): string {
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
      // `node` as well as `@webgpu/types`: a headless example may legitimately reach for
      // `node:fs/promises` (how a Node app feeds `createApp({ fetch })` real project files).
      types: ["@webgpu/types", "node"],
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
 * Rewrites tsc diagnostics so they point at the Markdown file and line the block came from.
 *
 * @param output - Raw tsc output.
 * @param examples - The blocks that were written to the temporary project.
 * @returns The diagnostic lines, relocated onto the source Markdown.
 */
function rewriteDiagnostics(output: string, examples: readonly SkillExample[]): readonly string[] {
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
  const { examples, ignored, generated } = collectSkillExamples(context, roots);
  const runnable = examples.filter((example) => example.run).length;
  const notes: string[] = [];
  if (ignored.length > 0) {
    notes.push(`ignore-check blocks (not compiled): ${ignored.join(", ")}`);
  }
  if (generated > 0) {
    notes.push(`${String(generated)} blocks under references/api/ are TypeDoc @example fragments and are not compiled`);
  }
  if (runnable > 0) {
    notes.push(`${String(runnable)} \`ts run\` blocks are compiled here and executed by examples-run`);
  }
  const detail = `${String(examples.length)} blocks checked, ${String(ignored.length)} skipped (ignore-check)`;
  if (examples.length === 0) {
    return passed("examples-compile", detail, notes);
  }
  const missing = missingBuilds(context.repositoryRoot, examples, "index.d.ts");
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
