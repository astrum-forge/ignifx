import { mkdir, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { build, createLogger, createServer, preview } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ignifx } from "../src/plugin.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES, writeFixture } from "./support/fixtures.js";
import { portOf, rawGet } from "./support/raw-http.js";
import type { FixtureTree } from "./support/fixtures.js";
import type { InlineConfig, Logger, PreviewServer, ViteDevServer } from "vite";

/**
 * The cases `private-dir-server.test.ts` cannot reach by spelling `.ignifx`: a symbolic link or a
 * copy the user made puts the editor's MCP token where a server or a build would hand it out.
 * Every test runs real `vite dev`, `vite preview` or `vite build` over a temporary project.
 */

afterAll(disposeFixtures);

const TOKEN = "e28-secret-token-fedcba9876543210";
const MCP_JSON = JSON.stringify({ port: 4321, token: TOKEN, host: "127.0.0.1", url: "http://127.0.0.1:4321/mcp" });
const INDEX_HTML = '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>';

/** Windows needs a privilege to create symbolic links; CI runs these on macOS and Linux. */
const linksUnsupported = process.platform === "win32";

/**
 * Writes a project with the editor's private file and adds symbolic links to it.
 *
 * @param links - Link path (relative to the root) mapped to its relative target.
 * @param files - Extra files.
 */
async function linkedProject(links: Readonly<Record<string, string>>, files: FixtureTree = {}): Promise<string> {
  const root = await createFixtureTree({
    "index.html": INDEX_HTML,
    "src/main.ts": 'document.title = "game";\n',
    "assets/sprites/hero.png": PNG_BYTES,
    ".ignifx/mcp.json": MCP_JSON,
    ...files,
  });
  await Promise.all(
    Object.entries(links).map(async ([path, target]) => {
      const link = join(root, ...path.split("/"));
      await mkdir(dirname(link), { recursive: true });
      await symlink(target, link);
    }),
  );
  return root;
}

/**
 * The request forms of `private-dir-server.test.ts`, aimed at `mcp.json` through a link to the
 * directory instead of through `.ignifx` itself.
 *
 * @param absoluteRoots - The project root as given and as the filesystem resolves it.
 * @param dir - The `/`-separated link path, for example `src/link`.
 */
