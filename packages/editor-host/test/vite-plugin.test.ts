import { rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { ignifx } from "@ignifx/vite-plugin";
import { build, createServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { EDITOR_ENTRY_MODULE_ID, EDITOR_MODULE_ID } from "../src/vite/modules.js";
import { editorHostPlugin, readProjectEngineVersion } from "../src/vite/plugin.js";
import { createFixtureTree, disposeFixtures, PROJECT } from "./support/fixtures.js";
import type { EditorHostPluginOptions } from "../src/vite/plugin.js";
import type { AddressInfo } from "node:net";
import type { InlineConfig, Rollup, ViteDevServer } from "vite";

/**
 * The editor host's Vite plugin on a real `vite dev` server and a real `vite build`
 * (`docs/architecture/17-editor-host.md` §3).
 */

afterAll(disposeFixtures);

const EDITOR_ORIGIN = "ignifx://app";

/**
 * Starts a dev server over a fixture project.
 *
 * @param root - The project root.
 * @param options - Plugin options to add.
 * @param config - Vite config to add.
 * @returns The server; close it when done.
 */
async function devServer(
  root: string,
  options?: Partial<EditorHostPluginOptions>,
  config?: InlineConfig,
): Promise<ViteDevServer> {
  return createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [ignifx(), editorHostPlugin({ editorOrigin: EDITOR_ORIGIN, ...options })],
    server: { middlewareMode: true },
    ...config,
  });
}

/**
 * Requests one path through the dev server's middleware stack over real HTTP.
 *
 * @param server - The dev server.
 * @param path - The path to request.
 * @param headers - Request headers to send.
 * @returns The response.
 */
