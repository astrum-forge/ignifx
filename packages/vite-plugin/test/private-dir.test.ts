import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";
import {
  findPrivateOutputs,
  hasPrivateSegment,
  isPrivateRealPath,
  isPrivateRequestPath,
  PRIVATE_DIR_DENY,
  privateDirDenyPatterns,
  VITE_DEFAULT_FS_DENY,
} from "../src/private-dir.js";

describe("isPrivateRequestPath", () => {
  it.each([
    "/.ignifx/mcp.json",
    "/.ignifx",
    "/.ignifx/",
    "/.ignifx/mcp.json?raw",
    "/.ignifx/mcp.json?import",
    "/.ignifx/mcp.json?url",
    "/.ignifx/mcp.json#x",
    "/@fs/Users/me/game/.ignifx/mcp.json",
    "/@fs/C:/Users/me/game/.ignifx/mcp.json",
    "/@id/.ignifx/mcp.json",
    "/@id//Users/me/game/.ignifx/mcp.json?raw",
    "/%2eignifx/mcp.json",
    "/%2Eignifx/mcp.json",
    "/%252eignifx/mcp.json",
    "/%25252eignifx/mcp.json",
    "/%2e%69%67%6e%69%66%78/mcp.json",
    "/x%2f.ignifx/mcp.json",
    "/x%5c.ignifx%5cmcp.json",
    "/./.ignifx/mcp.json",
    "/x/../.ignifx/mcp.json",
    "/x/%2e%2e/.ignifx/mcp.json",
    "/\\.ignifx\\mcp.json",
    "\\.ignifx/mcp.json",
    "/.IGNIFX/mcp.json",
    "/.Ignifx/MCP.JSON",
    "/.ignifx./mcp.json",
    "/.ignifx%20/mcp.json",
    "/.ignifx::$INDEX_ALLOCATION/mcp.json",
    "/IGNIFX~1/mcp.json",
    "/.ignifx%3f/mcp.json",
    "/base/sub/.ignifx/mcp.json",
    "/%E0%A4%A/.ignifx/mcp.json",
  ])("refuses %s", (url) => {
    expect(isPrivateRequestPath(url)).toBe(true);
  });

  it.each([
    "/",
    "/index.html",
    "/assets/sprites/hero.png",
    "/src/main.ts?import",
    "/ignifx.settings.json",
    "/my.ignifx.txt",
    "/.ignifx-notes/readme.txt",
    "/.ignifxrc",
    "/@fs/Users/me/game/node_modules/.vite/deps/ignifx.js",
    "/search?q=.ignifx/mcp.json",
    "/%E0%A4%A/ok.txt",
  ])("passes %s", (url) => {
    expect(isPrivateRequestPath(url)).toBe(false);
  });

  it("fails closed when escapes are nested deeper than it decodes", () => {
    const deep = `/%${"25".repeat(20)}2eignifx/mcp.json`;
    expect(isPrivateRequestPath(deep)).toBe(true);
  });
});

describe("privateDirDenyPatterns", () => {
  it("restates Vite's defaults when the user set no deny list", () => {
    expect(privateDirDenyPatterns(undefined)).toEqual([...VITE_DEFAULT_FS_DENY, ...PRIVATE_DIR_DENY]);
  });

  it("adds only its own patterns to a list the user set, which Vite concatenates", () => {
    expect(privateDirDenyPatterns(["secrets/**"])).toEqual([...PRIVATE_DIR_DENY]);
  });

  it("matches the deny defaults of the Vite in use", async () => {
    const root = await mkdtemp(join(tmpdir(), "ignifx-private-dir-"));
    try {
      const config = await resolveConfig({ root, configFile: false, logLevel: "silent" }, "serve");
      expect([...VITE_DEFAULT_FS_DENY]).toEqual(config.server.fs.deny);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("hasPrivateSegment", () => {
  it.each([".ignifx", "a/.IGNIFX/b", "a\\.ignifx.\\b", "../.ignifx/mcp.json"])("finds %s", (path) => {
    expect(hasPrivateSegment(path)).toBe(true);
  });

  it.each(["", "a/b", "my.ignifx.txt", "../.ignifx-notes/x"])("passes %s", (path) => {
    expect(hasPrivateSegment(path)).toBe(false);
  });
});

/**
 * A project inside a directory that is itself named `.ignifx`, with a link into its own private
 * directory.
 */
async function nestedProject(): Promise<{ base: string; root: string }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "ignifx-private-real-")));
  const root = join(base, ".ignifx", "game");
  await mkdir(join(root, ".ignifx"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, ".ignifx", "mcp.json"), "{}");
  await writeFile(join(root, "src", "main.ts"), "");
  await symlink("../.ignifx", join(root, "src", "link"));
  await symlink("loop", join(root, "src", "loop"));
  return { base, root };
}

describe.skipIf(process.platform === "win32")("isPrivateRealPath and findPrivateOutputs", () => {
  it("judges only the part of the real path below the root's common ancestor", async () => {
    const { base, root } = await nestedProject();
    try {
      expect(isPrivateRealPath(root, join(root, "src", "main.ts"))).toBe(false);
      expect(isPrivateRealPath(root, join(root, "src", "missing", "deeper.ts"))).toBe(false);
      expect(isPrivateRealPath(root, join(root, "src", "link", "mcp.json"))).toBe(true);
      expect(isPrivateRealPath(root, join(root, "src", "link", "absent", "x.json"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("fails closed on a link loop", async () => {
    const { base, root } = await nestedProject();
    try {
      expect(isPrivateRealPath(root, join(root, "src", "loop", "x"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("lists links into .ignifx/ and unresolvable links, and nothing for a missing directory", async () => {
    const { base, root } = await nestedProject();
    try {
      expect(await findPrivateOutputs(join(root, "dist"), null)).toEqual([]);
      expect(await findPrivateOutputs(join(root, "src"), join(root, "missing-public"))).toEqual([
        join(root, "src", "link"),
        join(root, "src", "loop"),
      ]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
