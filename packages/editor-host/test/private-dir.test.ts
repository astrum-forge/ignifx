import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { build, createServer, preview } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editorHostPlugin } from "../src/vite/plugin.js";
import { isPrivateRequestPath } from "../src/vite/private-dir.js";
import { createFixtureTree, disposeFixtures } from "./support/fixtures.js";
import type { AddressInfo } from "node:net";
import type { PreviewServer, ViteDevServer } from "vite";

/**
 * The editor host's copy of the `.ignifx/` guard, on real `vite dev` and `vite preview` servers
 * whose config lists `editorHostPlugin()` without `ignifx()`.
 */

afterAll(disposeFixtures);

const TOKEN = "e28-editor-host-token-0123456789";
const MCP_JSON = JSON.stringify({ port: 4321, token: TOKEN, host: "127.0.0.1", url: "http://127.0.0.1:4321/mcp" });
const EDITOR_ORIGIN = "ignifx://app";

/** Windows needs a privilege to create symbolic links; CI runs these on macOS and Linux. */
const linksUnsupported = process.platform === "win32";

/** A project with the editor's private file and a link to its directory. */
async function project(): Promise<string> {
  const root = await createFixtureTree({
    "index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
    "src/main.ts": 'document.title = "game";\n',
    "my.ignifx.txt": "not private",
    ".ignifx/mcp.json": MCP_JSON,
  });
  if (!linksUnsupported) {
    await symlink("../.ignifx", join(root, "src", "link"));
    await symlink("../.ignifx/mcp.json", join(root, "src", "tok.json"));
    await mkdir(join(root, "public"), { recursive: true });
    await symlink("../.ignifx/mcp.json", join(root, "public", "tok.json"));
  }
  return root;
}

/**
 * Sends a request with the path exactly as given.
 *
 * @param port - The server's port on 127.0.0.1.
 * @param path - The raw request target.
 */
function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, headers: { Accept: "*/*" } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
      response.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** The port a listening server bound. */
function portOf(server: ViteDevServer | PreviewServer): number {
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("The server is not listening on a TCP port.");
  }
  return (address satisfies AddressInfo).port;
}

/**
 * The request forms of `@ignifx/vite-plugin`'s server tests, for one directory spelling.
 *
 * @param roots - The served root as given and as the filesystem resolves it.
 * @param dir - `.ignifx`, or a link to it such as `src/link`.
 */
function attackPaths(roots: readonly string[], dir: string): string[] {
  const head = dir.charCodeAt(0).toString(16);
  const tail = dir.slice(1);
  return [
    `/${dir}/mcp.json`,
    `/${dir}/mcp.json?raw`,
    `/${dir}/mcp.json?import`,
    `/${dir}/mcp.json?url`,
    `/%${head}${tail}/mcp.json`,
    `/%25${head}${tail}/mcp.json`,
    `/${dir}%2fmcp.json`,
    `/./${dir}/mcp.json`,
    `/x/../${dir}/mcp.json`,
    `/\\${dir.replaceAll("/", "\\")}\\mcp.json`,
    `/${dir.toUpperCase()}/mcp.json`,
    `/@id/${dir}/mcp.json`,
    `/${dir}/`,
    ...roots.flatMap((root) => [
      `/@fs${root}/${dir}/mcp.json`,
      `/@fs${root}/${dir}/mcp.json?raw`,
      `/@fs${root}/x/../${dir}/mcp.json?import`,
    ]),
  ];
}

/**
 * Asks for every path and returns those answered with anything but 403 or 404, or with the token.
 *
 * @param port - The server's port.
 * @param paths - The request targets.
 */
async function leaks(port: number, paths: readonly string[]): Promise<string[]> {
  const results = await Promise.all(paths.map(async (path) => Object.assign(await rawGet(port, path), { path })));
  return results
    .filter(({ status, body }) => ![403, 404].includes(status) || body.includes(TOKEN))
    .map(({ path, status }) => `${String(status)} ${path}`);
}

describe("isPrivateRequestPath (the editor host's copy)", () => {
  it.each(["/.ignifx/mcp.json", "/%252eignifx/mcp.json", "/.IGNIFX./mcp.json", "/IGNIFX~1/mcp.json"])(
    "refuses %s",
    (url) => {
      expect(isPrivateRequestPath(url)).toBe(true);
    },
  );

  it.each(["/", "/my.ignifx.txt", "/search?q=.ignifx"])("passes %s", (url) => {
    expect(isPrivateRequestPath(url)).toBe(false);
  });
});

