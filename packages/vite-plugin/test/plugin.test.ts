import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import { IGNIFX_CONFIG_DEFINE_KEY } from "../src/ignifx-config.js";
import { ignifx, PLUGIN_NAME } from "../src/plugin.js";
import {
  ASSET_CHANGED_EVENT,
  RESOLVED_MANIFEST_MODULE_ID,
  RESOLVED_SCRIPTS_MODULE_ID,
} from "../src/virtual-modules.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES, VALID_SCENE, writeFixture } from "./support/fixtures.js";
import { asViteServer, FakeDevServer, FakePluginContext, harness } from "./support/plugin-harness.js";
import type { AssetManifest } from "../src/manifest.js";
import type { IgnifxPluginApi } from "../src/plugin.js";
import type { JsonSchemaProvider } from "../src/validate.js";
import type { Plugin } from "vite";

afterAll(disposeFixtures);

/** A project tree with a small asset root, a sidecar, and a project config. */
function projectTree(): Promise<string> {
  return createFixtureTree({
    "ignifx.config.ts": "export default { layers: ['Default', 'Player'] };",
    "assets/sprites/hero.png": PNG_BYTES,
    "assets/sprites/hero.png.meta.json": JSON.stringify({ groups: ["boot"], texture: { srgb: true } }),
    "assets/levels/level1.scene.json": VALID_SCENE,
  });
}

/** Drives `config` + `configResolved` so the plugin knows where the project is. */
async function configure(
  plugin: Plugin,
  root: string,
  command: "build" | "serve",
): Promise<{ define?: Record<string, string> } | undefined> {
  const hooks = harness(plugin);
  const result = await hooks.config({ root }, { command, mode: command === "build" ? "production" : "development" });
  hooks.configResolved({ root, base: "/", command });
  return result;
}

/** Fires a watcher event and waits for the plugin to finish reacting to it. */
async function emitAndSettle(
  plugin: Plugin<IgnifxPluginApi>,
  server: FakeDevServer,
  event: "add" | "change" | "unlink",
  file: string,
): Promise<void> {
  server.emit(event, file);
  await plugin.api?.whenIdle();
}

/** Parses the manifest out of the source of `virtual:ignifx/manifest`. */
function parseManifestModule(source: string): AssetManifest {
  const json = source.replace(/^export const manifest = /u, "").replace(/;\n$/u, "");
  return JSON.parse(json) as AssetManifest;
}

describe("ignifx() plugin identity", () => {
  it("is named for the engine and resolves before the normal plugin tier", () => {
    const plugin = ignifx();
    expect(plugin.name).toBe(PLUGIN_NAME);
    expect(plugin.enforce).toBe("pre");
  });
});

describe("config hook", () => {
  it("injects the resolved project config as import.meta.env.IGNIFX_CONFIG", async () => {
    const root = await projectTree();
    const result = await configure(ignifx(), root, "build");
    expect(result?.define?.[IGNIFX_CONFIG_DEFINE_KEY]).toBe(JSON.stringify({ layers: ["Default", "Player"] }));
  });

  it("injects an empty object when the project has no config file", async () => {
    const root = await createFixtureTree({ "assets/a.png": PNG_BYTES });
    const result = await configure(ignifx(), root, "build");
    expect(result?.define?.[IGNIFX_CONFIG_DEFINE_KEY]).toBe("{}");
  });

  it("injects an empty object when config: false disables loading", async () => {
    const root = await projectTree();
    const result = await configure(ignifx({ config: false }), root, "build");
    expect(result?.define?.[IGNIFX_CONFIG_DEFINE_KEY]).toBe("{}");
  });

  it("loads an explicitly configured file", async () => {
    const root = await createFixtureTree({
      "custom/game.config.ts": "export default { assets: { preload: ['boot'] } };",
      "assets/a.png": PNG_BYTES,
    });
    const result = await configure(ignifx({ config: "custom/game.config.ts" }), root, "build");
    expect(result?.define?.[IGNIFX_CONFIG_DEFINE_KEY]).toBe(JSON.stringify({ assets: { preload: ["boot"] } }));
  });
});

