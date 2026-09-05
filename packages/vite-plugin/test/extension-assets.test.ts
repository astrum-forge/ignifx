import { afterAll, describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import { collectExtensionPublicAssets, EXTENSION_KEYWORD } from "../src/extension-assets.js";
import { createFixtureTree, disposeFixtures } from "./support/fixtures.js";

afterAll(disposeFixtures);

/** Renders a package.json for a fixture tree. */
function packageJson(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, null, 2);
}

describe("collectExtensionPublicAssets", () => {
  it("finds the files an @ignifx package lists in ignifx.assets.public", async () => {
    const root = await createFixtureTree({
      "node_modules/@ignifx/physics/package.json": packageJson({
        name: "@ignifx/physics",
        ignifx: { assets: { public: ["./wasm/HavokPhysics.wasm"] } },
      }),
      "node_modules/@ignifx/physics/wasm/HavokPhysics.wasm": "wasm-bytes",
    });
    const files = await collectExtensionPublicAssets(root);
    expect(files).toHaveLength(1);
    expect(files[0]?.packageName).toBe("@ignifx/physics");
    expect(files[0]?.fileName).toBe("HavokPhysics.wasm");
  });

  it("finds an unscoped package that carries the ignifx-extension keyword", async () => {
    const root = await createFixtureTree({
      "node_modules/ignifx-extension-weather/package.json": packageJson({
        name: "ignifx-extension-weather",
        keywords: ["ignifx", EXTENSION_KEYWORD],
        ignifx: { assets: { public: ["./data/clouds.bin"] } },
      }),
      "node_modules/ignifx-extension-weather/data/clouds.bin": "bytes",
    });
    const files = await collectExtensionPublicAssets(root);
    expect(files.map((file) => file.fileName)).toEqual(["clouds.bin"]);
  });

  it("ignores a package without the keyword even when it declares public assets", async () => {
    const root = await createFixtureTree({
      "node_modules/unrelated/package.json": packageJson({
        name: "unrelated",
        ignifx: { assets: { public: ["./x.bin"] } },
      }),
      "node_modules/unrelated/x.bin": "bytes",
    });
    expect(await collectExtensionPublicAssets(root)).toEqual([]);
  });

  it("ignores an ignifx package that declares no public assets", async () => {
    const root = await createFixtureTree({
      "node_modules/@ignifx/core/package.json": packageJson({ name: "@ignifx/core" }),
    });
    expect(await collectExtensionPublicAssets(root)).toEqual([]);
  });

  it("ignores a package.json that is not valid JSON", async () => {
    const root = await createFixtureTree({ "node_modules/@ignifx/broken/package.json": "{oops" });
    expect(await collectExtensionPublicAssets(root)).toEqual([]);
  });

  it("returns nothing when there is no node_modules at all", async () => {
    const root = await createFixtureTree({ "package.json": packageJson({ name: "game" }) });
    expect(await collectExtensionPublicAssets(root)).toEqual([]);
  });

  it("sorts by package name and then file name", async () => {
    const root = await createFixtureTree({
      "node_modules/@ignifx/three-d/package.json": packageJson({
        name: "@ignifx/3d",
        ignifx: { assets: { public: ["./recast.wasm"] } },
      }),
      "node_modules/@ignifx/three-d/recast.wasm": "bytes",
      "node_modules/@ignifx/audio/package.json": packageJson({
        name: "@ignifx/audio",
        ignifx: { assets: { public: ["./b.bin", "./a.bin"] } },
      }),
      "node_modules/@ignifx/audio/a.bin": "bytes",
      "node_modules/@ignifx/audio/b.bin": "bytes",
    });
    const files = await collectExtensionPublicAssets(root);
    expect(files.map((file) => `${file.packageName}:${file.fileName}`)).toEqual([
      "@ignifx/audio:a.bin",
      "@ignifx/audio:b.bin",
      "@ignifx/three-d:recast.wasm",
    ]);
  });

  it("fails with IGX-0553 when a declared file does not exist", async () => {
    const root = await createFixtureTree({
      "node_modules/@ignifx/physics/package.json": packageJson({
        name: "@ignifx/physics",
        ignifx: { assets: { public: ["./wasm/missing.wasm"] } },
      }),
    });
    await expect(collectExtensionPublicAssets(root)).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.extensionAssetMissing }),
    );
  });

  it("fails with IGX-0553 when a declared path is a directory", async () => {
    const root = await createFixtureTree({
      "node_modules/@ignifx/physics/package.json": packageJson({
        name: "@ignifx/physics",
        ignifx: { assets: { public: ["./wasm"] } },
      }),
      "node_modules/@ignifx/physics/wasm/keep.txt": "x",
    });
    await expect(collectExtensionPublicAssets(root)).rejects.toThrow(/is not a file/u);
  });

  it("fails with IGX-0553 when two extensions publish the same file name", async () => {
    const root = await createFixtureTree({
      "node_modules/@ignifx/a/package.json": packageJson({
        name: "@ignifx/a",
        ignifx: { assets: { public: ["./shared.wasm"] } },
      }),
      "node_modules/@ignifx/a/shared.wasm": "one",
      "node_modules/@ignifx/b/package.json": packageJson({
        name: "@ignifx/b",
        ignifx: { assets: { public: ["./shared.wasm"] } },
      }),
      "node_modules/@ignifx/b/shared.wasm": "two",
    });
    await expect(collectExtensionPublicAssets(root)).rejects.toThrow(/must have unique names/u);
  });
});
