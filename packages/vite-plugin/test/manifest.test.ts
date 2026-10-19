import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import {
  addressFromRelativePath,
  ASSET_MANIFEST_FORMAT,
  ASSET_MANIFEST_VERSION,
  buildManifest,
  EDITOR_SIDECAR_KEYS,
  scanAssetRoot,
  serializeManifest,
} from "../src/manifest.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES, VALID_SCENE } from "./support/fixtures.js";
import type { ScannedAsset } from "../src/manifest.js";

afterAll(disposeFixtures);

/** A fixture asset tree with a nested folder, a sidecar, and a scene file. */
function assetTree(): Promise<string> {
  return createFixtureTree({
    "assets/sprites/hero.png": PNG_BYTES,
    "assets/sprites/hero.png.meta.json": JSON.stringify({ groups: ["boot", "level1"], texture: { srgb: true } }),
    "assets/levels/level1.scene.json": VALID_SCENE,
    "assets/data/loot.json": JSON.stringify({ table: [] }),
    "assets/.hidden/secret.png": PNG_BYTES,
    "assets/.dotfile.png": PNG_BYTES,
  });
}

describe("scanAssetRoot", () => {
  it("lists every asset sorted by address", async () => {
    const root = await assetTree();
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets") });
    expect(assets.map((asset) => asset.address)).toEqual([
      "data/loot.json",
      "levels/level1.scene.json",
      "sprites/hero.png",
    ]);
  });

  it("skips dotfiles, dot-directories, and sidecars", async () => {
    const root = await assetTree();
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets") });
    expect(assets.some((asset) => asset.address.includes(".hidden"))).toBe(false);
    expect(assets.some((asset) => asset.address.endsWith(".meta.json"))).toBe(false);
  });

  it("records the sha256 prefix, truncated to hashLength", async () => {
    const root = await assetTree();
    const [, , hero] = await scanAssetRoot({ assetRoot: join(root, "assets"), hashLength: 12 });
    const expected = createHash("sha256").update(PNG_BYTES).digest("hex").slice(0, 12);
    expect(hero?.hash).toBe(expected);
    expect(hero?.bytes).toBe(PNG_BYTES.byteLength);
  });

  it("reads groups from the sidecar and passes the rest through as meta", async () => {
    const root = await assetTree();
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets") });
    const hero = assets.find((asset) => asset.address === "sprites/hero.png");
    expect(hero?.groups).toEqual(["boot", "level1"]);
    expect(hero?.meta).toEqual({ texture: { srgb: true } });
  });

  it("leaves groups empty and meta null for an asset with no sidecar", async () => {
    const root = await assetTree();
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets") });
    const loot = assets.find((asset) => asset.address === "data/loot.json");
    expect(loot?.groups).toEqual([]);
    expect(loot?.meta).toBeNull();
  });

  it("leaves meta null when the sidecar declares only groups", async () => {
    const root = await createFixtureTree({
      "assets/a.png": PNG_BYTES,
      "assets/a.png.meta.json": JSON.stringify({ groups: ["boot"] }),
    });
    const [asset] = await scanAssetRoot({ assetRoot: join(root, "assets") });
    expect(asset?.meta).toBeNull();
  });

  it("lists an unpublished asset with publish false and keeps publish out of meta", async () => {
    const root = await createFixtureTree({
      "assets/hidden.png": PNG_BYTES,
      "assets/hidden.png.meta.json": JSON.stringify({ publish: false, texture: { srgb: true } }),
      "assets/shown.png": PNG_BYTES,
      "assets/shown.png.meta.json": JSON.stringify({ publish: true }),
      "assets/plain.png": PNG_BYTES,
    });
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets") });
    expect(assets.map((asset) => [asset.address, asset.publish, asset.meta])).toEqual([
      ["hidden.png", false, { texture: { srgb: true } }],
      ["plain.png", true, null],
      ["shown.png", true, null],
    ]);
  });

  it("keeps editor-owned keys in meta, for tools that read the sidecar through the scan", async () => {
    const editorFields = { guid: "01K7R5X8W2T9Z4A1B6C3D5E7F9", importer: { name: "image", version: 3 } };
    const root = await createFixtureTree({
      "assets/a.png": PNG_BYTES,
      "assets/a.png.meta.json": JSON.stringify(editorFields),
    });
    const [asset] = await scanAssetRoot({ assetRoot: join(root, "assets") });
    expect(asset?.meta).toEqual(editorFields);
  });

  it("fails with IGX-0551 when publish is not a boolean", async () => {
    const root = await createFixtureTree({
      "assets/a.png": PNG_BYTES,
      "assets/a.png.meta.json": JSON.stringify({ publish: "false" }),
    });
    await expect(scanAssetRoot({ assetRoot: join(root, "assets") })).rejects.toThrow(
      expect.objectContaining({
        code: VitePluginErrorCode.invalidSidecar,
        message: expect.stringContaining('"publish"'),
      }),
    );
  });

  it("fails with IGX-0550 when the asset root does not exist", async () => {
    const root = await createFixtureTree({ "keep.txt": "x" });
    await expect(scanAssetRoot({ assetRoot: join(root, "assets") })).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.assetRootMissing }),
    );
  });

  it("fails with IGX-0550 when the asset root is a file", async () => {
    const root = await createFixtureTree({ assets: "not a directory" });
    await expect(scanAssetRoot({ assetRoot: join(root, "assets") })).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.assetRootMissing }),
    );
  });

  it("fails with IGX-0551 when a sidecar is not JSON", async () => {
    const root = await createFixtureTree({ "assets/a.png": PNG_BYTES, "assets/a.png.meta.json": "{oops" });
    await expect(scanAssetRoot({ assetRoot: join(root, "assets") })).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidSidecar }),
    );
  });

  it("fails with IGX-0551 when a sidecar is not an object", async () => {
    const root = await createFixtureTree({ "assets/a.png": PNG_BYTES, "assets/a.png.meta.json": "[]" });
    await expect(scanAssetRoot({ assetRoot: join(root, "assets") })).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidSidecar }),
    );
  });

  it("fails with IGX-0551 when groups is not an array of strings", async () => {
    const root = await createFixtureTree({
      "assets/a.png": PNG_BYTES,
      "assets/a.png.meta.json": JSON.stringify({ groups: [1] }),
    });
    await expect(scanAssetRoot({ assetRoot: join(root, "assets") })).rejects.toThrow(
      expect.objectContaining({ code: VitePluginErrorCode.invalidSidecar }),
    );
  });
});