describe("virtual modules", () => {
  it("serves the development manifest with root-relative URLs", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const context = new FakePluginContext();
    const source = await harness(plugin).load.call(context, RESOLVED_MANIFEST_MODULE_ID);
    const manifest = parseManifestModule(source ?? "");
    expect(manifest.entries.map((entry) => entry.url)).toEqual([
      "/assets/levels/level1.scene.json",
      "/assets/sprites/hero.png",
    ]);
  });

  it("serves the build manifest with content-hashed URLs under publicPath", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "build");
    const context = new FakePluginContext();
    await harness(plugin).buildStart.call(context);
    const source = await harness(plugin).load.call(context, RESOLVED_MANIFEST_MODULE_ID);
    const manifest = parseManifestModule(source ?? "");
    const hero = manifest.entries.find((entry) => entry.address === "sprites/hero.png");
    expect(hero?.url).toBe(`/assets/sprites/hero.${hero?.hash ?? ""}.png`);
    expect(hero?.groups).toEqual(["boot"]);
    expect(hero?.meta).toEqual({ texture: { srgb: true } });
  });

  it("serves the script registry module with the HMR client in development", async () => {
    const root = await projectTree();
    const plugin = ignifx({ scripts: "src/game/**/*.ts" });
    await configure(plugin, root, "serve");
    const source = await harness(plugin).load.call(new FakePluginContext(), RESOLVED_SCRIPTS_MODULE_ID);
    expect(source).toContain('import.meta.glob("/src/game/**/*.ts", { eager: true })');
    expect(source).toContain("const hot = import.meta.hot;");
    expect(source).toContain("app.hotReload.apply([{ types: next.scripts }])");
  });

  it("leaves the HMR client out of the script registry module in a build", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "build");
    const source = await harness(plugin).load.call(new FakePluginContext(), RESOLVED_SCRIPTS_MODULE_ID);
    expect(source).toContain("export const scripts = registry;");
    expect(source).toContain("export function acceptHotReload()");
    expect(source).not.toContain("import.meta.hot");
    expect(source).not.toContain("hotReload.apply");
  });

  it("declines module ids it does not own", async () => {
    const plugin = ignifx();
    expect(harness(plugin).resolveId("./main.ts")).toBeNull();
    expect(await harness(plugin).load.call(new FakePluginContext(), "./main.ts")).toBeNull();
  });
});

describe("buildStart", () => {
  it("fails the build when a scene file has no format header", async () => {
    const root = await createFixtureTree({ "assets/levels/bad.scene.json": "{}" });
    const plugin = ignifx();
    await configure(plugin, root, "build");
    await expect(harness(plugin).buildStart.call(new FakePluginContext())).rejects.toThrow(
      /levels\/bad\.scene\.json: is missing its "format"\/"formatVersion" header \(IGX-0651\)/u,
    );
  });

  it("fails the build when a scene file violates the supplied schema", async () => {
    const schemas: JsonSchemaProvider = {
      scene: { type: "object", required: ["format", "formatVersion", "name", "entities", "engineVersion"] },
    };
    const root = await createFixtureTree({ "assets/levels/level1.scene.json": VALID_SCENE });
    const plugin = ignifx({ schemas });
    await configure(plugin, root, "build");
    await expect(harness(plugin).buildStart.call(new FakePluginContext())).rejects.toThrow(
      /missing required property "engineVersion" \(IGX-0652\)/u,
    );
  });

  it("does not validate when validate is false", async () => {
    const root = await createFixtureTree({ "assets/levels/bad.scene.json": "{}" });
    const plugin = ignifx({ validate: false });
    await configure(plugin, root, "build");
    await expect(harness(plugin).buildStart.call(new FakePluginContext())).resolves.toBeUndefined();
  });

  it("warns rather than failing when the asset root does not exist", async () => {
    const root = await createFixtureTree({ "package.json": "{}" });
    const plugin = ignifx();
    await configure(plugin, root, "build");
    const context = new FakePluginContext();
    await harness(plugin).buildStart.call(context);
    expect(context.warnings.join("\n")).toContain("IGX-0550");
  });
});

