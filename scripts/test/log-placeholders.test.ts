import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The engine's logger writes a message verbatim (`packages/core/src/log/logger.ts`): nothing
 * substitutes into it, so a `{entity}` slot in a logged message is printed literally. The error
 * code tables keep their `{…}` slots (they document the message); a call site must put the values
 * into the message itself.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE = /^packages\/[^/]+\/src\/.+\.ts$/u;
/**
 * Packages another open pull request rewrites; their remaining slot (the Electron renderer's
 * "desktop host ready" line) is fixed there or in a follow-up.
 */
const SKIPPED = new Set(["packages/electron/src/renderer/extension.ts"]);
const LOG_CALL = /\.(?:debug|info|warn|warnOnce|error)\(/gu;
const PLACEHOLDER = /(?<!\$)\{[a-z][A-Za-z]*\}/gu;

/**
 * The argument text of a call, from just after its opening parenthesis to its closing one.
 *
 * @param text - The source.
 * @param start - The index just after the opening parenthesis.
 * @returns The arguments' source.
 */
function callArguments(text: string, start: number): string {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) {
        return text.slice(start, index);
      }
    }
  }
  return text.slice(start);
}

/**
 * Finds the log calls of one source whose message keeps a `{name}` slot.
 *
 * @param text - The source.
 * @returns One `line: slot` entry per offending call.
 */
function unreplacedSlots(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(LOG_CALL)) {
    const args = callArguments(text, match.index + match[0].length);
    if (args.includes(".replace")) {
      continue;
    }
    const slots = args.match(PLACEHOLDER);
    if (slots !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      found.push(`${String(line)}: ${slots.join(", ")}`);
    }
  }
  return found;
}

describe("logged engine messages", () => {
  it("flags a slot the logger would print literally, and not an interpolation", () => {
    expect(unreplacedSlots('log.warn(\n  "{entity} is rotated.",\n  name,\n);')).toEqual(["1: {entity}"]);
    expect(unreplacedSlots("log.warn(`${JSON.stringify(name)} is rotated (${String(n)}).`);")).toEqual([]);
    expect(unreplacedSlots('log.warn(TEMPLATE.replace("{entity}", name));')).toEqual([]);
  });

  it("leaves no {placeholder} in any engine log message", () => {
    const files = execFileSync("git", ["ls-files", "-z", "packages"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((file) => SOURCE.test(file) && !SKIPPED.has(file));
    const problems = files.flatMap((file) =>
      unreplacedSlots(readFileSync(path.join(ROOT, file), "utf8")).map((entry) => `${file}:${entry}`),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
