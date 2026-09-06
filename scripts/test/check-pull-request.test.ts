import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkFreshness } from "../lib/check-pull-request.ts";
import type { HarnessContext } from "../lib/check-result.ts";

/**
 * The `freshness` gate against a real, throw-away git repository: it keys on a package's API
 * report changing, not on any `src/` edit, because a refactor that keeps the public surface
 * regenerates to the same reference bytes and must not read as stale (16 §4).
 */

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function write(root: string, relative: string, contents: string): void {
  const target = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

/** A committed repository with one package, its API report, and its generated reference. */
function repository(): { root: string; context: HarnessContext } {
  const root = mkdtempSync(path.join(tmpdir(), "ignifx-freshness-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "harness@example.invalid");
  git(root, "config", "user.name", "harness");
  write(root, "packages/foo/src/index.ts", "export const a = 1;\n");
  write(root, "packages/foo/api/foo.api.md", "## API Report\nexport const a: number;\n");
  write(root, "skills/ignifx/references/api/foo.md", "# foo\n\n`a`\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const context: HarnessContext = {
    repositoryRoot: root,
    skillsDirectory: path.join(root, "skills", "ignifx"),
    releaseVersion: "0.0.0",
    base: "HEAD",
    allowDocsNotNeeded: false,
  };
  return { root, context };
}

describe("freshness", () => {
  it("is not stale when only src/ changed and the public surface did not", () => {
    const { root, context } = repository();
    write(root, "packages/foo/src/index.ts", "export const a = 1; // refactor\n");
    const result = checkFreshness(context);
    expect(result.status).toBe("pass");
  });

  it("is stale when the API report changed and the reference did not", () => {
    const { root, context } = repository();
    write(root, "packages/foo/api/foo.api.md", "## API Report\nexport const a: number;\nexport const b: number;\n");
    const result = checkFreshness(context);
    expect(result.status).toBe("fail");
    expect(result.notes.join("\n")).toContain("skills/ignifx/references/api/foo.md was not regenerated");
  });

  it("passes when the API report and the reference changed together", () => {
    const { root, context } = repository();
    write(root, "packages/foo/api/foo.api.md", "## API Report\nexport const a: number;\nexport const b: number;\n");
    write(root, "skills/ignifx/references/api/foo.md", "# foo\n\n`a`, `b`\n");
    const result = checkFreshness(context);
    expect(result.status).toBe("pass");
  });
});