describe("generateBundle", () => {
  it("emits every asset under publicPath with a content-hashed name, plus the manifest", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "build");
    const context = new FakePluginContext();
    await harness(plugin).buildStart.call(context);
    await harness(plugin).generateBundle.call(context);

    const names = context.emitted.map((file) => file.fileName).toSorted();
    expect(names).toHaveLength(3);
    expect(names).toContain("assets.manifest.json");
    expect(names.some((name) => /^assets\/sprites\/hero\.[0-9a-f]{8}\.png$/u.test(name))).toBe(true);
    expect(names.some((name) => /^assets\/levels\/level1\.[0-9a-f]{8}\.scene\.json$/u.test(name))).toBe(true);
  });

  it("emits the bytes of each asset and records the file it came from", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "build");
    const context = new FakePluginContext();
    await harness(plugin).generateBundle.call(context);
    const png = context.emitted.find((file) => file.fileName.includes("hero"));
    expect(png?.source).toEqual(Buffer.from(PNG_BYTES));
    expect(png?.originalFileName).toBe(join(root, "assets", "sprites", "hero.png"));
  });

  it("copies extension public assets unhashed next to the hashed ones", async () => {
    const root = await createFixtureTree({
      "assets/a.png": PNG_BYTES,
      "node_modules/@ignifx/physics/package.json": JSON.stringify({
        name: "@ignifx/physics",
        ignifx: { assets: { public: ["./HavokPhysics.wasm"] } },
      }),
      "node_modules/@ignifx/physics/HavokPhysics.wasm": "wasm-bytes",
    });
    const plugin = ignifx();
    await configure(plugin, root, "build");
    const context = new FakePluginContext();
    await harness(plugin).generateBundle.call(context);
    expect(context.emitted.map((file) => file.fileName)).toContain("assets/HavokPhysics.wasm");
  });

  it("respects a custom publicPath and manifestFileName", async () => {
    const root = await createFixtureTree({ "assets/a.png": PNG_BYTES });
    const plugin = ignifx({ publicPath: "static", manifestFileName: "meta/assets.json" });
    await configure(plugin, root, "build");
    const context = new FakePluginContext();
    await harness(plugin).generateBundle.call(context);
    const names = context.emitted.map((file) => file.fileName);
    expect(names).toContain("meta/assets.json");
    expect(names.some((name) => name.startsWith("static/a."))).toBe(true);
  });

  it("fails the build when validation failed", async () => {
    const root = await createFixtureTree({ "assets/levels/bad.scene.json": "{}" });
    const plugin = ignifx();
    await configure(plugin, root, "build");
    await expect(harness(plugin).generateBundle.call(new FakePluginContext())).rejects.toThrow(/IGX-0651/u);
  });
});

