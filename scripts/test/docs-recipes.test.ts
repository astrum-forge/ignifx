import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../lib/run.ts";
import { REPOSITORY_ROOT } from "./support/skill-tree.ts";

const trees: string[] = [];

/** The recipe source every fixture uses: a doc comment, then the code. */
const MAIN_TS = `/**
 * Spawn a prefab
 *
 * Loads a prefab and stamps a copy of it out.
 */
export const answer = 42;
`;

/**
 * Writes a tree holding one recipe, optionally with an index that lists it.
 *
 * @param indexRow - Whether `references/recipes/README.md` gets a row for the recipe.
 * @returns Absolute path to the tree.
 */
function writeTree(indexRow: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), "ignifx-recipes-fixture-"));
  trees.push(root);
  mkdirSync(path.join(root, "examples", "recipes", "spawn-a-prefab"), { recursive: true });
  writeFileSync(path.join(root, "examples", "recipes", "spawn-a-prefab", "main.ts"), MAIN_TS, "utf8");
  const output = path.join(root, "skills", "ignifx", "references", "recipes");
  mkdirSync(output, { recursive: true });
  const index = `# Recipes\n\n| Recipe | Task |\n|---|---|\n${
    indexRow ? "| [`spawn-a-prefab`](spawn-a-prefab.md) | Stamp a prefab out |\n" : ""
  }`;
  writeFileSync(path.join(output, "README.md"), index, "utf8");
  return root;
}

/**
 * Runs the generator against a fixture tree.
 *
 * @param root - The tree to generate into.
 * @returns The exit code and output.
 */
function generate(root: string): { readonly code: number; readonly output: string } {
  return runCommand("node", [path.join("scripts", "docs-recipes.ts"), "--root", root], REPOSITORY_ROOT);
}

afterEach(() => {
  for (const tree of trees.splice(0)) {
    rmSync(tree, { recursive: true, force: true });
  }
});

describe("docs:recipes", () => {
  it("writes one page per recipe directory", () => {
    const root = writeTree(true);
    const result = generate(root);
    expect(result.output).toContain("docs:recipes — 1 recipe");
    expect(result.code).toBe(0);
    const page = readFileSync(
      path.join(root, "skills", "ignifx", "references", "recipes", "spawn-a-prefab.md"),
      "utf8",
    );
    expect(page).toContain("# Spawn a prefab");
    expect(page).toContain("```ts");
  });

  it("fails when the recipe has no row in the index", () => {
    const result = generate(writeTree(false));
    expect(result.code).toBe(1);
    expect(result.output).toContain("no row in references/recipes/README.md");
  });
});