describe("vite dev with editorHostPlugin() and no ignifx()", () => {
  let roots: string[] = [];
  let server: ViteDevServer;
  let port = 0;

  beforeAll(async () => {
    const root = await project();
    roots = [...new Set([root, await realpath(root)])];
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false, ws: false },
      plugins: [editorHostPlugin({ editorOrigin: EDITOR_ORIGIN })],
    });
    await server.listen();
    port = portOf(server);
    return async () => {
      await server.close();
    };
  });

  it("refuses every request form of .ignifx/mcp.json", async () => {
    expect(await leaks(port, attackPaths(roots, ".ignifx"))).toEqual([]);
  });

  it.skipIf(linksUnsupported)("refuses them through a link to the directory or the file", async () => {
    const paths = [...attackPaths(roots, "src/link"), "/tok.json", "/tok.json?raw", "/public/tok.json"];
    expect(await leaks(port, paths)).toEqual([]);
  });

  it.skipIf(linksUnsupported)("refuses a linked file Vite would complete with an extension", async () => {
    // The guard tries `resolve.extensions` as Vite does, so `/src/tok` is a 404 rather than the
    // `load` hook's 500, whose body names the project's path.
    expect(await leaks(port, ["/src/tok", "/src/tok?import", "/src/tok?raw", "/src/tok.json"])).toEqual([]);
  });

  it("still serves ordinary files", async () => {
    expect((await rawGet(port, "/src/main.ts")).status).toBe(200);
    const text = await rawGet(port, "/my.ignifx.txt");
    expect(text.status).toBe(200);
    expect(text.body).toBe("not private");
  });
});

describe.skipIf(linksUnsupported)("editorHostPlugin() alone with resolve.alias", () => {
  it("refuses an alias to a link into .ignifx/", async () => {
    const root = await project();
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      resolve: { alias: [{ find: "/al", replacement: join(root, "src", "link") }] },
      server: { host: "127.0.0.1", port: 0, strictPort: false, ws: false },
      plugins: [editorHostPlugin({ editorOrigin: EDITOR_ORIGIN })],
    });
    await server.listen();
    try {
      expect(await leaks(portOf(server), ["/al/mcp.json", "/al/mcp.json?raw", "/al/mcp"])).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe.skipIf(linksUnsupported)("editorHostPlugin() alone in a build", () => {
  it("fails a build whose code imports the token through a link (the load hook)", async () => {
    const root = await project();
    await writeFile(join(root, "src", "main.ts"), 'import mcp from "./link/mcp.json";\ndocument.title = mcp.token;\n');
    const outcome = build({
      root,
      configFile: false,
      logLevel: "silent",
      publicDir: false,
      plugins: [editorHostPlugin({ editorOrigin: EDITOR_ORIGIN })],
      build: { outDir: "dist" },
    });
    await expect(outcome).rejects.toThrow(/\.ignifx/u);
  });
});

describe("vite preview with editorHostPlugin() and no ignifx()", () => {
  let roots: string[] = [];
  let server: PreviewServer;
  let port = 0;

  beforeAll(async () => {
    const root = await project();
    const plugins = [editorHostPlugin({ editorOrigin: EDITOR_ORIGIN })];
    // `publicDir: false`: without `ignifx()` nothing stops Vite copying the linked token into dist.
    // The private file is planted in `dist` afterwards, so a 404 proves the guard.
    await build({ root, configFile: false, logLevel: "silent", publicDir: false, plugins, build: { outDir: "dist" } });
    const dist = join(root, "dist");
    await mkdir(join(dist, ".ignifx"), { recursive: true });
    await writeFile(join(dist, ".ignifx", "mcp.json"), MCP_JSON);
    if (!linksUnsupported) {
      await symlink("../.ignifx", join(dist, "link"));
    }
    roots = [...new Set([dist, join(await realpath(root), "dist")])];
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

  it("refuses every request form, by path and through a link", async () => {
    const paths = [...attackPaths(roots, ".ignifx"), ...(linksUnsupported ? [] : attackPaths(roots, "link"))];
    expect(await leaks(port, paths)).toEqual([]);
  });

  it("still serves the built page", async () => {
    expect((await rawGet(port, "/")).status).toBe(200);
  });
});