describe("configureServer", () => {
  it("serves the manifest from the configured path", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    const response = server.request("/assets.manifest.json");
    expect(response.headers["content-type"]).toBe("application/json");
    const manifest = JSON.parse(response.body ?? "") as AssetManifest;
    expect(manifest.entries).toHaveLength(2);
  });

  it("serves an extension public asset with its content type", async () => {
    const root = await createFixtureTree({
      "assets/a.png": PNG_BYTES,
      "node_modules/@ignifx/physics/package.json": JSON.stringify({
        name: "@ignifx/physics",
        ignifx: { assets: { public: ["./HavokPhysics.wasm"] } },
      }),
      "node_modules/@ignifx/physics/HavokPhysics.wasm": "wasm-bytes",
    });
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));
    const response = server.request("/assets/HavokPhysics.wasm");
    expect(response.headers["content-type"]).toBe("application/wasm");
  });

  it("passes an unrelated request on to the next middleware", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));
    expect(server.request("/index.html").body).toBeNull();
  });

  it("watches the asset root", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));
    expect(server.watched).toEqual([join(root, "assets")]);
  });

  it("announces a changed asset on the ignifx:asset-changed channel", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await writeFixture(root, "assets/sprites/hero.png", new Uint8Array([1, 2, 3]));
    await emitAndSettle(plugin, server, "change", join(root, "assets", "sprites", "hero.png"));

    expect(server.sent).toContainEqual({
      type: "custom",
      event: ASSET_CHANGED_EVENT,
      data: { address: "sprites/hero.png", kind: "changed", url: "/assets/sprites/hero.png" },
    });
    expect(server.invalidated).toContain(RESOLVED_MANIFEST_MODULE_ID);
  });

  it("announces an added asset and picks it up in the manifest", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await writeFixture(root, "assets/sprites/enemy.png", PNG_BYTES);
    await emitAndSettle(plugin, server, "add", join(root, "assets", "sprites", "enemy.png"));

    const changed = server.sent.find((payload) => payload["event"] === ASSET_CHANGED_EVENT);
    expect(changed?.["data"]).toEqual({
      address: "sprites/enemy.png",
      kind: "added",
      url: "/assets/sprites/enemy.png",
    });
    const manifest = JSON.parse(server.request("/assets.manifest.json").body ?? "") as AssetManifest;
    expect(manifest.entries.map((entry) => entry.address)).toContain("sprites/enemy.png");
  });

  it("announces a removed asset", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await rm(join(root, "assets", "sprites", "hero.png"));
    await rm(join(root, "assets", "sprites", "hero.png.meta.json"));
    await emitAndSettle(plugin, server, "unlink", join(root, "assets", "sprites", "hero.png"));

    const changed = server.sent.find((payload) => payload["event"] === ASSET_CHANGED_EVENT);
    expect(changed?.["data"]).toMatchObject({ address: "sprites/hero.png", kind: "removed" });
  });

  it("reports a sidecar edit as a change to the asset it belongs to", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await writeFixture(root, "assets/sprites/hero.png.meta.json", JSON.stringify({ groups: ["level2"] }));
    await emitAndSettle(plugin, server, "change", join(root, "assets", "sprites", "hero.png.meta.json"));

    const changed = server.sent.find((payload) => payload["event"] === ASSET_CHANGED_EVENT);
    expect(changed?.["data"]).toMatchObject({ address: "sprites/hero.png", kind: "changed" });
    const manifest = JSON.parse(server.request("/assets.manifest.json").body ?? "") as AssetManifest;
    expect(manifest.entries.find((entry) => entry.address === "sprites/hero.png")?.groups).toEqual(["level2"]);
  });

  it("triggers a full reload when the project config changes", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await emitAndSettle(plugin, server, "change", join(root, "ignifx.config.ts"));
    expect(server.sent).toContainEqual({ type: "full-reload", path: "*" });
  });

  it("ignores changes outside the asset root", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await emitAndSettle(plugin, server, "change", join(root, "src", "main.ts"));
    expect(server.sent).toEqual([]);
  });

  it("ignores a dot-prefixed file inside the asset root", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await emitAndSettle(plugin, server, "change", join(root, "assets", ".DS_Store"));
    expect(server.sent).toEqual([]);
  });

  it("reports a validation failure to the terminal and the browser overlay", async () => {
    const root = await createFixtureTree({ "assets/levels/bad.scene.json": "{}" });
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    expect(server.logs.some((entry) => entry.level === "error" && entry.message.includes("IGX-0651"))).toBe(true);
    expect(server.sent.some((payload) => payload["type"] === "error")).toBe(true);
  });

  it("keeps serving after a broken scene file is fixed on disk", async () => {
    const root = await createFixtureTree({ "assets/levels/level1.scene.json": "{}" });
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await writeFixture(root, "assets/levels/level1.scene.json", VALID_SCENE);
    await emitAndSettle(plugin, server, "change", join(root, "assets", "levels", "level1.scene.json"));

    const errorsAfterFix = server.sent.filter((payload) => payload["type"] === "error");
    expect(errorsAfterFix).toHaveLength(1);
    expect(await readFile(join(root, "assets", "levels", "level1.scene.json"), "utf8")).toBe(VALID_SCENE);
  });
});

