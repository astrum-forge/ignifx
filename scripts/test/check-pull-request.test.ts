import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apiReferenceFor, checkFreshness, staleApiReferences } from "../lib/check-pull-request.ts";
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

/** A committed repository with one package, a root and a subpath API report, and their generated references. */
function repository(): { root: string; context: HarnessContext } {
  const root = mkdtempSync(path.join(tmpdir(), "ignifx-freshness-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "harness@example.invalid");
  git(root, "config", "user.name", "harness");
  write(root, "packages/foo/src/index.ts", "export const a = 1;\n");
  write(root, "packages/foo/api/foo.api.md", "## API Report\nexport const a: number;\n");
  write(root, "skills/ignifx/references/api/foo.md", "# foo\n\n`a`\n");
  write(root, "packages/foo/api/foo-sub.api.md", "## API Report\nexport const s: number;\n");
  write(root, "skills/ignifx/references/api/foo-sub.md", "# foo/sub\n\n`s`\n");
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

  it("pairs a subpath report with its own reference, not the package root's (engine PR #171)", () => {
    const { root, context } = repository();
    write(root, "packages/foo/api/foo-sub.api.md", "## API Report\nexport const s: string;\n");
    write(root, "skills/ignifx/references/api/foo-sub.md", "# foo/sub\n\n`s: string`\n");
    expect(checkFreshness(context).status).toBe("pass");
  });

  it("is stale when a subpath report changed and only the root reference was regenerated", () => {
    const { root, context } = repository();
    write(root, "packages/foo/api/foo-sub.api.md", "## API Report\nexport const s: string;\n");
    write(root, "skills/ignifx/references/api/foo.md", "# foo\n\n`a` (edited)\n");
    const result = checkFreshness(context);
    expect(result.status).toBe("fail");
    expect(result.notes.join("\n")).toContain(
      "skills/ignifx/references/api/foo-sub.md was not regenerated although packages/foo/api/foo-sub.api.md changed",
    );
  });

  it("passes when a deleted entry point's report and reference are deleted together", () => {
    const { root, context } = repository();
    rmSync(path.join(root, "packages/foo/api/foo-sub.api.md"));
    rmSync(path.join(root, "skills/ignifx/references/api/foo-sub.md"));
    expect(checkFreshness(context).status).toBe("pass");
  });

  it("is stale when a deleted entry point's reference is left behind", () => {
    const { root, context } = repository();
    rmSync(path.join(root, "packages/foo/api/foo-sub.api.md"));
    expect(checkFreshness(context).status).toBe("fail");
  });
});

describe("staleApiReferences", () => {
  const references = "skills/ignifx/references/api";

  it("passes engine PR #171's changed-file list", () => {
    const pr171 = [
      ".changeset/cli-browser-scaffold-tsconfig.md",
      ".changeset/electron-frame-aware-csp.md",
      "docs/adr/0028-edit-mode.md",
      "docs/adr/0029-mesh-asset-files.md",
      "docs/architecture/14-platform-electron.md",
      "packages/cli/src/copy-template.ts",
      "packages/cli/test/cli.test.ts",
      "packages/electron/api/electron-main.api.md",
      "packages/electron/skills/electron/SKILL.md",
      "packages/electron/src/error-codes.ts",
      "packages/electron/src/errors.ts",
      "packages/electron/src/main.ts",
      "packages/electron/src/main/csp.ts",
      "packages/electron/src/main/ipc.ts",
      "packages/electron/src/main/main-error.ts",
      "packages/electron/src/main/origin.ts",
      "packages/electron/src/main/protocol.ts",
      "packages/electron/src/main/window.ts",
      "packages/electron/test/ipc.test.ts",
      "packages/electron/test/main-imports.test.ts",
      "packages/electron/test/protocol.test.ts",
      "packages/electron/test/security.test.ts",
      "packages/electron/test/support/electron-mock.ts",
      "packages/electron/test/window.test.ts",
      "skills/ignifx/references/api/cli.md",
      "skills/ignifx/references/api/electron-main.md",
    ];
    expect(staleApiReferences(pr171)).toEqual([]);
  });

  it("passes a root report changed with the root reference", () => {
    expect(staleApiReferences(["packages/core/api/core.api.md", `${references}/core.md`])).toEqual([]);
  });

  it("fails a subpath report changed without its own reference", () => {
    expect(staleApiReferences(["packages/electron/api/electron-main.api.md"])).toEqual([
      `${references}/electron-main.md was not regenerated although packages/electron/api/electron-main.api.md changed`,
    ]);
  });

  it("fails a subpath report changed when only the root reference changed", () => {
    expect(
      staleApiReferences(["packages/electron/api/electron-main.api.md", `${references}/electron.md`]),
    ).toHaveLength(1);
  });

  it("requires each changed report's own reference", () => {
    const changed = [
      "packages/electron/api/electron.api.md",
      "packages/electron/api/electron-main.api.md",
      "packages/electron/api/electron-preload.api.md",
      `${references}/electron-main.md`,
    ];
    expect(staleApiReferences(changed).map((line) => line.split(" ")[0])).toEqual([
      `${references}/electron-preload.md`,
      `${references}/electron.md`,
    ]);
    expect(staleApiReferences([...changed, `${references}/electron.md`, `${references}/electron-preload.md`])).toEqual(
      [],
    );
  });
});

/** The value of a top-level string field in a JSON-with-comments config. */
function field(source: string, name: string): string | undefined {
  return new RegExp(`"${name}":\\s*\\[?\\s*"([^"]+)"`, "u").exec(source)?.[1];
}

describe("apiReferenceFor", () => {
  it("returns null for anything but an API report", () => {
    expect(apiReferenceFor("packages/core/src/index.ts")).toBeNull();
    expect(apiReferenceFor("skills/ignifx/references/api/core.md")).toBeNull();
  });

  it("agrees with every package's API Extractor and TypeDoc configs", () => {
    const packages = path.resolve(import.meta.dirname, "../../packages");
    let pairs = 0;
    for (const directory of readdirSync(packages)) {
      const files = readdirSync(path.join(packages, directory));
      const typedoc = files
        .filter((file) => /^typedoc(\.[^.]+)?\.json$/u.test(file))
        .map((file) => readFileSync(path.join(packages, directory, file), "utf8"));
      for (const file of files.filter((name) => /^api-extractor(\.[^.]+)?\.json$/u.test(name))) {
        const extractor = readFileSync(path.join(packages, directory, file), "utf8");
        const entry = /\/dist\/(.+)\.d\.ts$/u.exec(field(extractor, "mainEntryPointFilePath") ?? "")?.[1];
        const report = field(extractor, "reportFileName");
        const page = typedoc.find((source) => field(source, "entryPoints") === `src/${String(entry)}.ts`);
        expect(field(extractor, "reportFolder"), `${directory}/${file}`).toBe("<projectFolder>/api");
        expect(page, `${directory}/${file} has no TypeDoc config for src/${String(entry)}.ts`).toBeDefined();
        expect(field(page ?? "", "out")).toBe("../../skills/ignifx/references/api");
        expect(apiReferenceFor(`packages/${directory}/api/${String(report)}`)).toBe(
          `skills/ignifx/references/api/${String(field(page ?? "", "entryFileName"))}.md`,
        );
        pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThan(20);
  });
});
