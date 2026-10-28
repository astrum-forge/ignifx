import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The host's `.ignifx/` guard is a copy of `@ignifx/vite-plugin`'s, because that package is only an
 * optional peer (editor B7). Below each file's header comment the two must stay byte-identical, so
 * a fix to one guard cannot miss the other.
 */

const PACKAGES = new URL("../../", import.meta.url);

/**
 * Reads a source file and drops its header comment.
 *
 * @param path - Its path from `packages/`.
 * @returns The text after the first `*\/` line.
 */
function belowHeader(path: string): string {
  const text = readFileSync(new URL(path, PACKAGES), "utf8");
  const end = text.indexOf("*/\n");
  expect(end).toBeGreaterThan(0);
  return text.slice(end + "*/\n".length);
}

describe("the editor host's copy of the .ignifx/ guard", () => {
  it("is byte-identical to @ignifx/vite-plugin's below the header comment", () => {
    const original = belowHeader("vite-plugin/src/private-dir.ts");
    const copy = belowHeader("editor-host/src/vite/private-dir.ts");
    expect(copy.length).toBeGreaterThan(1000);
    // Compared as booleans first, so a mismatch names the first differing line, not two whole files.
    const originalLines = original.split("\n");
    const copyLines = copy.split("\n");
    const firstDifference = originalLines.findIndex((line, index) => line !== copyLines[index]);
    expect(
      firstDifference === -1
        ? null
        : { line: firstDifference, original: originalLines[firstDifference], copy: copyLines[firstDifference] },
    ).toBeNull();
    expect(copy === original).toBe(true);
  });
});
