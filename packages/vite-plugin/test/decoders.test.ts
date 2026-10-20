import { mkdir, readFile, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { ignifx } from "../src/plugin.js";
import { createFixtureTree, disposeFixtures } from "./support/fixtures.js";
import type { AssetManifest } from "../src/manifest.js";

/**
 * Babylon Lite's run-time decoders, served from the project's own origin (engine ask E13).
 *
 * `@ignifx/core` ships the KTX2 decoder, its transcoders and the meshopt decoder in `decoders/`
 * and lists them in `ignifx.assets.public`, so the plugin's extension-asset path serves them in
 * development and copies them into the build — the same path as Havok's WASM. These tests run the
 * plugin against the **real** core package, linked into a fixture project the way pnpm links it,
 * so a file missing from core's manifest or from its `files` would show here.
 */

afterAll(disposeFixtures);

/** The workspace's `@ignifx/core`. */
const CORE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../core");

/**
 * The decoder files core declares, by bare file name.
 *
 * @returns The names, sorted.
 */
async function coreDecoderFiles(): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(CORE_DIRECTORY, "package.json"), "utf8")) as {
    readonly ignifx: { readonly assets: { readonly public: readonly string[] } };
  };
  return manifest.ignifx.assets.public.map((path) => path.slice(path.lastIndexOf("/") + 1)).toSorted();
}

/**
 * A tiny project that depends on `@ignifx/core`, linked rather than copied.
 *
 * @returns The project root.
 */
async function projectWithCore(): Promise<string> {
  const root = await createFixtureTree({
    "index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
    "src/main.ts":
      'import { manifest } from "virtual:ignifx/manifest";\ndocument.title = String(manifest.entries.length);',
    "assets/textures/rock.ktx2": new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb]),
  });
  await mkdir(join(root, "node_modules", "@ignifx"), { recursive: true });
  await symlink(CORE_DIRECTORY, join(root, "node_modules", "@ignifx", "core"), "dir");
  return root;
}

describe("Lite's decoders in a vite build", () => {
  it("copies every decoder into the build unhashed and lists it at a same-origin URL", async () => {
    const files = await coreDecoderFiles();
    expect(files).toContain("babylon.ktx2Decoder.js");
    expect(files).toContain("msc_basis_transcoder.wasm");
    expect(files).toContain("meshopt_decoder.js");

    const root = await projectWithCore();
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [ignifx()],
      build: { outDir: "dist", emptyOutDir: true },
    });
    const outDir = join(root, "dist");
    const manifest = JSON.parse(await readFile(join(outDir, "assets.manifest.json"), "utf8")) as AssetManifest;

    const built = await Promise.all(files.map(async (file) => readFile(join(outDir, "assets", file))));
    const shipped = await Promise.all(files.map(async (file) => readFile(join(CORE_DIRECTORY, "decoders", file))));
    for (const [index, bytes] of built.entries()) {
      expect(Buffer.compare(bytes, shipped[index] ?? Buffer.alloc(0)), files[index]).toBe(0);
    }

    for (const file of files) {
      const entry = manifest.entries.find((candidate) => candidate.address === file);
      expect(entry?.url, file).toBe(`/assets/${file}`);
    }
    // A packaged game's CSP is `script-src 'self'`: nothing the manifest names may live elsewhere.
    for (const entry of manifest.entries) {
      expect(entry.url).not.toMatch(/^[a-z]+:\/\//u);
    }
    // The project's own `.ktx2` is an ordinary hashed texture.
    const rock = manifest.entries.find((entry) => entry.address === "textures/rock.ktx2");
    expect(rock?.type).toBe("texture");
    expect(rock?.url).toMatch(/^\/assets\/textures\/rock\.[0-9a-f]{8}\.ktx2$/u);
  });

  it("serves the decoders from the dev server with script and WASM content types", async () => {
    const root = await projectWithCore();
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [ignifx()],
      server: { port: 0, host: "127.0.0.1", ws: false },
    });
    try {
      await server.listen();
      const origin = server.resolvedUrls?.local[0] ?? "";
      expect(origin).not.toBe("");

      const script = await fetch(new URL("assets/babylon.ktx2Decoder.js", origin));
      expect(script.status).toBe(200);
      expect(script.headers.get("content-type")).toBe("text/javascript");
      expect(await script.text()).toContain("KTX2DECODER");

      const wasm = await fetch(new URL("assets/msc_basis_transcoder.wasm", origin));
      expect(wasm.status).toBe(200);
      expect(wasm.headers.get("content-type")).toBe("application/wasm");

      const listed = (await (await fetch(new URL("assets.manifest.json", origin))).json()) as AssetManifest;
      expect(listed.entries.find((entry) => entry.address === "meshopt_decoder.js")?.url).toBe(
        "/assets/meshopt_decoder.js",
      );
    } finally {
      await server.close();
    }
  });
});