async function request(server: ViteDevServer, path: string, headers?: Record<string, string>): Promise<Response> {
  const http = createHttpServer(server.middlewares);
  await new Promise<void>((resolve) => {
    http.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = http.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${String(port)}${path}`, {
      redirect: "manual",
      ...(headers ? { headers } : {}),
    });
  } finally {
    http.close();
  }
}

/**
 * Loads a virtual module through the server's plugin container, without Vite's import analysis.
 *
 * @param server - The dev server.
 * @param id - The bare module id.
 * @returns The module source.
 */
async function loadVirtual(server: ViteDevServer, id: string): Promise<string> {
  const resolved = await server.environments.client.pluginContainer.resolveId(id);
  const loaded = await server.environments.client.pluginContainer.load(resolved?.id ?? id);
  return typeof loaded === "string" ? loaded : (loaded?.code ?? "");
}

describe("the scene view's page", () => {
  it("serves the page with frame-ancestors limited to the editor", async () => {
    const server = await devServer(await createFixtureTree(PROJECT));
    try {
      const response = await request(server, "/__ignifx_editor__/");
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe(`frame-ancestors ${EDITOR_ORIGIN}`);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(html).toContain("/@vite/client");
      expect(html).toContain('<canvas id="ignifx-editor-view">');
      expect(html).toContain(`/@id/${EDITOR_ENTRY_MODULE_ID}`);
    } finally {
      await server.close();
    }
  });

  it("redirects the path without its trailing slash", async () => {
    const server = await devServer(await createFixtureTree(PROJECT));
    try {
      const response = await request(server, "/__ignifx_editor__?scene=a");

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/__ignifx_editor__/?scene=a");
    } finally {
      await server.close();
    }
  });

  it("leaves every other request to Vite", async () => {
    const server = await devServer(await createFixtureTree(PROJECT));
    try {
      const game = await request(server, "/");

      expect(game.status).toBe(200);
      expect(await game.text()).toContain("/src/main.ts");
      expect((await request(server, "/__ignifx_editor__/other.js")).headers.get("content-security-policy")).toBeNull();
      expect((await request(server, "/src/main.ts")).headers.get("content-security-policy")).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("serves the game's own page, the play view, with frame-ancestors limited to the editor (E24)", async () => {
    const server = await devServer(await createFixtureTree(PROJECT));
    try {
      // What a browser sends when it navigates a frame, or a tab, to the page.
      for (const path of ["/", "/index.html"]) {
        // oxlint-disable-next-line no-await-in-loop -- one request at a time
        const game = await request(server, path, { accept: "text/html,application/xhtml+xml,*/*;q=0.8" });

        expect(game.status).toBe(200);
        expect(game.headers.get("content-security-policy")).toBe(`frame-ancestors ${EDITOR_ORIGIN}`);
        expect(game.headers.get("content-type")).toContain("text/html");
        // oxlint-disable-next-line no-await-in-loop -- one request at a time
        expect(await game.text()).toContain("/@vite/client");
      }
    } finally {
      await server.close();
    }
  });

  it("leaves a policy the project sets in server.headers in place (E24)", async () => {
    const own = "frame-ancestors 'none'";
    const server = await devServer(
      await createFixtureTree(PROJECT),
      {},
      {
        server: { middlewareMode: true, headers: { "Content-Security-Policy": own } },
      },
    );
    try {
      const game = await request(server, "/", { accept: "text/html" });

      expect(game.headers.get("content-security-policy")).toBe(own);
    } finally {
      await server.close();
    }
  });

  it("serves the page below the dev server's base", async () => {
    const server = await devServer(await createFixtureTree(PROJECT), {}, { base: "/game/" });
    try {
      const response = await request(server, "/game/__ignifx_editor__/");

      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`/game/@id/${EDITOR_ENTRY_MODULE_ID}`);
    } finally {
      await server.close();
    }
  });

  it("generates an entry that imports the host, the scripts and the extensions from the project", async () => {
    const server = await devServer(await createFixtureTree(PROJECT), { bootScene: "scenes/boot.scene.json" });
    try {
      const source = await loadVirtual(server, EDITOR_ENTRY_MODULE_ID);

      expect(source).toContain('import { startEditorHost } from "@ignifx/editor-host";');
      expect(source).toContain('import { acceptHotReload, scripts } from "virtual:ignifx/scripts";');
      expect(source).toContain('import { manifest } from "virtual:ignifx/manifest";');
      expect(source).toContain('import { extensions } from "/src/extensions.ts";');
      expect(source).toContain("extensions: extensions(),");
      expect(source).toContain('bootScene: "scenes/boot.scene.json",');
      expect(source).toContain('engineVersion: "1.2.3",');
      expect(source).toContain(`editorOrigin: "${EDITOR_ORIGIN}",`);

      // Vite accepts the generated module: every import resolves in the project's graph.
      const transformed = await server.transformRequest(EDITOR_ENTRY_MODULE_ID);
      expect(transformed?.code).toContain("/node_modules/@ignifx/editor-host/index.js");
      expect(transformed?.code).toContain("/src/extensions.ts");
    } finally {
      await server.close();
    }
  });

  it("passes no extensions when the project has no extensions module", async () => {
    const root = await createFixtureTree(PROJECT);
    await rm(join(root, "src", "extensions.ts"));
    const server = await devServer(root);
    try {
      const source = await loadVirtual(server, EDITOR_ENTRY_MODULE_ID);

      expect(source).not.toContain("/src/extensions.ts");
      expect(source).toContain("extensions: [],");
      expect(server.config.optimizeDeps.entries).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("extends optimizeDeps rather than replacing it", async () => {
    const root = await createFixtureTree(PROJECT);
    const defaults = await devServer(root);
    const custom = await devServer(root, {}, { optimizeDeps: { entries: ["index.html"], exclude: ["left-alone"] } });
    try {
      expect(defaults.config.optimizeDeps.entries).toEqual(["**/*.html", "src/extensions.ts"]);
      expect(defaults.config.optimizeDeps.exclude).toContain("@ignifx/editor-host");
      expect(custom.config.optimizeDeps.entries).toEqual(["index.html", "src/extensions.ts"]);
      expect(custom.config.optimizeDeps.exclude).toEqual(["left-alone", "@ignifx/editor-host"]);
    } finally {
      await defaults.close();
      await custom.close();
    }
  });
});

describe("virtual:ignifx/editor", () => {
  it("is the play controls under vite dev", async () => {
    const server = await devServer(await createFixtureTree(PROJECT), { heartbeatIntervalMs: 500 });
    try {
      const source = await loadVirtual(server, EDITOR_MODULE_ID);

      expect(source).toContain('import { listenForEditorPlayControls } from "@ignifx/editor-host";');
      expect(source).toContain("export function attachEditorPlayControls(app) {");
      expect(source).toContain("import.meta.hot.dispose(");
      expect(source).toContain("heartbeatIntervalMs: 500,");
      // The listener is registered when the module is evaluated, before the game's main.ts runs.
      expect(source.indexOf("listenForEditorPlayControls({")).toBeLessThan(
        source.indexOf("export function attachEditorPlayControls"),
      );
      expect(source).toContain(`editorOrigin: "${EDITOR_ORIGIN}",`);

      const transformed = await server.transformRequest(EDITOR_MODULE_ID);
      expect(transformed?.code).toContain("createHotContext");
    } finally {
      await server.close();
    }
  });

  it("is an empty function in a production build, and the scene view is not built", async () => {
    const root = await createFixtureTree(PROJECT);
    let pluginNames: readonly string[] = [];
    const output = (await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        ignifx(),
        editorHostPlugin({ editorOrigin: EDITOR_ORIGIN }),
        {
          name: "plugin-recorder",
          configResolved(resolvedConfig): void {
            pluginNames = resolvedConfig.plugins.map((plugin) => plugin.name);
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        // The game's entry module itself, with its exports kept, so the generated function is visible.
        rollupOptions: { input: join(root, "src", "main.ts"), preserveEntrySignatures: "strict" },
      },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[];
    const bundles = Array.isArray(output) ? output : [output];
    const code = bundles
      .flatMap((bundle) => bundle.output)
      .map((file) => (file.type === "chunk" ? file.code : ""))
      .join("\n");

    expect(code).toContain("function attachEditorPlayControls()");
    expect(code).not.toContain("import.meta.hot");
    expect(code).not.toContain("@ignifx/editor-host");
    expect(code).not.toContain("startEditorPlayControls");
    expect(code).not.toContain("listenForEditorPlayControls");
    expect(pluginNames).toContain("ignifx-editor-host:play-controls");
    expect(pluginNames).not.toContain("ignifx-editor-host");
  });
});

describe("editorHostPlugin options", () => {
  it("refuses a malformed origin, extensions path or heartbeat", () => {
    expect(() => editorHostPlugin({ editorOrigin: "*" })).toThrow(expect.objectContaining({ code: "IGX-1801" }));
    expect(() => editorHostPlugin({ editorOrigin: "ignifx://app; script-src *" })).toThrow(
      expect.objectContaining({ code: "IGX-1801" }),
    );
    expect(() => editorHostPlugin({ editorOrigin: EDITOR_ORIGIN, extensions: "../outside.ts" })).toThrow(
      expect.objectContaining({ code: "IGX-1803" }),
    );
    expect(() => editorHostPlugin({ editorOrigin: EDITOR_ORIGIN, heartbeatIntervalMs: Number.NaN })).toThrow(
      expect.objectContaining({ code: "IGX-1803" }),
    );
  });

  it("reads the project's core version, or null without one", async () => {
    expect(readProjectEngineVersion(await createFixtureTree(PROJECT))).toBe("1.2.3");
    const withoutVersion = await createFixtureTree({
      "package.json": "{}",
      "node_modules/@ignifx/core/package.json": JSON.stringify({ name: "@ignifx/core" }),
    });
    const unreadable = await createFixtureTree({
      "package.json": "{}",
      "node_modules/@ignifx/core/package.json": "not json",
    });
    expect(readProjectEngineVersion(withoutVersion)).toBeNull();
    expect(readProjectEngineVersion(unreadable)).toBeNull();
  });
});
