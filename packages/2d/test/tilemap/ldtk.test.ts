import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tileCollisionInfo, tileFrameName } from "../../src/tilemap/definition.js";
import {
  fieldInstancesToRecord,
  importLdtkLevel,
  LDTK_DEFAULT_INTGRID_COLLIDERS,
  LDTK_INTGRID_TILESET_NAME,
} from "../../src/tilemap/importers/ldtk.js";

/** The committed LDtk fixture: one 4x4 level with a Tiles, an IntGrid and an Entities layer. */
const SAMPLE: unknown = JSON.parse(
  readFileSync(new URL("../../../../tests/fixtures/assets/2d/sample.ldtk", import.meta.url), "utf8"),
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

/** A deep copy of the fixture, so a test can break one field without touching the others. */
function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(SAMPLE)) as Record<string, unknown>;
}

/** A deep copy of the fixture with `patch` applied to its first level. */
function withLevelPatch(patch: (level: Record<string, unknown>) => void): unknown {
  const project = clone();
  const levels = project["levels"] as Record<string, unknown>[];
  patch(levels[0]!);
  return project;
}

/** The layer instances of the fixture's first level, by `__identifier`. */
function layerInstance(project: Record<string, unknown>, identifier: string): Record<string, unknown> {
  const levels = project["levels"] as Record<string, unknown>[];
  const instances = levels[0]!["layerInstances"] as Record<string, unknown>[];
  return instances.find((instance) => instance["__identifier"] === identifier)!;
}

describe("importLdtkLevel on the sample fixture", () => {
  const map = importLdtkLevel(SAMPLE);

  it("reads the level's size from its pixel extent and grid size", () => {
    expect(map.width).toBe(4);
    expect(map.height).toBe(4);
    expect(map.tileWidth).toBe(32);
    expect(map.tileHeight).toBe(32);
    expect(map.cellSize).toBeCloseTo(0.32, 10);
  });

  it("reverses LDtk's front-to-back layer order into ignifx's back-to-front order", () => {
    // LDtk stores Entities, Collision, Ground (index 0 draws on top); the Entities layer becomes
    // objects, so what is left is Ground behind Collision.
    expect(map.layers.map((layer) => layer.name)).toEqual(["Ground", "Collision"]);
    expect(map.layers[0]?.orderInLayer).toBe(0);
    expect(map.layers[1]?.orderInLayer).toBe(1);
  });

  it("expands the sparse gridTiles into the dense tile array", () => {
    expect(map.layers[0]?.tiles).toEqual([0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 0, 1, 1, 1, 2]);
    expect(map.layers[0]?.collision).toBe(false);
    expect(map.layers[0]?.parallax).toEqual({ x: 1, y: 1 });
  });

  it("turns the IntGrid layer into a collision layer over the synthetic tileset", () => {
    const intGrid = map.tilesets.find((tileset) => tileset.name === LDTK_INTGRID_TILESET_NAME);
    expect(intGrid?.firstId).toBe(5);
    expect(intGrid?.atlas).toBe("");
    expect(map.layers[1]?.collision).toBe(true);
    // The same 3x2 block as the Tiled fixture, plus a one-way tile in the bottom-right corner.
    expect(map.layers[1]?.tiles).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 0, 5, 5, 5, 6]);
  });

  it("maps IntGrid value 1 to a full cell and value 2 to a one-way top quarter", () => {
    expect(tileCollisionInfo(map, 5).shape).toEqual({
      kind: "box",
      x: 0,
      y: 0,
      width: map.cellSize,
      height: map.cellSize,
    });
    expect(tileCollisionInfo(map, 5).oneWay).toBe(false);
    const oneWay = tileCollisionInfo(map, 6);
    expect(oneWay.oneWay).toBe(true);
    expect(oneWay.shape.kind).toBe("box");
    if (oneWay.shape.kind === "box") {
      expect(oneWay.shape.y).toBeCloseTo(0.24, 10);
      expect(oneWay.shape.height).toBeCloseTo(0.08, 10);
    }
  });

  it("gives the tileset an atlas address and `<tileset>_<index>` frame names", () => {
    expect(map.tilesets[0]?.name).toBe("Hero");
    expect(map.tilesets[0]?.atlas).toBe("hero.atlas.json");
    expect(map.tilesets[0]?.firstId).toBe(1);
    expect(map.tilesets[0]?.tiles).toHaveLength(4);
    expect(tileFrameName(map, 1)).toBe("Hero_0");
    expect(tileFrameName(map, 5)).toBe("intgrid_1");
  });

  it('reads a `{"solid":true}` customData entry as a full-cell collider', () => {
    expect(tileCollisionInfo(map, 1).shape.kind).toBe("box");
    expect(tileCollisionInfo(map, 2).shape.kind).toBe("none");
  });

  it("converts the PlayerStart entity into world metres with a bottom-left anchor", () => {
    expect(map.objects).toHaveLength(1);
    const spawn = map.objects[0];
    expect(spawn?.type).toBe("PlayerStart");
    expect(spawn?.name).toBe("PlayerStart");
    // LDtk: px [96, 32] with pivot [0, 0], 32x32, on a 128-px-tall level at 100 px per unit.
    expect(spawn?.x).toBeCloseTo(0.96, 10);
    expect(spawn?.y).toBeCloseTo(0.64, 10);
    expect(spawn?.width).toBeCloseTo(0.32, 10);
    expect(spawn?.height).toBeCloseTo(0.32, 10);
    expect(spawn?.properties["facing"]).toBe("left");
  });

  it("carries the level's field instances through as map properties", () => {
    expect(map.properties["biome"]).toBe("cave");
  });
});

