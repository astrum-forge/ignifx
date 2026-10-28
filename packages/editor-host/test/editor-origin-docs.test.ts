import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The packaged editor's origin as the host's docs, skill and examples name it. The templates hold
 * the one value, which the editor serves its window from; `ignifx://app` is a packaged game's, and a
 * project that copies it from the skill is never framed by the editor.
 */

const REPOSITORY = new URL("../../../", import.meta.url);

/** The game's packaged origin, not followed by more of a scheme or host name. */
const GAME_ORIGIN = /(?<![\w-])ignifx:\/\/app(?![\w-])/u;

/**
 * Reads a file of the repository.
 *
 * @param path - Its path from the repository's root.
 * @returns Its text.
 */
function read(path: string): string {
  return readFileSync(new URL(path, REPOSITORY), "utf8");
}

/**
 * The host's sources, its skill and its architecture document, from the repository's root.
 *
 * @returns Their paths.
 */
function hostTexts(): string[] {
  const sources = readdirSync(new URL("packages/editor-host/src/", REPOSITORY), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .map((path) => join("packages/editor-host/src", path));
  return [...sources, "packages/editor-host/skills/editor-host/SKILL.md", "docs/architecture/17-editor-host.md"];
}

describe("the packaged editor's origin in the host's docs", () => {
  it("is the one the templates fall back to", () => {
    const template = /const PACKAGED_EDITOR_ORIGIN = "(?<origin>[^"]+)";/u.exec(
      read("templates/3d-third-person/vite.config.ts"),
    );
    const skill = /IGNIFX_EDITOR_ORIGIN \?\? "(?<origin>[^"]+)"/u.exec(
      read("packages/editor-host/skills/editor-host/SKILL.md"),
    );
    expect(template?.groups?.["origin"]).toBe("ignifx-editor://app");
    expect(skill?.groups?.["origin"]).toBe(template?.groups?.["origin"]);
  });

  it("is never the packaged game's", () => {
    expect(hostTexts().filter((path) => GAME_ORIGIN.test(read(path)))).toEqual([]);
  });
});
