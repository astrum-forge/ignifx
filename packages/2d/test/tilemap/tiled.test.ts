import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tileCollisionInfo, tileFrameName } from "../../src/tilemap/definition.js";
import { importTiledMap, tiledPropertiesToRecord } from "../../src/tilemap/importers/tiled.js";
import type { TilemapDefinition } from "../../src/tilemap/definition.js";

/** The committed Tiled fixture: a 4x4 orthogonal map with one tile layer and one object layer. */
const SAMPLE: unknown = JSON.parse(
  readFileSync(new URL("../../../../tests/fixtures/assets/2d/sample.tmj", import.meta.url), "utf8"),
);

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

/** Reads a cell out of a layer using +Y-up cell coordinates, where `y = 0` is the bottom row. */
function tileAt(map: TilemapDefinition, layerIndex: number, x: number, y: number): number {
  const layer = map.layers[layerIndex];
  if (layer === undefined) {
    return 0;
  }
  return layer.tiles[(layer.height - 1 - y) * layer.width + x] ?? 0;
}

/** The fixture as a mutable JSON object, so a test can break one field. */
function withOverride(patch: Readonly<Record<string, unknown>>): unknown {
  return { ...(SAMPLE as Record<string, unknown>), ...patch };
}

describe("importTiledMap on the sample fixture", () => {
  const map = importTiledMap(SAMPLE);

  it("reads the map's size in cells and pixels", () => {
    expect(map.width).toBe(4);
    expect(map.height).toBe(4);
    expect(map.tileWidth).toBe(32);
    expect(map.tileHeight).toBe(32);
    expect(map.cellSize).toBeCloseTo(0.32, 10);
  });

  it("emits one tile layer and puts the object layer's objects in `objects`", () => {
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]?.name).toBe("Ground");
    expect(map.layers[0]?.sortingLayer).toBe("Default");
    expect(map.layers[0]?.orderInLayer).toBe(0);
    expect(map.layers[0]?.parallax).toEqual({ x: 1, y: 1 });
    expect(map.objects).toHaveLength(1);
  });

  it("keeps the tile data dense, row-major and top row first", () => {
    expect(map.layers[0]?.tiles).toEqual([0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 0, 1, 1, 1, 2]);
  });

  it("lands the 3x2 solid block on the bottom-left six cells", () => {
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        expect(tileAt(map, 0, x, y)).toBe(1);
        expect(tileCollisionInfo(map, tileAt(map, 0, x, y)).shape).toEqual({
          kind: "box",
          x: 0,
          y: 0,
          width: map.cellSize,
          height: map.cellSize,
        });
      }
    }
    expect(tileAt(map, 0, 3, 1)).toBe(0);
    expect(tileAt(map, 0, 3, 2)).toBe(3);
  });

  it("makes gid 2 a one-way platform that occupies the top quarter of its cell", () => {
    expect(tileAt(map, 0, 3, 0)).toBe(2);
    const info = tileCollisionInfo(map, 2);
    expect(info.oneWay).toBe(true);
    expect(info.properties["oneWay"]).toBe(true);
    expect(info.shape.kind).toBe("box");
    if (info.shape.kind === "box") {
      expect(info.shape.y).toBeCloseTo(0.24, 10);
      expect(info.shape.height).toBeCloseTo(0.08, 10);
      expect(info.shape.width).toBeCloseTo(0.32, 10);
    }
  });

  it("gives tile index 2 its two animation frames", () => {
    const animation = map.tilesets[0]?.tiles[2]?.animation;
    expect(animation).toEqual([
      { frame: "hero_2", durationMs: 250 },
      { frame: "hero_3", durationMs: 250 },
    ]);
  });

  it("names frames `<tileset>_<index>` and maps the image to an atlas address", () => {
    expect(map.tilesets[0]?.name).toBe("hero");
    expect(map.tilesets[0]?.atlas).toBe("hero.atlas.json");
    expect(map.tilesets[0]?.firstId).toBe(1);
    expect(map.tilesets[0]?.tiles).toHaveLength(4);
    expect(tileFrameName(map, 1)).toBe("hero_0");
    expect(tileFrameName(map, 4)).toBe("hero_3");
  });

  it("converts the spawn object into world metres with a bottom-left anchor", () => {
    const spawn = map.objects[0];
    expect(spawn?.name).toBe("player-start");
    expect(spawn?.type).toBe("spawn");
    // Tiled: x 96, y 32 (top edge), 32x32, on a 128-px-tall map at 100 px per unit.
    expect(spawn?.x).toBeCloseTo(0.96, 10);
    expect(spawn?.y).toBeCloseTo(0.64, 10);
    expect(spawn?.width).toBeCloseTo(0.32, 10);
    expect(spawn?.height).toBeCloseTo(0.32, 10);
    expect(spawn?.properties["facing"]).toBe("left");
  });

  it("carries the map's own properties through", () => {
    expect(map.properties["biome"]).toBe("cave");
  });
});

