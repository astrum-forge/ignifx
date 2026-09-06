import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

/**
 * The public surface (`docs/standards/coding-standards.md` §4). This suite asserts the shape of the
 * barrel rather than an exact export list: an exact list churns on every addition, while the
 * structural rules below are the ones an API report cannot check on its own.
 */

/** The names a game reaches for first, which must never quietly disappear. */
const LOAD_BEARING: readonly string[] = [
  "Camera2D",
  "Camera2DFollow",
  "ParallaxLayer",
  "SpriteAnimationAsset",
  "SpriteAnimator",
  "SpriteAtlasAsset",
  "SpriteLayerEffect",
  "SpriteRenderer",
  "Tilemap",
  "TilemapAsset",
  "TilemapRenderer",
  "TwoDService",
  "TWO_D_ERROR_MESSAGES",
  "TWO_D_SETTINGS_SECTION",
  "TWO_D_SYNC_ORDER",
  "VERSION",
  "describeSchemas",
  "importAsepriteAnimations",
  "importAsepriteAtlas",
  "importLdtkLevel",
  "importTexturePackerAtlas",
  "importTiledMap",
  "gridAtlas",
  "mergeTileCollisions",
  "twoD",
  "twoDError",
];

describe("the barrel", () => {
  it("exports everything a game reaches for first", () => {
    for (const name of LOAD_BEARING) {
      expect(Object.hasOwn(barrel, name)).toBe(true);
    }
  });

  it("exports the three asset type names and their extensions", () => {
    expect(barrel.SPRITE_ATLAS_ASSET_TYPE).toBe("spriteatlas");
    expect(barrel.SPRITE_ANIMATION_ASSET_TYPE).toBe("spriteanimation");
    expect(barrel.TILEMAP_ASSET_TYPE).toBe("tilemap");
    expect(barrel.SPRITE_ATLAS_FILE_EXTENSIONS).toEqual([".atlas.json"]);
    expect(barrel.SPRITE_ANIMATION_FILE_EXTENSIONS).toEqual([".spriteanim.json"]);
    expect(barrel.TILEMAP_FILE_EXTENSIONS).toEqual([".tilemap.json"]);
  });

  it("exports nothing undefined", () => {
    for (const [name, value] of Object.entries(barrel)) {
      expect(value, `${name} is undefined`).toBeDefined();
    }
  });

  it("gives every component class a namespaced typeId", () => {
    for (const type of [
      barrel.Camera2D,
      barrel.SpriteRenderer,
      barrel.SpriteAnimator,
      barrel.Tilemap,
      barrel.TilemapRenderer,
      barrel.ParallaxLayer,
      barrel.SpriteLayerEffect,
      barrel.Camera2DFollow,
    ]) {
      expect(type.typeId).toMatch(/^ignifx\//u);
    }
  });

  it("runs nothing at import time", async () => {
    // Importing twice must be observably identical: no counters, no registries, no globals.
    const again = await import("../src/index.js");
    expect(again).toBe(barrel);
    expect(barrel.twoD().name).toBe("@ignifx/2d");
  });

  it("declares every documented error code", () => {
    expect(Object.keys(barrel.TWO_D_ERROR_MESSAGES).length).toBe(Object.values(barrel.TwoDErrorCode).length);
  });
});
