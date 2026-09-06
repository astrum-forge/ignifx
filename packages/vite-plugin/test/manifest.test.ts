import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import {
  addressFromRelativePath,
  ASSET_MANIFEST_FORMAT,
  ASSET_MANIFEST_VERSION,
  buildManifest,
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