describe("importTiledMap options", () => {
  it("honours pixelsPerUnit", () => {
    const map = importTiledMap(SAMPLE, { pixelsPerUnit: 32 });
    expect(map.cellSize).toBe(1);
    expect(map.objects[0]?.x).toBe(3);
    expect(map.objects[0]?.y).toBe(2);
  });

  it("honours a custom atlasFor", () => {
    const map = importTiledMap(SAMPLE, { atlasFor: (image) => `atlases/${image}.atlas.json` });
    expect(map.tilesets[0]?.atlas).toBe("atlases/hero.png.atlas.json");
  });

  it("uses the default sorting layer only when the layer names none", () => {
    const withoutProperty = withOverride({
      layers: [
        { id: 1, type: "tilelayer", name: "Ground", width: 4, height: 4, data: Array.from({ length: 16 }, () => 0) },
      ],
    });
    expect(importTiledMap(withoutProperty, { sortingLayer: "Background" }).layers[0]?.sortingLayer).toBe("Background");
    // The fixture's Ground layer declares `sortingLayer = Default`, which wins over the option.
    expect(importTiledMap(SAMPLE, { sortingLayer: "Background" }).layers[0]?.sortingLayer).toBe("Default");
  });

  it("lets layer properties override the draw order and the collision flag", () => {
    const patched = withOverride({
      layers: [
        {
          id: 1,
          type: "tilelayer",
          name: "Ground",
          width: 4,
          height: 4,
          parallaxx: 0.5,
          parallaxy: 0.25,
          opacity: 0.75,
          properties: [
            { name: "orderInLayer", type: "int", value: 12 },
            { name: "collision", type: "bool", value: true },
          ],
          data: Array.from({ length: 16 }, () => 0),
        },
      ],
    });
    const layer = importTiledMap(patched).layers[0];
    expect(layer?.orderInLayer).toBe(12);
    expect(layer?.collision).toBe(true);
    expect(layer?.opacity).toBe(0.75);
    expect(layer?.parallax).toEqual({ x: 0.5, y: 0.25 });
  });

  it("appends `.atlas.json` to an image path that has no extension", () => {
    const patched = withOverride({
      tilesets: [{ firstgid: 1, name: "hero", image: "atlas/hero", tilecount: 1 }],
    });
    expect(importTiledMap(patched).tilesets[0]?.atlas).toBe("atlas/hero.atlas.json");
  });
});

