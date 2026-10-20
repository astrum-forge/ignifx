import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";
import {
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