describe("importLdtkLevel options", () => {
  it("selects a level by identifier", () => {
    expect(importLdtkLevel(SAMPLE, { level: "Level_0" }).width).toBe(4);
  });

  it("honours pixelsPerUnit and the sorting layer", () => {
    const map = importLdtkLevel(SAMPLE, { pixelsPerUnit: 32, sortingLayer: "Background" });
    expect(map.cellSize).toBe(1);
    expect(map.objects[0]?.x).toBe(3);
    expect(map.objects[0]?.y).toBe(2);
    expect(map.layers[0]?.sortingLayer).toBe("Background");
  });

  it("honours a custom atlasFor", () => {
    const map = importLdtkLevel(SAMPLE, { atlasFor: (relPath) => `atlases/${relPath}` });
    expect(map.tilesets[0]?.atlas).toBe("atlases/hero.png");
  });

  it("replaces the IntGrid collider table", () => {
    const map = importLdtkLevel(SAMPLE, {
      intGridColliders: { 1: { kind: "box", x: 0, y: 0.5, width: 1, height: 0.5 } },
    });
    expect(tileCollisionInfo(map, 5).shape).toEqual({
      kind: "box",
      x: 0,
      y: 0,
      width: map.cellSize,
      height: map.cellSize / 2,
    });
    // Value 2 is not in the replacement table, so it gets a tile id but no collider.
    expect(tileCollisionInfo(map, 6).shape.kind).toBe("none");
  });

  it("exposes the default IntGrid table it uses", () => {
    expect(LDTK_DEFAULT_INTGRID_COLLIDERS[1]).toEqual({ kind: "box", x: 0, y: 0, width: 1, height: 1 });
    expect(LDTK_DEFAULT_INTGRID_COLLIDERS[2]).toEqual({
      kind: "box",
      x: 0,
      y: 0,
      width: 1,
      height: 0.25,
      oneWay: true,
    });
  });
});