describe("importTiledMap tile colliders", () => {
  it("reads a per-tile polygon object as a polygon collider", () => {
    const patched = withOverride({
      tilesets: [
        {
          firstgid: 1,
          name: "hero",
          image: "hero.png",
          tilecount: 1,
          tiles: [
            {
              id: 0,
              objectgroup: {
                objects: [
                  {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                    polygon: [
                      { x: 0, y: 32 },
                      { x: 32, y: 32 },
                      { x: 32, y: 0 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const collider = importTiledMap(patched).tilesets[0]?.tiles[0]?.collider;
    expect(collider).toEqual({
      kind: "polygon",
      points: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ],
    });
  });

  it("gives a one-way tile with no drawn shape the whole cell", () => {
    const patched = withOverride({
      tilesets: [
        {
          firstgid: 1,
          name: "hero",
          image: "hero.png",
          tilecount: 1,
          tiles: [{ id: 0, properties: [{ name: "oneWay", type: "bool", value: true }] }],
        },
      ],
    });
    expect(importTiledMap(patched).tilesets[0]?.tiles[0]?.collider).toEqual({
      kind: "box",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      oneWay: true,
    });
  });

  it("ignores a degenerate shape and a polygon with fewer than three points", () => {
    const patched = withOverride({
      tilesets: [
        {
          firstgid: 1,
          name: "hero",
          image: "hero.png",
          tilecount: 1,
          tiles: [
            {
              id: 0,
              objectgroup: {
                objects: [
                  {
                    x: 0,
                    y: 0,
                    polygon: [
                      { x: 0, y: 0 },
                      { x: 32, y: 0 },
                    ],
                  },
                  { x: 0, y: 0, width: 0, height: 0 },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(importTiledMap(patched).tilesets[0]?.tiles[0]?.collider).toBeUndefined();
  });
});

describe("importTiledMap flip flags and stray layers", () => {
  it("masks the three flip bits out of a global tile id", () => {
    const patched = withOverride({
      width: 2,
      height: 1,
      layers: [
        {
          id: 1,
          type: "tilelayer",
          name: "Ground",
          width: 2,
          height: 1,
          // 0x80000001 is gid 1 flipped horizontally; 0xE0000002 is gid 2 flipped every way.
          data: [0x80000001, 0xe0000002],
        },
      ],
    });
    expect(importTiledMap(patched).layers[0]?.tiles).toEqual([1, 2]);
  });

  it("skips image layers and group layers rather than refusing the map", () => {
    const patched = withOverride({
      layers: [
        { id: 1, type: "imagelayer", name: "Backdrop", image: "sky.png" },
        { id: 2, type: "group", name: "Folder", layers: [] },
        "not an object",
      ],
    });
    const map = importTiledMap(patched);
    expect(map.layers).toEqual([]);
    expect(map.objects).toEqual([]);
  });

  it("reads Tiled 1.9's `class` field when an object has no `type`", () => {
    const patched = withOverride({
      layers: [
        {
          id: 2,
          type: "objectgroup",
          name: "Objects",
          objects: [{ id: 1, name: "door", class: "portal", x: 0, y: 128, width: 32, height: 32 }, 7],
        },
      ],
    });
    const map = importTiledMap(patched);
    expect(map.objects).toHaveLength(1);
    expect(map.objects[0]?.type).toBe("portal");
  });
});

describe("importTiledMap rejections", () => {
  it("rejects a non-orthogonal map", () => {
    expectCode(() => importTiledMap(withOverride({ orientation: "isometric" })), "IGX-1109");
  });

  it("rejects an infinite map", () => {
    expectCode(() => importTiledMap(withOverride({ infinite: true })), "IGX-1109");
  });

  it("rejects compressed (string) layer data", () => {
    const patched = withOverride({
      layers: [{ id: 1, type: "tilelayer", name: "Ground", width: 4, height: 4, encoding: "base64", data: "H4sIAAAA" }],
    });
    expectCode(() => importTiledMap(patched), "IGX-1109");
  });

  it("rejects a tile layer with no data array", () => {
    const patched = withOverride({
      layers: [{ id: 1, type: "tilelayer", name: "Ground", width: 4, height: 4 }],
    });
    expectCode(() => importTiledMap(patched), "IGX-1109");
  });

  it("rejects an external .tsx tileset reference", () => {
    expectCode(() => importTiledMap(withOverride({ tilesets: [{ firstgid: 1, source: "hero.tsx" }] })), "IGX-1109");
  });

  it("rejects a document that is not an object", () => {
    expectCode(() => importTiledMap("not a map"), "IGX-1109");
  });
});

describe("tiledPropertiesToRecord", () => {
  it("flattens name/value pairs", () => {
    expect(tiledPropertiesToRecord([{ name: "biome", type: "string", value: "cave" }])).toEqual({ biome: "cave" });
  });

  it("drops entries that are not a named scalar", () => {
    expect(
      tiledPropertiesToRecord([
        { name: "ok", value: 3 },
        { name: "", value: 1 },
        { name: "nested", value: { a: 1 } },
        { value: "unnamed" },
        "junk",
      ]),
    ).toEqual({ ok: 3 });
  });

  it("returns an empty record for anything that is not an array", () => {
    expect(tiledPropertiesToRecord(undefined)).toEqual({});
    expect(tiledPropertiesToRecord({ biome: "cave" })).toEqual({});
  });
});
