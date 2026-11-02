import { afterEach, describe, expect, it } from "vitest";
import { defineTilemap, tileCollisionInfo, tileFrameName } from "../../src/tilemap/definition.js";
import { importLdtkLevel } from "../../src/tilemap/importers/ldtk.js";
import { importTiledMap } from "../../src/tilemap/importers/tiled.js";
import { createTwoDApp, readFixture, readFixtureBytes, readFixtureJson } from "../support/app.js";
import type { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import type { TilemapDefinition, TilemapInput } from "../../src/tilemap/definition.js";
import type { TilemapAsset } from "../../src/tilemap/tilemap-asset.js";
import type { TwoDAppHarness } from "../support/app.js";

/**
 * The files `ignifx import tilemap` writes from Tiled and LDtk sources (`@ignifx/cli`), loaded
 * through this package's loaders. `packages/cli/test/convert-tilemap.test.ts` checks that the
 * command writes exactly these committed files, byte for byte; `@ignifx/cli` may not import this
 * package, so the two tests meet at the fixtures.
 */

/** Where the command's expected outputs live, under the fixture root and as asset addresses. */
const EXPECTED = "import/expected/";

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Serves the expected outputs at `2d/import/expected/...`, with the fixture hero image standing in
 * for each tileset image.
 *
 * @param names - The files under `import/expected/`.
 * @param images - The image paths under `import/expected/` to serve.
 * @returns The harness.
 */
async function serve(names: readonly string[], images: readonly string[]): Promise<TwoDAppHarness> {
  const files: Record<string, ArrayBuffer | string> = {};
  for (const name of names) {
    files[`2d/${EXPECTED}${name}`] = readFixture(`${EXPECTED}${name}`);
  }
  for (const image of images) {
    files[`2d/${EXPECTED}${image}`] = readFixtureBytes("hero.png");
  }
  harness = await createTwoDApp({ files });
  return harness;
}

/**
 * Rounds every number in a JSON value to six decimals, the precision the command writes.
 *
 * @param value - The value.
 * @returns A rounded copy.
 */
function rounded(value: unknown): unknown {
  if (typeof value === "number") {
    return Math.round(value * 1e6) / 1e6;
  }
  if (Array.isArray(value)) {
    return value.map(rounded);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rounded(entry)]));
  }
  return value;
}

describe("a Tiled map converted by ignifx import tilemap", () => {
  it("loads through the tilemap and atlas loaders", async () => {
    const h = await serve(
      ["tiled/level.tilemap.json", "tiled/tilesets/terrain.atlas.json"],
      ["tiled/tilesets/terrain.png"],
    );
    const map = (await h.load<TilemapAsset>(`2d/${EXPECTED}tiled/level.tilemap.json`)).value;
    const definition = map.definition;
    expect(definition.layers.map((layer) => layer.name)).toEqual(["Back/Sky", "Ground"]);
    expect(definition.layers[1]?.tiles).toEqual([0, 0, 0, 0, 0, 0, 2, 0, 1, 1, 1, 1]);
    expect(definition.layers[1]?.collision).toBe(true);
    expect(definition.objects.map((object) => object.type)).toEqual(["spawn", "coin"]);
    expect(tileCollisionInfo(definition, 2).oneWay).toBe(true);
    expect(tileFrameName(definition, 3)).toBe("terrain_2");
    expect(map.atlasFor(0)).toBe(`2d/${EXPECTED}tiled/tilesets/terrain.atlas.json`);
    const atlas = (await h.load<SpriteAtlasAsset>(map.atlasFor(0))).value;
    expect(atlas.definition.frames.map((frame) => frame.name)).toEqual([
      "terrain_0",
      "terrain_1",
      "terrain_2",
      "terrain_3",
    ]);
    expect(atlas.definition.sampling).toBe("nearest");
  });
});

describe("an LDtk project converted by ignifx import tilemap", () => {
  it("loads every level and the atlas", async () => {
    const h = await serve(
      ["ldtk/Level_0.tilemap.json", "ldtk/Level_1.tilemap.json", "ldtk/cave.atlas.json"],
      ["ldtk/cave.png"],
    );
    const level0 = (await h.load<TilemapAsset>(`2d/${EXPECTED}ldtk/Level_0.tilemap.json`)).value;
    expect(level0.definition.layers.map((layer) => layer.name)).toEqual(["Walls.tiles", "Walls", "Decor", "Shadows"]);
    expect(level0.definition.objects[0]).toMatchObject({ name: "Hero", type: "Player" });
    expect(tileCollisionInfo(level0.definition, 6).oneWay).toBe(true);
    const level1 = (await h.load<TilemapAsset>(`2d/${EXPECTED}ldtk/Level_1.tilemap.json`)).value;
    expect(level1.definition.width).toBe(2);
    expect(level1.definition.layers[0]?.tiles).toEqual([0, 0, 5, 5]);
    const atlas = (await h.load<SpriteAtlasAsset>(level0.atlasFor(0))).value;
    expect(atlas.frameCount).toBe(4);
  });
});

describe("the command and this package's importers agree", () => {
  it("on the Tiled sample", () => {
    const converted = defineTilemap(JSON.parse(readFixture(`${EXPECTED}sample/sample.tilemap.json`)) as TilemapInput);
    const imported: TilemapDefinition = importTiledMap(readFixtureJson("sample.tmj"));
    expect(rounded(converted)).toEqual(rounded(imported));
  });

  it("on the LDtk sample, with flipped tiles dropped", () => {
    const converted = defineTilemap(JSON.parse(readFixture(`${EXPECTED}sample/Level_0.tilemap.json`)) as TilemapInput);
    const imported: TilemapDefinition = importLdtkLevel(readFixtureJson("sample.ldtk"));
    expect(rounded(converted)).toEqual(rounded(imported));
  });
});
