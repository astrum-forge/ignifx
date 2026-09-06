import { describe, expect, it } from "vitest";
import {
  decodeTileRle,
  defineTilemap,
  encodeTileRle,
  EMPTY_TILE_ID,
  findTileset,
  TILEMAP_ASSET_TYPE,
  TILEMAP_FILE_EXTENSIONS,
  TILEMAP_FORMAT,
  TILEMAP_FORMAT_VERSION,
  tileCollisionInfo,
  tileFrameName,
} from "../../src/tilemap/definition.js";
import type { TilemapInput } from "../../src/tilemap/definition.js";

/** Asserts that `run` throws an `IgnifxError` carrying `code`. */
function expectCode(run: () => unknown, code: string): void {
  let captured: unknown = null;
  try {
    run();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(Error);
  expect((captured as { readonly code?: string }).code).toBe(code);
}

/** A two-by-two map whose tileset exercises every collider kind. */
const BASE_INPUT: TilemapInput = {
  tileWidth: 32,
  width: 2,
  height: 2,
  tilesets: [
    {
      name: "hero",
      atlas: "hero.atlas.json",
      firstId: 1,
      tiles: [
        {
          id: 0,
          frame: "hero_0",
          collider: { kind: "box", x: 0, y: 0, width: 1, height: 1 },
          properties: { solid: true },
        },
        { id: 1, frame: "hero_1", collider: { kind: "box", x: 0, y: 0, width: 1, height: 0.25, oneWay: true } },
        {
          id: 2,
          frame: "hero_2",
          collider: {
            kind: "polygon",
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        },
        { id: 3, frame: "hero_3" },
        { id: 4, frame: "hero_4", collider: { kind: "none" } },
      ],
    },
  ],
  layers: [{ name: "Ground", tiles: [1, 0, 0, 2] }],
};

describe("the ignifx.tilemap format constants", () => {
  it("names the format, its version, its asset type and its file extension", () => {
    expect(TILEMAP_FORMAT).toBe("ignifx.tilemap");
    expect(TILEMAP_FORMAT_VERSION).toBe(1);
    expect(TILEMAP_ASSET_TYPE).toBe("tilemap");
    expect(TILEMAP_FILE_EXTENSIONS).toEqual([".tilemap.json"]);
    expect(EMPTY_TILE_ID).toBe(0);
  });
});

describe("encodeTileRle and decodeTileRle", () => {
  it("round-trips an empty array", () => {
    expect(encodeTileRle([])).toEqual([]);
    expect(decodeTileRle([])).toEqual([]);
  });

  it("collapses a single run into one pair", () => {
    expect(encodeTileRle([7, 7, 7, 7])).toEqual([4, 7]);
    expect(decodeTileRle([4, 7])).toEqual([7, 7, 7, 7]);
  });

  it("keeps alternating values as one pair each", () => {
    const tiles = [1, 2, 1, 2];
    expect(encodeTileRle(tiles)).toEqual([1, 1, 1, 2, 1, 1, 1, 2]);
    expect(decodeTileRle(encodeTileRle(tiles))).toEqual(tiles);
  });

  it("round-trips a mixed run", () => {
    const tiles = [0, 0, 0, 5, 5, 9, 0];
    expect(encodeTileRle(tiles)).toEqual([3, 0, 2, 5, 1, 9, 1, 0]);
    expect(decodeTileRle(encodeTileRle(tiles))).toEqual(tiles);
  });

  it("rejects an odd-length run-length array", () => {
    expectCode(() => decodeTileRle([2, 1, 3]), "IGX-1105");
  });

  it("rejects a run count that is not a non-negative integer", () => {
    expectCode(() => decodeTileRle([-1, 4]), "IGX-1105");
    expectCode(() => decodeTileRle([1.5, 4]), "IGX-1105");
  });

  it("treats a zero run as contributing nothing", () => {
    expect(decodeTileRle([0, 9, 2, 1])).toEqual([1, 1]);
  });
});

describe("defineTilemap", () => {
  it("fills in every default", () => {
    const map = defineTilemap(BASE_INPUT);
    expect(map.format).toBe(TILEMAP_FORMAT);
    expect(map.formatVersion).toBe(TILEMAP_FORMAT_VERSION);
    expect(map.tileHeight).toBe(32);
    expect(map.cellSize).toBeCloseTo(0.32, 10);
    expect(map.objects).toEqual([]);
    expect(map.properties).toEqual({});
    const layer = map.layers[0];
    expect(layer?.sortingLayer).toBe("Default");
    expect(layer?.orderInLayer).toBe(0);
    expect(layer?.opacity).toBe(1);
    expect(layer?.parallax).toEqual({ x: 1, y: 1 });
    expect(layer?.collision).toBe(false);
    expect(layer?.width).toBe(2);
    expect(layer?.height).toBe(2);
  });

  it("keeps the values an author supplied", () => {
    const map = defineTilemap({
      ...BASE_INPUT,
      tileHeight: 16,
      cellSize: 1,
      objects: [{ name: "a", type: "spawn", x: 0, y: 0, width: 1, height: 1, properties: {} }],
      properties: { biome: "cave" },
      layers: [
        {
          name: "Ground",
          sortingLayer: "Background",
          orderInLayer: 4,
          opacity: 0.5,
          parallax: { x: 0.25, y: 1 },
          collision: true,
          tiles: [1, 0, 0, 2],
        },
      ],
    });
    expect(map.tileHeight).toBe(16);
    expect(map.cellSize).toBe(1);
    expect(map.objects).toHaveLength(1);
    expect(map.properties["biome"]).toBe("cave");
    expect(map.layers[0]?.sortingLayer).toBe("Background");
    expect(map.layers[0]?.orderInLayer).toBe(4);
    expect(map.layers[0]?.opacity).toBe(0.5);
    expect(map.layers[0]?.parallax).toEqual({ x: 0.25, y: 1 });
    expect(map.layers[0]?.collision).toBe(true);
  });

  it("decodes a run-length-encoded layer into a dense array", () => {
    const map = defineTilemap({ ...BASE_INPUT, layers: [{ name: "Ground", tiles: { rle: [2, 1, 2, 0] } }] });
    expect(map.layers[0]?.tiles).toEqual([1, 1, 0, 0]);
  });

  it("sorts tilesets by ascending firstId", () => {
    const map = defineTilemap({
      ...BASE_INPUT,
      tilesets: [
        { name: "b", atlas: "b.atlas.json", firstId: 9, tiles: [{ id: 0, frame: "b_0" }] },
        { name: "a", atlas: "a.atlas.json", firstId: 1, tiles: [{ id: 0, frame: "a_0" }] },
      ],
    });
    expect(map.tilesets.map((tileset) => tileset.name)).toEqual(["a", "b"]);
  });

  it("accepts an empty document with no tilesets and no layers", () => {
    const map = defineTilemap({ tileWidth: 8, width: 1, height: 1 });
    expect(map.tilesets).toEqual([]);
    expect(map.layers).toEqual([]);
  });

  it("rejects a wrong format tag", () => {
    expectCode(() => defineTilemap({ ...BASE_INPUT, format: "ignifx.spriteatlas" }), "IGX-1105");
  });

  it("rejects a formatVersion this build does not read", () => {
    expectCode(() => defineTilemap({ ...BASE_INPUT, formatVersion: 2 }), "IGX-1105");
  });

  it("rejects a non-positive tile size", () => {
    expectCode(() => defineTilemap({ ...BASE_INPUT, tileWidth: 0 }), "IGX-1105");
    expectCode(() => defineTilemap({ ...BASE_INPUT, tileHeight: -8 }), "IGX-1105");
  });

  it("rejects a non-positive map size", () => {
    expectCode(() => defineTilemap({ ...BASE_INPUT, width: 0 }), "IGX-1105");
    expectCode(() => defineTilemap({ ...BASE_INPUT, height: 0 }), "IGX-1105");
  });

  it("rejects a tileset whose firstId collides with the empty tile", () => {
    expectCode(
      () =>
        defineTilemap({
          ...BASE_INPUT,
          tilesets: [{ name: "hero", atlas: "hero.atlas.json", firstId: 0, tiles: [] }],
        }),
      "IGX-1105",
    );
  });

  it("rejects a layer whose decoded tile count is not width times height", () => {
    expectCode(() => defineTilemap({ ...BASE_INPUT, layers: [{ name: "Ground", tiles: [1, 2, 3] }] }), "IGX-1105");
  });

  it("rejects an odd-length run-length layer", () => {
    expectCode(
      () => defineTilemap({ ...BASE_INPUT, layers: [{ name: "Ground", tiles: { rle: [2, 1, 2] } }] }),
      "IGX-1105",
    );
  });

  it("rejects two layers with the same name", () => {
    expectCode(
      () =>
        defineTilemap({
          ...BASE_INPUT,
          layers: [
            { name: "Ground", tiles: [0, 0, 0, 0] },
            { name: "Ground", tiles: [0, 0, 0, 0] },
          ],
        }),
      "IGX-1105",
    );
  });

  it("names the address in the error message", () => {
    let message = "";
    try {
      defineTilemap({ ...BASE_INPUT, formatVersion: 2 }, "cave.tilemap.json");
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("cave.tilemap.json");
  });
});

describe("findTileset and tileFrameName", () => {
  const map = defineTilemap(BASE_INPUT);

  it("resolves a tile id to the tileset with the highest firstId that fits", () => {
    expect(findTileset(map, 1)?.name).toBe("hero");
    expect(findTileset(map, 5)?.name).toBe("hero");
  });

  it("returns null for the empty tile and for an unclaimed id", () => {
    expect(findTileset(map, 0)).toBeNull();
    expect(findTileset(map, -3)).toBeNull();
    expect(findTileset(map, 99)).toBeNull();
    expect(tileFrameName(map, 0)).toBeNull();
    expect(tileFrameName(map, 99)).toBeNull();
  });

  it("names a tile's frame", () => {
    expect(tileFrameName(map, 1)).toBe("hero_0");
    expect(tileFrameName(map, 3)).toBe("hero_2");
  });

  it("falls back to a linear scan when the tiles are not in index order", () => {
    const shuffled = defineTilemap({
      ...BASE_INPUT,
      tilesets: [
        {
          name: "hero",
          atlas: "hero.atlas.json",
          firstId: 1,
          tiles: [
            { id: 1, frame: "hero_1" },
            { id: 0, frame: "hero_0" },
          ],
        },
      ],
      layers: [],
    });
    expect(tileFrameName(shuffled, 1)).toBe("hero_0");
    expect(tileFrameName(shuffled, 2)).toBe("hero_1");
  });

  it("returns null when the tileset has a gap where the id would be", () => {
    const sparse = defineTilemap({
      ...BASE_INPUT,
      tilesets: [
        {
          name: "hero",
          atlas: "hero.atlas.json",
          firstId: 1,
          tiles: [
            { id: 0, frame: "hero_0" },
            { id: 5, frame: "hero_5" },
          ],
        },
      ],
      layers: [],
    });
    expect(tileFrameName(sparse, 2)).toBeNull();
  });
});

describe("tileCollisionInfo", () => {
  const map = defineTilemap(BASE_INPUT);

  it("has no collision for the empty tile or an unclaimed id", () => {
    expect(tileCollisionInfo(map, 0)).toEqual({ shape: { kind: "none" }, oneWay: false, properties: {} });
    expect(tileCollisionInfo(map, 99).shape.kind).toBe("none");
    expect(tileCollisionInfo(map, 99).oneWay).toBe(false);
  });

  it("has no collision for a tile that declares no collider", () => {
    expect(tileCollisionInfo(map, 4).shape.kind).toBe("none");
  });

  it("has no collision for an explicit none collider", () => {
    expect(tileCollisionInfo(map, 5).shape.kind).toBe("none");
  });

  it("converts a full-cell box into cell-local metres", () => {
    const info = tileCollisionInfo(map, 1);
    expect(info.shape).toEqual({ kind: "box", x: 0, y: 0, width: 0.32, height: 0.32 });
    expect(info.oneWay).toBe(false);
    expect(info.properties["solid"]).toBe(true);
  });

  it("flips a top-half box down to the top of a bottom-origin cell", () => {
    const unitMap = defineTilemap({
      ...BASE_INPUT,
      cellSize: 1,
      tilesets: [
        {
          name: "hero",
          atlas: "hero.atlas.json",
          firstId: 1,
          tiles: [{ id: 0, frame: "hero_0", collider: { kind: "box", x: 0, y: 0, width: 1, height: 0.5 } }],
        },
      ],
      layers: [],
    });
    // Authored as the TOP half (y measured down from the cell's top); at runtime the box sits at
    // the top of the cell, so its bottom edge is at 0.5 and it reaches 1.0.
    expect(unitMap.cellSize).toBe(1);
    expect(tileCollisionInfo(unitMap, 1).shape).toEqual({ kind: "box", x: 0, y: 0.5, width: 1, height: 0.5 });
  });

  it("carries oneWay through from the collider", () => {
    const info = tileCollisionInfo(map, 2);
    expect(info.oneWay).toBe(true);
    expect(info.shape.kind).toBe("box");
    if (info.shape.kind === "box") {
      expect(info.shape.y).toBeCloseTo(0.24, 10);
      expect(info.shape.height).toBeCloseTo(0.08, 10);
    }
  });

  it("flips a polygon's y and reverses its winding", () => {
    const info = tileCollisionInfo(map, 3);
    expect(info.shape.kind).toBe("polygon");
    if (info.shape.kind !== "polygon") {
      return;
    }
    // Authored clockwise in top-left space: (0,0) → (1,0) → (1,1).
    expect(info.shape.points).toEqual([
      { x: 0.32, y: 0 },
      { x: 0.32, y: 0.32 },
      { x: 0, y: 0.32 },
    ]);
    // …and counter-clockwise once flipped, which is what a physics backend expects.
    expect(signedArea(info.shape.points)).toBeGreaterThan(0);
  });
});

/** Twice the signed area of a ring; positive when the ring is wound counter-clockwise. */
function signedArea(points: readonly { readonly x: number; readonly y: number }[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) {
      continue;
    }
    total += current.x * next.y - next.x * current.y;
  }
  return total;
}
