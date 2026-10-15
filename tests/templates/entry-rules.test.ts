import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { templatePaths } from "./headless-app.js";

/**
 * The entry rules every editor-ready template keeps (ignifx-editor plan, engine ask E2): the level
 * is a scene file rather than `src/level.ts`, the extension list is `src/extensions.ts`, and nothing
 * the entry imports reaches a script at run time except through `virtual:ignifx/scripts`.
 */

/** The editor-ready templates. */
const TEMPLATES = ["2d-topdown", "3d-third-person", "3d-first-person"] as const;

/**
 * The templates whose scene loads in an app built from the extensions and the scripts alone, as
 * `@ignifx/editor-host` builds one: nothing under `src/` publishes an asset before the load.
 */
const PUBLISH_NOTHING = ["3d-third-person"] as const;

/**
 * Every TypeScript file under a directory, recursively.
 *
 * @param directory - Where to start.
 * @returns Absolute paths.
 */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(directory, entry.name)]
        : [],
  );
}

/**
 * The value imports of `src/scripts/**` made from outside it.
 *
 * @param source - A template's `src/` directory.
 * @returns `file: specifier` for each offending import.
 */
function runtimeScriptImports(source: string): string[] {
  const offenders: string[] = [];
  for (const file of sources(source)) {
    const path = relative(source, file);
    if (path.startsWith("scripts/")) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bimport\s*(type\s)?[^;"']*?["']([^"']+)["']/gu)) {
      const isTypeOnly = match[1] !== undefined;
      const specifier = match[2] ?? "";
      if (!isTypeOnly && /(?:^|\/)scripts\//u.test(specifier)) {
        offenders.push(`${path}: ${specifier}`);
      }
    }
  }
  return offenders;
}

describe.each(TEMPLATES)("%s's entry", (name) => {
  const { assetDir, sourceDir } = templatePaths(name);

  it("has no level.ts: the level is the scene file", () => {
    expect(existsSync(join(sourceDir, "level.ts"))).toBe(false);
    expect(existsSync(join(assetDir, "scenes", "main.scene.json"))).toBe(true);
  });

  it("exports its extension list from src/extensions.ts", () => {
    const main = readFileSync(join(sourceDir, "main.ts"), "utf8");
    expect(readFileSync(join(sourceDir, "extensions.ts"), "utf8")).toContain("export function extensions()");
    expect(main).toContain("extensions: extensions()");
    expect(main).toContain(`loadScene(MAIN_SCENE)`);
  });

  // ignifx-editor spike S0.1 §6: an edit to a script that a module of the entry imports at run time
  // dead-ends at `main.ts` and reloads every page on the dev server. `import type` is erased first.
  it("reaches src/scripts/** only through virtual:ignifx/scripts", () => {
    expect(runtimeScriptImports(sourceDir)).toEqual([]);
    expect(readFileSync(join(sourceDir, "main.ts"), "utf8")).toContain('from "virtual:ignifx/scripts"');
  });
});

describe.each(PUBLISH_NOTHING)("%s's scene", (name) => {
  const { sourceDir } = templatePaths(name);

  // ignifx-editor plan, engine ask E15: the editor's scene view loads the scene with no game code
  // before it, so a primitive mesh has to be a `.mesh.json` file rather than something `main.ts`
  // publishes with `assets.register`.
  it("needs no asset published in code: the primitive meshes are files", () => {
    expect(existsSync(join(sourceDir, "level-meshes.ts"))).toBe(false);
    const publishers = sources(sourceDir).filter((file) => /\bassets\.register\(/u.test(readFileSync(file, "utf8")));
    expect(publishers).toEqual([]);
  });
});