describe("buildManifest", () => {
  const asset: ScannedAsset = {
    address: "sprites/hero.png",
    filePath: "/p/assets/sprites/hero.png",
    bytes: 10,
    hash: "0a1b2c3d",
    type: "texture",
    groups: ["boot"],
    meta: null,
  };

  it("carries the format header the runtime looks for", () => {
    const manifest = buildManifest([], "assets", () => "");
    expect(manifest.format).toBe(ASSET_MANIFEST_FORMAT);
    expect(manifest.formatVersion).toBe(ASSET_MANIFEST_VERSION);
    expect(manifest.root).toBe("assets");
    expect(manifest.entries).toEqual([]);
  });

  it("emits exactly the entry keys @ignifx/core reads, and omits meta when there is none", () => {
    const [entry] = buildManifest([asset], "assets", (candidate) => `/assets/${candidate.address}`).entries;
    expect(Object.keys(entry ?? {})).toEqual(["address", "url", "bytes", "hash", "type", "groups"]);
    expect(entry?.url).toBe("/assets/sprites/hero.png");
  });

  it("includes meta when the sidecar carried more than groups", () => {
    const withMeta: ScannedAsset = { ...asset, meta: { texture: { srgb: true } } };
    const [entry] = buildManifest([withMeta], "assets", () => "/u").entries;
    expect(Object.keys(entry ?? {})).toEqual(["address", "url", "bytes", "hash", "type", "groups", "meta"]);
    expect(entry?.meta).toEqual({ texture: { srgb: true } });
  });
});

describe("buildManifest and the sidecar's publish flag", () => {
  const asset: ScannedAsset = {
    address: "sprites/hero.png",
    filePath: "/p/assets/sprites/hero.png",
    bytes: 10,
    hash: "0a1b2c3d",
    type: "texture",
    groups: [],
    meta: null,
  };

  it("leaves out an asset with publish false", () => {
    const hidden: ScannedAsset = { ...asset, address: "sources/hero.psd", publish: false };
    const manifest = buildManifest([hidden, asset], "assets", () => "/u");
    expect(manifest.entries.map((entry) => entry.address)).toEqual(["sprites/hero.png"]);
  });

  it("lists an asset with publish true exactly as one with no publish field", () => {
    const shown: ScannedAsset = { ...asset, publish: true, meta: { texture: { srgb: true } } };
    const plain: ScannedAsset = { ...asset, meta: { texture: { srgb: true } } };
    expect(buildManifest([shown], "assets", () => "/u")).toEqual(buildManifest([plain], "assets", () => "/u"));
  });
});

describe("buildManifest and editor-owned sidecar keys", () => {
  const editorFields = {
    guid: "01K7R5X8W2T9Z4A1B6C3D5E7F9",
    importer: { name: "image", version: 3 },
    source: { hash: "sha256:00" },
    outputs: ["textures/rock.ktx2"],
    options: { srgb: true, mipmaps: true },
  };
  const asset: ScannedAsset = {
    address: "textures/rock.png",
    filePath: "/p/assets/textures/rock.png",
    bytes: 10,
    hash: "0a1b2c3d",
    type: "texture",
    groups: ["level1"],
    meta: null,
  };

  it("names every key the editor writes", () => {
    expect([...EDITOR_SIDECAR_KEYS].toSorted()).toEqual(Object.keys(editorFields).toSorted());
  });

  it("strips the editor's keys from meta and passes every other key through", () => {
    const withFields: ScannedAsset = {
      ...asset,
      meta: { ...editorFields, texture: { srgb: true }, custom: { anything: [1, "two", null] } },
    };
    const [entry] = buildManifest([withFields], "assets", () => "/u").entries;
    expect(entry?.meta).toEqual({ texture: { srgb: true }, custom: { anything: [1, "two", null] } });
    expect(entry?.groups).toEqual(["level1"]);
  });

  it("omits meta when the sidecar held only editor keys", () => {
    const [entry] = buildManifest([{ ...asset, meta: editorFields }], "assets", () => "/u").entries;
    expect(entry).not.toHaveProperty("meta");
  });

  it("keeps an editor key name nested inside a loader's block", () => {
    const nested: ScannedAsset = { ...asset, meta: { texture: { source: "albedo", options: {} } } };
    const [entry] = buildManifest([nested], "assets", () => "/u").entries;
    expect(entry?.meta).toEqual({ texture: { source: "albedo", options: {} } });
  });
});

describe("serializeManifest", () => {
  it("writes indented JSON with a trailing newline", () => {
    const text = serializeManifest(buildManifest([], "assets", () => ""));
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "format": "ignifx.manifest"');
  });
});

describe("addressFromRelativePath", () => {
  it("returns a /-separated address", () => {
    expect(addressFromRelativePath(join("sprites", "hero.png"))).toBe("sprites/hero.png");
  });
});
