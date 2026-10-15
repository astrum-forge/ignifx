import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tracked text files must be plain UTF-8 text. A raw control byte such as NUL makes `grep` and
 * `file` treat the file as binary, so searches skip it silently; write `"\u0000"` instead.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|html|css|wgsl)$/u;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * Finds the first thing that makes one file unreadable as text.
 *
 * @param bytes - The file's contents.
 * @returns A short reason, or `undefined` when the file is clean UTF-8 text.
 */
function textProblem(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "not valid UTF-8";
  }
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 && code !== TAB && code !== LINE_FEED && code !== CARRIAGE_RETURN) {
      const line = text.slice(0, index).split("\n").length;
      return `raw control character U+${code.toString(16).padStart(4, "0")} on line ${String(line)}`;
    }
  }
  return undefined;
}

describe("source encoding", () => {
  it("reports a raw NUL byte and invalid UTF-8", () => {
    expect(textProblem(new TextEncoder().encode("const a = 1;\nconst b = `x\0y`;\n"))).toBe(
      "raw control character U+0000 on line 2",
    );
    expect(textProblem(Uint8Array.of(0x61, 0xff, 0x62))).toBe("not valid UTF-8");
    expect(textProblem(new TextEncoder().encode("tabs\tand “quotes” are fine\r\n"))).toBeUndefined();
  });

  it("keeps every tracked text file valid UTF-8 without raw control characters", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((file) => TEXT_FILE.test(file));
    const problems = files.flatMap((file) => {
      const problem = textProblem(readFileSync(path.join(ROOT, file)));
      return problem === undefined ? [] : [`${file}: ${problem}`];
    });
    expect(files.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