function linkAttackPaths(absoluteRoots: readonly string[], dir: string): string[] {
  const head = dir.charCodeAt(0).toString(16);
  const tail = dir.slice(1);
  const fsForms = absoluteRoots.flatMap((root) => [
    `/@fs${root}/${dir}/mcp.json`,
    `/@fs${root}/${dir}/mcp.json?raw`,
    `/@fs${root}/${dir}/mcp.json?import`,
    `/@fs${root}/${dir}/mcp.json?url`,
    `/@fs${root}/%${head}${tail}/mcp.json`,
    `/@fs${root}/x/../${dir}/mcp.json`,
    `/@id/${root}/${dir}/mcp.json?raw`,
  ]);
  return [
    `/${dir}/mcp.json`,
    `/${dir}/mcp.json?raw`,
    `/${dir}/mcp.json?import`,
    `/${dir}/mcp.json?url`,
    `/${dir}/mcp.json?import&raw`,
    `/${dir}/mcp.json?raw&url`,
    `/%${head}${tail}/mcp.json`,
    `/%${head.toUpperCase()}${tail}/mcp.json`,
    `/%25${head}${tail}/mcp.json`,
    `/%2525${head}${tail}%252fmcp.json`,
    `/${dir}%2fmcp.json`,
    `/./${dir}/mcp.json`,
    `/x/../${dir}/mcp.json`,
    `/x/%2e%2e/${dir}/mcp.json`,
    `/\\${dir.replaceAll("/", "\\")}\\mcp.json`,
    `/${dir}\\mcp.json`,
    `/${dir}/MCP.JSON`,
    `/${dir}/mcp`,
    `/${dir}/mcp?import`,
    `/@id/${dir}/mcp.json`,
    `/${dir}/`,
    ...fsForms,
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

/**
 * A logger that keeps every warning, for asserting on what the plugin reported.
 *
 * @param warnings - Receives the messages.
 */
function recordingLogger(warnings: string[]): Logger {
  const logger = createLogger("silent");
  logger.warn = (message) => {
    warnings.push(message);
  };
  return logger;
}

/**
 * Reads every file under a directory.
 *
 * @param directory - The directory.
 * @returns Paths relative to it, lowercased and split into segments, and the files' text.
 */
async function readTree(directory: string): Promise<{ segments: string[]; texts: string[] }> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  return {
    segments: files.flatMap((file) => relative(directory, file).toLowerCase().split(sep)),
    texts: await Promise.all(files.map((file) => readFile(file, "utf8"))),
  };
}

/**
 * Runs `vite build` and returns the error it failed with, or `null`.
 *
 * @param config - The build config.
 */
async function buildError(config: InlineConfig): Promise<Error | null> {
  try {
    await build({ configFile: false, logLevel: "silent", ...config });
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe.skipIf(linksUnsupported)("vite dev refuses files reached through a link into .ignifx/", () => {
  let roots: string[] = [];
  let server: ViteDevServer;
  let port = 0;

  beforeAll(async () => {
    const root = await linkedProject({
      "src/link": "../.ignifx",
      "src/tok.json": "../.ignifx/mcp.json",
      "public/ptok.json": "../.ignifx/mcp.json",
      "assets/atok.json": "../.ignifx/mcp.json",
    });
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

  it("refuses every request form through a linked directory", async () => {
    expect(await leaks(port, linkAttackPaths(roots, "src/link"))).toEqual([]);
  });

  it("refuses linked files in the source tree, publicDir and the asset root", async () => {
    const paths = [
      "/src/tok.json",
      "/src/tok.json?raw",
      "/src/tok.json?import",
      "/ptok.json",
      "/ptok.json?raw",
      "/public/ptok.json",
      "/assets/atok.json",
      "/assets/atok.json?raw",
      ...roots.flatMap((root) => [`/@fs${root}/src/tok.json?raw`, `/@fs${root}/public/ptok.json`]),
    ];
    expect(await leaks(port, paths)).toEqual([]);
  });

  it("never serves the token for a path Vite completes with an extension", async () => {
    // `/src/tok` exists only once Vite's resolver adds `.json`; the plugin's `load` hook refuses
    // the real path, so the transform fails rather than answering with the file.
    const paths = ["/src/tok", "/src/tok?import", "/src/tok?raw"];
    const responses = await Promise.all(paths.map(async (path) => Object.assign(await rawGet(port, path), { path })));
    for (const { path, status, body } of responses) {
      expect(status, path).not.toBe(200);
      expect(body, path).not.toContain(TOKEN);
    }
  });

  it("still serves ordinary files", async () => {
    expect((await rawGet(port, "/src/main.ts")).status).toBe(200);
    expect((await rawGet(port, "/assets/sprites/hero.png")).status).toBe(200);
    expect((await rawGet(port, "/", { Accept: "text/html" })).status).toBe(200);
  });
});

describe.skipIf(linksUnsupported)("vite dev with a base refuses links into .ignifx/", () => {
  it("refuses the forms under the base too", async () => {
    const root = await linkedProject({ "src/link": "../.ignifx" });
    const server = await createServer({
      root,
      base: "/game/",
      configFile: false,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false, ws: false },
      plugins: [ignifx()],
    });
    await server.listen();
    try {
      const port = portOf(server);
      const paths = ["/game/src/link/mcp.json", "/game/src/link/mcp.json?raw", "/game/src/link/mcp.json?import"];
      expect(await leaks(port, paths)).toEqual([]);
      expect((await rawGet(port, "/game/src/main.ts")).status).toBe(200);
    } finally {
      await server.close();
    }
  });
});

describe.skipIf(linksUnsupported)("vite build keeps .ignifx/ out of dist", () => {
  it("skips an asset-root link into .ignifx/ with a warning", async () => {
    const root = await linkedProject({ "assets/tok.json": "../.ignifx/mcp.json", "assets/dir": "../.ignifx" });
    const warnings: string[] = [];
    await build({
      root,
      configFile: false,
      customLogger: recordingLogger(warnings),
      plugins: [ignifx()],
      build: { outDir: "dist", emptyOutDir: true },
    });
    const dist = await readTree(join(root, "dist"));
    expect(dist.texts.some((text) => text.includes(TOKEN))).toBe(false);
    expect(dist.segments.some((segment) => segment.startsWith("hero."))).toBe(true);
    const manifest = await readFile(join(root, "dist", "assets.manifest.json"), "utf8");
    expect(manifest).not.toContain("tok");
    expect(manifest).not.toContain('"dir');
    const skipped = warnings.filter((message) => message.includes("IGX-0556"));
    expect(skipped.join("\n")).toContain('Skipped "tok.json"');
    expect(skipped.join("\n")).toContain('Skipped "dir"');
  });

  it("fails, and removes the copy, when publicDir holds .ignifx/ at any depth and in any case", async () => {
    const root = await linkedProject(
      {},
      { "public/.ignifx/mcp.json": MCP_JSON, "public/deep/.IGNIFX/mcp.json": MCP_JSON, "public/ok.txt": "ok" },
    );
    const error = await buildError({ root, plugins: [ignifx()], build: { outDir: "dist", emptyOutDir: true } });
    expect(error?.message).toContain("IGX-0556");
    expect(error?.message).toContain(".ignifx");
    expect(error?.message).toContain(join("deep", ".IGNIFX"));
    expect(error?.message).toContain("Move .ignifx/ out of publicDir");
    const dist = await readTree(join(root, "dist"));
    expect(dist.segments).not.toContain(".ignifx");
    expect(dist.texts.some((text) => text.includes(TOKEN))).toBe(false);
    expect(dist.segments).toContain("ok.txt");
  });

  it("fails, and removes the copy, when publicDir links into .ignifx/", async () => {
    const root = await linkedProject({ "public/tok.json": "../.ignifx/mcp.json", "public/dir": "../.ignifx" });
    const error = await buildError({ root, plugins: [ignifx()], build: { outDir: "dist", emptyOutDir: true } });
    expect(error?.message).toContain("IGX-0556");
    expect(error?.message).toContain("tok.json");
    const dist = await readTree(join(root, "dist"));
    expect(dist.texts.some((text) => text.includes(TOKEN))).toBe(false);
    expect(dist.segments).not.toContain("tok.json");
  });

  it("fails when an emitted file lands under .ignifx/ in the output", async () => {
    const root = await linkedProject({});
    const error = await buildError({
      root,
      plugins: [
        ignifx(),
        {
          name: "emits-private",
          generateBundle() {
            this.emitFile({ type: "asset", fileName: "nested/.Ignifx/mcp.json", source: MCP_JSON });
          },
        },
      ],
      build: { outDir: "dist", emptyOutDir: true },
    });
    expect(error?.message).toContain("IGX-0556");
    expect((await readTree(join(root, "dist"))).texts.some((text) => text.includes(TOKEN))).toBe(false);
  });

  it("fails when game code imports the token through a link", async () => {
    const root = await linkedProject(
      { "src/link": "../.ignifx" },
      { "src/main.ts": 'import mcp from "./link/mcp.json";\ndocument.title = mcp.token;\n' },
    );
    const error = await buildError({ root, plugins: [ignifx()], build: { outDir: "dist", emptyOutDir: true } });
    expect(error?.message).toContain("IGX-0556");
    await rm(join(root, "src", "link"));
  });

  it("builds a clean project", async () => {
    const root = await linkedProject({}, { "public/ok.txt": "ok", "public/my.ignifx.txt": "fine" });
    expect(await buildError({ root, plugins: [ignifx()], build: { outDir: "dist", emptyOutDir: true } })).toBeNull();
  });
});

describe.skipIf(linksUnsupported)("vite preview refuses files reached through a link into .ignifx/", () => {
  let roots: string[] = [];
  let server: PreviewServer;
  let port = 0;

  beforeAll(async () => {
    const root = await linkedProject({});
    await build({ root, configFile: false, logLevel: "silent", plugins: [ignifx()], build: { outDir: "dist" } });
    // Planted after the build, as a deploy step or a user could: a link in `dist` to the project's
    // private directory, and one to the file.
    await symlink("../.ignifx", join(root, "dist", "link"));
    await symlink("../.ignifx/mcp.json", join(root, "dist", "tok.json"));
    await writeFixture(root, "dist/ok.txt", "ok");
    roots = [...new Set([join(root, "dist"), join(await realpath(root), "dist")])];
    server = await preview({
      root,
      configFile: false,
      logLevel: "silent",
      preview: { host: "127.0.0.1", port: 0, strictPort: false },
      plugins: [ignifx()],
    });
    port = portOf(server);
    return async () => {
      await server.close();
    };
  });

  it("refuses every request form through a linked directory and a linked file", async () => {
    const paths = [...linkAttackPaths(roots, "link"), "/tok.json", "/tok.json?raw", "/TOK.JSON"];
    expect(await leaks(port, paths)).toEqual([]);
  });

  it("still serves the built files", async () => {
    expect((await rawGet(port, "/ok.txt")).status).toBe(200);
    expect((await rawGet(port, "/", { Accept: "text/html" })).status).toBe(200);
  });
});
