import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `@ignifx/electron/main` runs in Electron's Node main process, which never renders: it must not
 * import `@ignifx/core` (the engine kernel and its Babylon Lite imports), directly or through a
 * shared module. Walks the entry's relative imports and checks every bare specifier it reaches.
 */

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * Collects the bare specifiers an entry's module graph imports, following relative imports.
 *
 * @param entry - Absolute path of the entry module.
 * @returns Every non-relative specifier reached.
 */
function bareImportsOf(entry: string): Set<string> {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() ?? "";
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)";/gmsu)) {
      const specifier = match[1] ?? "";
      if (specifier.startsWith(".")) {
        pending.push(resolve(dirname(file), specifier.replace(/\.js$/u, ".ts")));
      } else {
        bare.add(specifier);
      }
    }
  }
  return bare;
}

describe("the @ignifx/electron/main import graph", () => {
  it("never reaches @ignifx/core", () => {
    const imports = bareImportsOf(resolve(SOURCE, "main.ts"));

    expect(imports.has("electron")).toBe(true);
    expect([...imports].filter((specifier) => specifier.startsWith("@ignifx/"))).toEqual([]);
  });

  it("is a real check: the renderer entry does reach @ignifx/core", () => {
    expect(bareImportsOf(resolve(SOURCE, "index.ts")).has("@ignifx/core")).toBe(true);
  });
});
