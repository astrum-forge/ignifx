import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { ignifx } from "../src/plugin.js";
import { ASSET_CHANGED_EVENT, MANIFEST_MODULE_ID, SCRIPTS_MODULE_ID } from "../src/virtual-modules.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES, writeFixture } from "./support/fixtures.js";
import type { AssetManifest } from "../src/manifest.js";
import type { Plugin } from "vite";

/**
 * The script registry as a real `vite dev` server transforms it
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5). The string assertions in
 * `virtual-modules.test.ts` prove what is generated; this proves Vite accepts it — that the glob
 * expands, that the module is wired into the HMR graph, and that the accept handler survives the
 * transform.
 */

afterAll(disposeFixtures);

/** A `.wgsl` shader the validator accepts, so a dev server over it reports nothing. */
const VALID_SHADER = [
  "// @ignifx shader",
  "// @ignifx system world, viewProjection",
  "// @ignifx uniform tint: vec3<f32> = color(1.0, 1.0, 1.0)",
  "@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {",
  "  return shaderSystem.viewProjection * shaderSystem.world * vec4<f32>(input.position, 1.0);",
  "}",
  "@fragment fn mainFragment() -> @location(0) vec4<f32> {",
  "  return vec4<f32>(shaderUniforms.tint, 1.0);",
  "}",
  "",
].join("\n");

/**
 * A plugin that records everything any other plugin sends over the HMR socket.
 *
 * Vite hands `configureServer` a different object from the one `createServer` resolves to, but every
 * plugin gets the same one — so the only place to observe what a browser would receive is from
 * inside a second plugin's own `configureServer`.
 */
function hmrRecorder(sent: Record<string, unknown>[]): Plugin {
  return {
    name: "hmr-recorder",
    configureServer(server) {
      // Nothing is connected to the socket in middleware mode, so the recorder replaces `send`
      // rather than wrapping it: what the plugin passed is the whole of what a browser would get.
      server.ws.send = (...args: unknown[]): void => {
        const [payload] = args;
        if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
          sent.push({ ...payload });
        }
      };
    },
  };
}

/** Reads the manifest out of the source of `virtual:ignifx/manifest`. */
function parseManifestModule(source: string): AssetManifest {
  const json = source.replace(/^export const manifest = /u, "").replace(/;\n$/u, "");
  return JSON.parse(json) as AssetManifest;
}

describe("vite dev with the ignifx plugin", () => {
  it("transforms virtual:ignifx/scripts into a self-accepting HMR module", async () => {
    const root = await createFixtureTree({
      "index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
      "src/main.ts":
        'import { acceptHotReload, scripts } from "virtual:ignifx/scripts";\nexport { acceptHotReload, scripts };\n',
      "src/scripts/mover.ts": 'export class Mover {\n  static typeId = "mygame/Mover";\n}\n',
      "assets/sprites/hero.png": PNG_BYTES,
    });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [ignifx()],
      server: { middlewareMode: true },
    });
    try {
      const result = await server.transformRequest(SCRIPTS_MODULE_ID);
      const code = result?.code ?? "";

      expect(code).toContain("createHotContext");
      expect(code).toContain("accept(");
      expect(code).toContain("app.hotReload.apply");
      // The eager glob became a real static import of the script file, which is what puts the
      // module in Vite's HMR graph.
      expect(code).toContain("/src/scripts/mover.ts");
    } finally {
      await server.close();
    }
  });

  it("lists a .wgsl file in the manifest as a shader asset", async () => {
    const root = await createFixtureTree({
      "index.html": "<!doctype html><html><body></body></html>",
      "assets/shaders/dissolve.wgsl": VALID_SHADER,
      "assets/shaders/snow.surface.wgsl": "// @ignifx surface\nfn surface() {}\n",
    });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [ignifx()],
      server: { middlewareMode: true },
    });
    try {
      const result = await server.transformRequest(MANIFEST_MODULE_ID);
      const manifest = parseManifestModule(result?.code ?? "");
      expect(manifest.entries.map((entry) => [entry.address, entry.type])).toEqual([
        ["shaders/dissolve.wgsl", "shader"],
        ["shaders/snow.surface.wgsl", "shader"],
      ]);
    } finally {
      await server.close();
    }
  });

  it("announces an edited .wgsl file on the ignifx:asset-changed channel like any other asset", async () => {
    const root = await createFixtureTree({
      "index.html": "<!doctype html><html><body></body></html>",
      "assets/shaders/dissolve.wgsl": VALID_SHADER,
    });
    const plugin = ignifx();
    const sent: Record<string, unknown>[] = [];
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin, hmrRecorder(sent)],
      server: { middlewareMode: true },
    });
    try {
      await writeFixture(root, "assets/shaders/dissolve.wgsl", VALID_SHADER.replace("1.0, 1.0, 1.0", "1, 0, 0"));
      server.watcher.emit("change", join(server.config.root, "assets", "shaders", "dissolve.wgsl"));
      await plugin.api?.whenIdle();

      expect(sent).toContainEqual({
        type: "custom",
        event: ASSET_CHANGED_EVENT,
        data: { address: "shaders/dissolve.wgsl", kind: "changed", url: "/assets/shaders/dissolve.wgsl" },
      });
      // Nothing else: a valid shader produces no error overlay.
      expect(sent.filter((payload) => payload["type"] === "error")).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("shows a shader that stops validating in the browser error overlay, then clears on a fix", async () => {
    const root = await createFixtureTree({
      "index.html": "<!doctype html><html><body></body></html>",
      "assets/shaders/dissolve.wgsl": VALID_SHADER,
    });
    const plugin = ignifx();
    const sent: Record<string, unknown>[] = [];
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin, hmrRecorder(sent)],
      server: { middlewareMode: true },
    });
    try {
      // Vite resolves its root through the real path, and macOS' temporary directory is a symlink, so
      // the watcher event has to carry the path the plugin will compare against.
      const shaderPath = join(server.config.root, "assets", "shaders", "dissolve.wgsl");

      await writeFixture(
        root,
        "assets/shaders/dissolve.wgsl",
        VALID_SHADER.replace("shaderUniforms.tint", "shaderUniforms.tnit"),
      );
      server.watcher.emit("change", shaderPath);
      await plugin.api?.whenIdle();

      const overlay = sent.find((payload) => payload["type"] === "error");
      const error = overlay?.["err"];
      const message = typeof error === "object" && error !== null ? (error as { message?: unknown }).message : null;
      expect(typeof message === "string" ? message : "").toContain("shaders/dissolve.wgsl: line 8:");
      expect(typeof message === "string" ? message : "").toContain("IGX-0655");

      sent.length = 0;
      await writeFixture(root, "assets/shaders/dissolve.wgsl", VALID_SHADER);
      server.watcher.emit("change", shaderPath);
      await plugin.api?.whenIdle();
      expect(sent.filter((payload) => payload["type"] === "error")).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("leaves a broken shader alone when validate is false", async () => {
    const root = await createFixtureTree({
      "index.html": "<!doctype html><html><body></body></html>",
      "assets/shaders/broken.wgsl": await readFile(
        join(import.meta.dirname, "fixtures", "shaders", "syntax-error.wgsl"),
        "utf8",
      ),
    });
    const plugin = ignifx({ validate: false });
    const sent: Record<string, unknown>[] = [];
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin, hmrRecorder(sent)],
      server: { middlewareMode: true },
    });
    try {
      server.watcher.emit("change", join(server.config.root, "assets", "shaders", "broken.wgsl"));
      await plugin.api?.whenIdle();
      expect(sent.filter((payload) => payload["type"] === "error")).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