describe("importLdtkLevel edge cases", () => {
  it("prefers an entity's `name` field over its identifier", () => {
    const project = withLevelPatch((level) => {
      const instances = level["layerInstances"] as Record<string, unknown>[];
      const entities = instances[0]!["entityInstances"] as Record<string, unknown>[];
      entities[0]!["fieldInstances"] = [{ __identifier: "name", __type: "String", __value: "hero" }];
    });
    expect(importLdtkLevel(project).objects[0]?.name).toBe("hero");
    expect(importLdtkLevel(project).objects[0]?.type).toBe("PlayerStart");
  });

  it("shifts an entity by its pivot and the layer's pixel offset", () => {
    const project = withLevelPatch((level) => {
      const instances = level["layerInstances"] as Record<string, unknown>[];
      instances[0]!["pxOffsetX"] = 16;
      const entities = instances[0]!["entityInstances"] as Record<string, unknown>[];
      entities[0]!["__pivot"] = [0.5, 1];
    });
    const spawn = importLdtkLevel(project).objects[0];
    // left = 96 + 16 - 0.5 * 32 = 96; top = 32 - 1 * 32 = 0.
    expect(spawn?.x).toBeCloseTo(0.96, 10);
    expect(spawn?.y).toBeCloseTo(0.96, 10);
  });

  it("rounds a tile layer's pixel offset to whole cells", () => {
    const project = clone();
    const ground = layerInstance(project, "Ground");
    ground["pxOffsetX"] = 32;
    const tiles = importLdtkLevel(project).layers[0]?.tiles;
    // Every tile moves one column right; the rightmost column falls off the grid.
    expect(tiles).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1]);
  });

  it("ignores customData that is not JSON, and JSON that does not say solid", () => {
    const project = clone();
    const defs = project["defs"] as Record<string, unknown>;
    const tilesets = defs["tilesets"] as Record<string, unknown>[];
    tilesets[0]!["customData"] = [
      { tileId: 0, data: "not json at all" },
      { tileId: 1, data: '{"solid":false}' },
      { tileId: 2, data: "" },
    ];
    const map = importLdtkLevel(project);
    expect(tileCollisionInfo(map, 1).shape.kind).toBe("none");
    expect(tileCollisionInfo(map, 2).shape.kind).toBe("none");
  });

  it("emits no synthetic tileset when the IntGrid layer is empty", () => {
    const project = clone();
    const collision = layerInstance(project, "Collision");
    collision["intGridCsv"] = [];
    const map = importLdtkLevel(project);
    expect(map.tilesets.map((tileset) => tileset.name)).toEqual(["Hero"]);
    expect(map.layers.map((layer) => layer.name)).toEqual(["Ground"]);
  });

  it("falls back to the project's defaultGridSize when no layer declares one", () => {
    const project = clone();
    const levels = project["levels"] as Record<string, unknown>[];
    const instances = levels[0]!["layerInstances"] as Record<string, unknown>[];
    for (const instance of instances) {
      instance["__gridSize"] = 0;
    }
    expect(importLdtkLevel(project).tileWidth).toBe(32);
  });
});

describe("importLdtkLevel rejections", () => {
  it("rejects a project with no levels", () => {
    const project = clone();
    project["levels"] = [];
    expectCode(() => importLdtkLevel(project), "IGX-1109");
  });

  it("rejects a level name the project does not declare", () => {
    expectCode(() => importLdtkLevel(SAMPLE, { level: "Nope" }), "IGX-1109");
  });

  it("rejects a layer type it does not model", () => {
    const project = withLevelPatch((level) => {
      const instances = level["layerInstances"] as Record<string, unknown>[];
      instances[0]!["__type"] = "AutoLayer";
    });
    expectCode(() => importLdtkLevel(project), "IGX-1109");
  });

  it("rejects a document that is not an object", () => {
    expectCode(() => importLdtkLevel(42), "IGX-1109");
  });

  it("rejects a levels array whose entries are not objects", () => {
    const project = clone();
    project["levels"] = ["Level_0"];
    expectCode(() => importLdtkLevel(project), "IGX-1109");
  });
});

describe("fieldInstancesToRecord", () => {
  it("flattens identifier/value pairs", () => {
    expect(fieldInstancesToRecord([{ __identifier: "facing", __type: "String", __value: "left" }])).toEqual({
      facing: "left",
    });
  });

  it("drops entries that are not a named scalar", () => {
    expect(
      fieldInstancesToRecord([
        { __identifier: "ok", __value: 2 },
        { __identifier: "", __value: 1 },
        { __identifier: "point", __value: { cx: 1, cy: 2 } },
        { __value: "unnamed" },
        null,
      ]),
    ).toEqual({ ok: 2 });
  });

  it("returns an empty record for anything that is not an array", () => {
    expect(fieldInstancesToRecord(undefined)).toEqual({});
  });
});
