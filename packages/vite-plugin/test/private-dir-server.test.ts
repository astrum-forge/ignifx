import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { build, createServer, isFileLoadingAllowed, preview } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ignifx } from "../src/plugin.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES, writeFixture } from "./support/fixtures.js";
import { portOf, rawGet } from "./support/raw-http.js";
import type { PluginOption, PreviewServer, ViteDevServer } from "vite";

/**
 * `.ignifx/mcp.json` holds the token of the editor's MCP server for the project. These tests start
 * real servers on a loopback port and ask for it every way a browser page (or a raw socket) could.
 */

afterAll(disposeFixtures);

const TOKEN = "e27-secret-token-0123456789abcdef";
const MCP_JSON = JSON.stringify({ port: 4321, token: TOKEN, host: "127.0.0.1", url: "http://127.0.0.1:4321/mcp" });

/** A small project with the editor's private file beside an ordinary asset and page. */
function fixtureProject(): Promise<string> {
  return createFixtureTree({
    "index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
    "src/main.ts": 'document.title = "game";\n',
    "assets/sprites/hero.png": PNG_BYTES,
    "my.ignifx.txt": "not private",
    ".ignifx/mcp.json": MCP_JSON,
  });
}

/**
 * Every request form of `.ignifx/mcp.json` the fix must refuse.
 *
 * @param absoluteRoots - The project root as given and as the filesystem resolves it.
 */
function attackPaths(absoluteRoots: readonly string[]): string[] {
  const fsForms = absoluteRoots.flatMap((root) => [
    `/@fs${root}/.ignifx/mcp.json`,
    `/@fs${root}/.ignifx/mcp.json?raw`,
    `/@fs${root}/.ignifx/mcp.json?import`,
    `/@fs${root}/.ignifx/mcp.json?url`,
    `/@fs${root}/%2eignifx/mcp.json`,
    `/@fs${root}/x/../.ignifx/mcp.json`,
    `/@id/${root}/.ignifx/mcp.json?raw`,
  ]);
  return [
    "/.ignifx/mcp.json",
    "/.ignifx/mcp.json?raw",
    "/.ignifx/mcp.json?import",
    "/.ignifx/mcp.json?url",
    "/.ignifx/mcp.json?import&raw",
    "/.ignifx/mcp.json?raw&url",
    "/%2eignifx/mcp.json",
    "/%2Eignifx/mcp.json",
    "/%252eignifx/mcp.json",
    "/%25252eignifx%252fmcp.json",
    "/.ignifx%2fmcp.json",
    "/./.ignifx/mcp.json",
    "/x/../.ignifx/mcp.json",
    "/x/%2e%2e/.ignifx/mcp.json",
    "/\\.ignifx\\mcp.json",
    "/.ignifx\\mcp.json",
    "/.IGNIFX/mcp.json",
    "/.IGNIFX/MCP.JSON",
    "/.ignifx./mcp.json",
    "/@id/.ignifx/mcp.json",
    "/.ignifx/",
    ...fsForms,
  ];
}

describe("vite dev with the ignifx plugin keeps .ignifx/ private", () => {
  let root = "";
  let roots: string[] = [];
  let server: ViteDevServer;
  let port = 0;

  beforeAll(async () => {
    root = await fixtureProject();
    roots = [...new Set([root, await realpath(root)])];
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false, ws: false },
      plugins: [ignifx()],
    });
    await server.listen();
    port = portOf(server);
    return async () => {
      await server.close();
    };
  });

  it("refuses every request form of .ignifx/mcp.json with 404 or 403", async () => {
    const results = await Promise.all(
      attackPaths(roots).map(async (path) => Object.assign(await rawGet(port, path), { path })),
    );
    for (const { path, status, body } of results) {
      expect([404, 403], path).toContain(status);
      expect(body, path).not.toContain(TOKEN);
    }
  });

  it("refuses them from another localhost origin too", async () => {
    const response = await rawGet(port, "/.ignifx/mcp.json?raw", { Origin: "http://localhost:3000" });
    expect(response.status).toBe(404);
    expect(response.body).not.toContain(TOKEN);
  });

  it("still serves ordinary files", async () => {
    const asset = await rawGet(port, "/assets/sprites/hero.png");
    expect(asset.status).toBe(200);
    const text = await rawGet(port, "/my.ignifx.txt");
    expect(text.status).toBe(200);
    expect(text.body).toBe("not private");
    const page = await rawGet(port, "/", { Accept: "text/html" });
    expect(page.status).toBe(200);
  });

  it("denies .ignifx/ through server.fs.deny, with Vite's defaults kept", () => {
    const { deny } = server.config.server.fs;
    expect(deny).toEqual(expect.arrayContaining([".ignifx", "**/.ignifx/**", ".env", "**/.git/**"]));
    for (const base of roots) {
      expect(isFileLoadingAllowed(server.config, `${base}/.ignifx/mcp.json`)).toBe(false);
      expect(isFileLoadingAllowed(server.config, `${base}/.IGNIFX/mcp.json`)).toBe(false);
    }
  });
});

describe("server.fs.deny merging", () => {
  it("keeps a deny list the user set and adds .ignifx/ to it", async () => {
    const root = await fixtureProject();
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, ws: false, fs: { deny: ["secrets/**"] } },
      plugins: [ignifx()],
    });
    try {
      expect(server.config.server.fs.deny).toEqual(["secrets/**", ".ignifx", "**/.ignifx/**"]);
    } finally {
      await server.close();
    }
  });
});

describe("vite build and vite preview with the ignifx plugin", () => {
  let root = "";
  let server: PreviewServer;
  let port = 0;

  beforeAll(async () => {
    root = await fixtureProject();
    // The worst case for the asset scan: the whole project as the asset root.
    const plugins: PluginOption[] = [ignifx({ assetRoot: "." })];
    await build({ root, configFile: false, logLevel: "silent", plugins, build: { outDir: "dist", emptyOutDir: true } });
    server = await preview({
      root,
      configFile: false,
      logLevel: "silent",
      preview: { host: "127.0.0.1", port: 0, strictPort: false },
      plugins,
    });
    port = portOf(server);
    return async () => {
      await server.close();
    };
  });

  it("never copies .ignifx/ into dist", async () => {
    const outDir = join(root, "dist");
    const files = (await readdir(outDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    expect(files.length).toBeGreaterThan(0);
    const segments = files.flatMap((file) => relative(outDir, file).toLowerCase().split(sep));
    // The scan did copy the project's other files, a hashed `my.ignifx.txt` among them.
    expect(segments.some((segment) => segment.startsWith("my.ignifx."))).toBe(true);
    expect(segments).not.toContain(".ignifx");
    const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
    expect(contents.some((text) => text.includes(TOKEN))).toBe(false);
  });

  it("refuses every request form under vite preview, even if dist held the file", async () => {
    // Plant the file in `dist` as a stray copy would, so a 404 proves the guard and not its absence.
    await writeFixture(root, "dist/.ignifx/mcp.json", MCP_JSON);
    const distRoots = [...new Set([join(root, "dist"), join(await realpath(root), "dist")])];
    const results = await Promise.all(
      attackPaths(distRoots).map(async (path) => Object.assign(await rawGet(port, path), { path })),
    );
    for (const { path, status, body } of results) {
      expect([404, 403], path).toContain(status);
      expect(body, path).not.toContain(TOKEN);
    }
  });

  it("still serves the built page", async () => {
    const page = await rawGet(port, "/", { Accept: "text/html" });
    expect(page.status).toBe(200);
    expect(page.body).toContain("<script");
  });
});