describe("URL composition", () => {
  it("prefixes development URLs with a non-root base", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    const hooks = harness(plugin);
    await hooks.config({ root }, { command: "serve", mode: "development" });
    hooks.configResolved({ root, base: "/game/", command: "serve" });
    const source = await hooks.load.call(new FakePluginContext(), RESOLVED_MANIFEST_MODULE_ID);
    expect(parseManifestModule(source ?? "").entries[0]?.url).toBe("/game/assets/levels/level1.scene.json");
  });

  it("adds the missing trailing slash to a base that lacks one", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    const hooks = harness(plugin);
    await hooks.config({ root }, { command: "serve", mode: "development" });
    hooks.configResolved({ root, base: "/game", command: "serve" });
    const source = await hooks.load.call(new FakePluginContext(), RESOLVED_MANIFEST_MODULE_ID);
    expect(parseManifestModule(source ?? "").entries[0]?.url).toBe("/game/assets/levels/level1.scene.json");
  });

  it("treats an empty base as the site root", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    const hooks = harness(plugin);
    await hooks.config({ root }, { command: "serve", mode: "development" });
    hooks.configResolved({ root, base: "", command: "serve" });
    const source = await hooks.load.call(new FakePluginContext(), RESOLVED_MANIFEST_MODULE_ID);
    expect(parseManifestModule(source ?? "").entries[0]?.url).toBe("/assets/levels/level1.scene.json");
  });

  it("reaches an asset root outside the Vite root through Vite's /@fs/ prefix", async () => {
    const root = await createFixtureTree({ "game/index.html": "<html></html>", "shared/a.png": PNG_BYTES });
    const plugin = ignifx({ assetRoot: "../shared" });
    const hooks = harness(plugin);
    const viteRoot = join(root, "game");
    await hooks.config({ root: viteRoot }, { command: "serve", mode: "development" });
    hooks.configResolved({ root: viteRoot, base: "/", command: "serve" });
    const source = await hooks.load.call(new FakePluginContext(), RESOLVED_MANIFEST_MODULE_ID);
    expect(parseManifestModule(source ?? "").entries[0]?.url).toBe(`/@fs${join(root, "shared")}/a.png`);
  });

  it("serves an asset root that is the Vite root itself without a prefix", async () => {
    const root = await createFixtureTree({ "a.png": PNG_BYTES });
    const plugin = ignifx({ assetRoot: "." });
    const hooks = harness(plugin);
    await hooks.config({ root }, { command: "serve", mode: "development" });
    hooks.configResolved({ root, base: "/", command: "serve" });
    const source = await hooks.load.call(new FakePluginContext(), RESOLVED_MANIFEST_MODULE_ID);
    expect(parseManifestModule(source ?? "").entries[0]?.url).toBe("/a.png");
  });
});

describe("failure paths", () => {
  it("fails with IGX-0552 when an extension public asset collides with a hashed asset", async () => {
    const hash = createHash("sha256").update(PNG_BYTES).digest("hex").slice(0, 8);
    const root = await createFixtureTree({
      "assets/x.png": PNG_BYTES,
      "node_modules/@ignifx/clash/package.json": JSON.stringify({
        name: "@ignifx/clash",
        ignifx: { assets: { public: [`./x.${hash}.png`] } },
      }),
      [`node_modules/@ignifx/clash/x.${hash}.png`]: PNG_BYTES,
    });
    const plugin = ignifx();
    await configure(plugin, root, "build");
    await expect(harness(plugin).generateBundle.call(new FakePluginContext())).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.duplicateOutputFile }),
    );
  });

  it("logs a rescan failure instead of crashing the dev server", async () => {
    const root = await projectTree();
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));

    await writeFixture(root, "assets/sprites/hero.png.meta.json", "{oops");
    await emitAndSettle(plugin, server, "change", join(root, "assets", "sprites", "hero.png.meta.json"));

    expect(server.logs.some((entry) => entry.level === "error" && entry.message.includes("IGX-0551"))).toBe(true);
  });

  it("serves an unknown extension type as opaque bytes", async () => {
    const root = await createFixtureTree({
      "assets/a.png": PNG_BYTES,
      "node_modules/@ignifx/odd/package.json": JSON.stringify({
        name: "@ignifx/odd",
        ignifx: { assets: { public: ["./table.sqlite"] } },
      }),
      "node_modules/@ignifx/odd/table.sqlite": "bytes",
    });
    const plugin = ignifx();
    await configure(plugin, root, "serve");
    const server = new FakeDevServer(root);
    await harness(plugin).configureServer(asViteServer(server));
    expect(server.request("/assets/table.sqlite").headers["content-type"]).toBe("application/octet-stream");
  });
});
