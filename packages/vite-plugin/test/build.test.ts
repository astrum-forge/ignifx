import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { ignifx } from "../src/plugin.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES, VALID_SCENE } from "./support/fixtures.js";
import type { AssetManifest } from "../src/manifest.js";

afterAll(disposeFixtures);

/**
 * A complete, tiny Vite project: an HTML entry, one script the registry must pick up, an asset
 * tree with a sidecar and a nested folder, an extension package with a public WASM file, and a
 * project config.
 */
function fixtureProject(): Promise<string> {
  return createFixtureTree({
    "index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
    "src/main.ts": [
      'import { manifest } from "virtual:ignifx/manifest";',
      'import { scripts } from "virtual:ignifx/scripts";',
      "",
      "const settings = import.meta.env.IGNIFX_CONFIG;",
      "document.title = [manifest.entries.length, scripts.length, settings.layers.join('-')].join(':');",
    ].join("\n"),
    "src/scripts/mover.ts": [
      "export class Mover {",
      '  static typeId = "mygame/Mover";',
      "}",
      "export function helper(): number {",
      "  return 1;",
      "}",
    ].join("\n"),
    "ignifx.config.ts": "export default { layers: ['Default', 'Player'] };",
    "assets/sprites/hero.png": PNG_BYTES,
    "assets/sprites/hero.png.meta.json": JSON.stringify({ groups: ["boot"], texture: { srgb: true } }),
    "assets/levels/level1.scene.json": VALID_SCENE,
    "assets/data/loot.json": JSON.stringify({ table: [] }),
    "node_modules/@ignifx/physics/package.json": JSON.stringify({
      name: "@ignifx/physics",
      ignifx: { assets: { public: ["./HavokPhysics.wasm"] } },
    }),
    "node_modules/@ignifx/physics/HavokPhysics.wasm": "wasm-bytes",
  });
}

/** Lists every file under a directory, `/`-separated and sorted. */
async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listFiles(join(directory, entry.name), path) : [path];
    }),
  );
  return groups.flat().toSorted();
}

describe("vite build with the ignifx plugin", () => {
  it("writes a hashed asset tree, the manifest, the extension WASM, and the injected config", async () => {
    const root = await fixtureProject();
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [ignifx()],
      build: { outDir: "dist", emptyOutDir: true },
    });

    const outDir = join(root, "dist");
    const files = await listFiles(outDir);
    const manifest = JSON.parse(await readFile(join(outDir, "assets.manifest.json"), "utf8")) as AssetManifest;

    expect(manifest.format).toBe("ignifx.manifest");
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.root).toBe("assets");
    expect(manifest.entries.map((entry) => entry.address)).toEqual([
      "data/loot.json",
      "levels/level1.scene.json",
      "sprites/hero.png",
    ]);

    // Every URL in the manifest names a file that really was written.
    for (const entry of manifest.entries) {
      expect(files).toContain(entry.url.replace(/^\//u, ""));
      expect(entry.url).toMatch(/^\/assets\/.+\.[0-9a-f]{8}\./u);
    }

    // Extension public assets are copied unhashed, because their loaders ask for them by name.
    expect(files).toContain("assets/HavokPhysics.wasm");
    expect(await readFile(join(outDir, "assets", "HavokPhysics.wasm"), "utf8")).toBe("wasm-bytes");

    // The sidecar's groups and remaining fields survive into the entry.
    const hero = manifest.entries.find((entry) => entry.address === "sprites/hero.png");
    expect(hero?.groups).toEqual(["boot"]);
    expect(hero?.meta).toEqual({ texture: { srgb: true } });
    expect(hero?.bytes).toBe(PNG_BYTES.byteLength);
    expect(hero?.type).toBe("texture");

    // The bundled entry chunk carries the manifest, the script registry, and the project config.
    const bundle = files.find((file) => file.startsWith("assets/index") && file.endsWith(".js"));
    const code = await readFile(join(outDir, bundle ?? ""), "utf8");
    expect(code).toContain("ignifx.manifest");
    expect(code).toContain("mygame/Mover");
    expect(code).toContain("Player");
  });

  it("fails the build when a scene file under the asset root is invalid", async () => {
    const root = await createFixtureTree({
      "index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
      "src/main.ts": "document.title = 'x';",
      "assets/levels/broken.scene.json": "{}",
    });
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [ignifx()],
        build: { outDir: "dist", emptyOutDir: true },
      }),
    ).rejects.toThrow(/IGX-0651/u);
  });
});
