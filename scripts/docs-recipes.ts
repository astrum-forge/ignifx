#!/usr/bin/env node
/**
 * `pnpm docs:recipes` — turns the compiled example programs under `examples/recipes/` into the
 * skill's recipe pages (`docs/architecture/16-docs-harness-and-skill.md` §3), so recipe prose can
 * never disagree with code that compiles.
 *
 * ## Extraction convention
 *
 * One recipe is one directory, `examples/recipes/<name>/`, whose entry point is `main.ts`:
 *
 * - the first `/**` block comment in `main.ts` is the prose; its first line is the recipe
 *   title, the rest is the body, and the leading ` * ` markers are stripped;
 * - everything after that comment is the recipe code, emitted as a fenced `ts` block, which the
 *   harness then type-checks like any other example;
 * - the code is capped at 80 lines (§5 "one recipe = one task, ≤ 80 lines").
 *
 * Output is `skills/ignifx/references/recipes/<name>.md`, one file per directory. The script only
 * writes those files, so the hand-written `recipes/README.md` survives regeneration.
 *
 * Options: `--root <dir>` runs against a tree other than the repository (used by the tests).
 */
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { exists, listDirectories, writeGeneratedFile } from "./lib/fs-tree.ts";
import { log, logError } from "./lib/log.ts";
import { extractRecipe, renderRecipePage, RECIPE_MAX_CODE_LINES } from "./lib/recipe.ts";
import { repositoryRoot } from "./lib/workspace.ts";

/**
 * Runs the generator.
 *
 * @returns The process exit code.
 */
function main(): number {
  const parsed = parseArguments(process.argv.slice(2), ["root"]);
  const root = path.resolve(parsed.options.get("root") ?? repositoryRoot(import.meta.url));
  const recipesDirectory = path.join(root, "examples", "recipes");
  const outputDirectory = path.join(root, "skills", "ignifx", "references", "recipes");

  const errors: string[] = [];
  let written = 0;
  for (const name of listDirectories(recipesDirectory)) {
    const entry = path.join(recipesDirectory, name, "main.ts");
    if (!exists(entry)) {
      errors.push(`examples/recipes/${name}: no main.ts (every recipe directory needs one)`);
      continue;
    }
    const recipe = extractRecipe(name, entry);
    if (recipe.errors.length > 0) {
      errors.push(...recipe.errors.map((message) => `examples/recipes/${name}: ${message}`));
      continue;
    }
    if (recipe.recipe === null) {
      continue;
    }
    writeGeneratedFile(path.join(outputDirectory, `${name}.md`), renderRecipePage(recipe.recipe));
    written += 1;
  }

  if (errors.length > 0) {
    for (const message of errors) {
      logError(`docs:recipes — ${message}`);
    }
    logError(`docs:recipes — recipe code is capped at ${String(RECIPE_MAX_CODE_LINES)} lines`);
    return 1;
  }
  log(`docs:recipes — ${String(written)} ${written === 1 ? "recipe" : "recipes"}`);
  return 0;
}

process.exitCode = main();
