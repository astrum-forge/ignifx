import { describe, expect, it } from "vitest";
import {
  assetTypeForAddress,
  DEFAULT_ASSET_TYPE,
  hashedAddress,
  isSidecarFileName,
  splitAssetFileName,
} from "../src/asset-types.js";

describe("assetTypeForAddress", () => {
  it.each([
    ["sprites/hero.png", "texture"],
    ["sprites/hero.JPG", "texture"],
    ["textures/rock.ktx2", "texture"],
    ["models/hero.glb", "model"],
    ["models/hero.gltf", "model"],
    ["levels/level1.scene.json", "scene"],
    ["prefabs/enemy.prefab.json", "scene"],
    ["materials/hero.material.json", "material"],
    ["env/studio.env", "environment"],
    ["env/sky.hdr", "environment"],
    ["fonts/inter.ttf", "font"],
    ["audio/theme.mp3", "audio"],
    ["data/loot.json", "json"],
    ["docs/readme.md", "text"],
    ["wasm/havok.wasm", "binary"],
  ] as const)("classifies %s as %s", (address, expected) => {
    expect(assetTypeForAddress(address)).toBe(expected);
  });

  it("falls back to binary for an unknown extension", () => {
    expect(assetTypeForAddress("data/table.sqlite")).toBe(DEFAULT_ASSET_TYPE);
  });

  it("falls back to binary for a file with no extension", () => {
    expect(assetTypeForAddress("LICENSE")).toBe(DEFAULT_ASSET_TYPE);
  });

  it("classifies an unknown two-segment json extension as plain json", () => {
    expect(assetTypeForAddress("data/quests.table.json")).toBe("json");
  });
});

describe("splitAssetFileName", () => {
  it("keeps a two-segment json extension together", () => {
    expect(splitAssetFileName("level1.scene.json")).toEqual({ stem: "level1", extension: ".scene.json" });
  });

  it("splits an ordinary extension", () => {
    expect(splitAssetFileName("hero.glb")).toEqual({ stem: "hero", extension: ".glb" });
  });

  it("leaves a dotfile whole", () => {
    expect(splitAssetFileName(".gitkeep")).toEqual({ stem: ".gitkeep", extension: "" });
  });

  it("leaves a name with no extension whole", () => {
    expect(splitAssetFileName("LICENSE")).toEqual({ stem: "LICENSE", extension: "" });
  });

  it("treats a plain json file as a single extension", () => {
    expect(splitAssetFileName("loot.json")).toEqual({ stem: "loot", extension: ".json" });
  });
});

describe("hashedAddress", () => {
  it("inserts the hash before the extension", () => {
    expect(hashedAddress("sprites/hero.png", "0a1b2c3d")).toBe("sprites/hero.0a1b2c3d.png");
  });

  it("keeps a two-segment json extension intact so the loader still recognises it", () => {
    expect(hashedAddress("levels/level1.scene.json", "0a1b2c3d")).toBe("levels/level1.0a1b2c3d.scene.json");
  });

  it("handles an address with no directory", () => {
    expect(hashedAddress("hero.glb", "ffff")).toBe("hero.ffff.glb");
  });

  it("handles a file with no extension", () => {
    expect(hashedAddress("data/LICENSE", "ffff")).toBe("data/LICENSE.ffff");
  });
});

describe("isSidecarFileName", () => {
  it("recognises a sidecar", () => {
    expect(isSidecarFileName("hero.png.meta.json")).toBe(true);
  });

  it("does not treat a bare .meta.json as a sidecar of nothing", () => {
    expect(isSidecarFileName(".meta.json")).toBe(false);
  });

  it("rejects an ordinary json file", () => {
    expect(isSidecarFileName("loot.json")).toBe(false);
  });
});
