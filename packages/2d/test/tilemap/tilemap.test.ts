import { Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { importTiledMap } from "../../src/tilemap/importers/tiled.js";
import { Tilemap } from "../../src/tilemap/tilemap.js";
import { createTwoDApp, readFixtureJson } from "../support/app.js";
import type { TilemapAsset } from "../../src/tilemap/tilemap-asset.js";
import type { TileChange } from "../../src/tilemap/tilemap.js";
import type { TwoDAppHarness } from "../support/app.js";

/**
 * The `Tilemap` component (`docs/architecture/11-2d-toolkit.md` §2.5): the grid, its cell
 * arithmetic, and the merged collision surface `@ignifx/physics-2d` consumes.
 *
 * The document under test is the Tiled fixture run through the importer and back out as JSON,
 * which proves the importer's output is loadable as well as exercising the component.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The Tiled fixture, imported and re-serialised as an `ignifx.tilemap` document. */
function fixtureDocument(): string {
  return JSON.stringify(importTiledMap(readFixtureJson("sample.tmj")));
}

/** A headless app carrying one loaded tilemap on an entity at the origin. */
async function createMap(offset?: Vec2): Promise<Tilemap> {
  const created = await createTwoDApp({ files: { "2d/level.tilemap.json": fixtureDocument() } });
  harness = created;
  const handle = await created.load<TilemapAsset>("2d/level.tilemap.json");
  const entity = created.app.world.createEntity("level");
  if (offset !== undefined) {
    entity.transform.position2D = offset;
  }
  const tilemap = entity.addComponent(Tilemap);
  tilemap.map = handle.retain();
  return tilemap;
}

describe("the loaded document", () => {
  it("carries the fixture's shape", async () => {
    const tilemap = await createMap();
    const definition = tilemap.definition;
    expect(definition?.width).toBe(4);
    expect(definition?.height).toBe(4);
    expect(tilemap.layerCount).toBeGreaterThan(0);
    expect(tilemap.layerSize(0)).toEqual({ x: 4, y: 4 });
    expect(tilemap.cellSize).toBeCloseTo(0.32, 10);
    expect(definition?.properties["biome"]).toBe("cave");
  });

  it("lets a component override the cell size", async () => {
    const tilemap = await createMap();
    tilemap.cellSizeOverride = 1;
    expect(tilemap.cellSize).toBe(1);
    tilemap.cellSizeOverride = 0;
    expect(tilemap.cellSize).toBeCloseTo(0.32, 10);
  });
});

describe("the bottom-left origin", () => {
  it("flips the document's top-row-first storage", async () => {
    const tilemap = await createMap();
    // The fixture's tile layer, top row first, is
    //   row 0: 0 0 0 0
    //   row 1: 0 0 0 3
    //   row 2: 1 1 1 0
    //   row 3: 1 1 1 2
    // Cell (0, 0) is the BOTTOM-left, which is document row 3.
    expect(tilemap.getTile(0, 0, 0)).toBe(1);
    expect(tilemap.getTile(0, 3, 0)).toBe(2);
    expect(tilemap.getTile(0, 0, 1)).toBe(1);
    expect(tilemap.getTile(0, 3, 1)).toBe(0);
    expect(tilemap.getTile(0, 3, 2)).toBe(3);
    expect(tilemap.getTile(0, 0, 3)).toBe(0);
  });

  it("answers 0 outside the layer rather than throwing", async () => {
    const tilemap = await createMap();
    expect(tilemap.getTile(0, -1, 0)).toBe(0);
    expect(tilemap.getTile(0, 99, 0)).toBe(0);
    expect(tilemap.getTile(99, 0, 0)).toBe(0);
  });
});

describe("setTile", () => {
  it("reports the change and is idempotent", async () => {
    const tilemap = await createMap();
    const seen: TileChange[] = [];
    tilemap.onTileChanged.connect((change) => seen.push(change));
    tilemap.setTile(0, 0, 0, 0);
    expect(seen).toEqual([{ layer: 0, x: 0, y: 0, previous: 1, current: 0 }]);
    tilemap.setTile(0, 0, 0, 0);
    expect(seen).toHaveLength(1);
    expect(tilemap.getTile(0, 0, 0)).toBe(0);
  });

  it("refuses a cell outside the layer", async () => {
    const tilemap = await createMap();
    let captured: unknown = null;
    try {
      tilemap.setTile(0, 99, 0, 1);
    } catch (error) {
      captured = error;
    }
    expect((captured as { readonly code?: string }).code).toBe("IGX-1111");
  });
});

describe("setCells", () => {
  it("writes a batch, reports each changed cell after the writes, and counts the changes", async () => {
    const tilemap = await createMap();
    const seen: { readonly change: TileChange; readonly after: number }[] = [];
    tilemap.onTileChanged.connect((change) => {
      // Every write has landed by the time the first change is reported.
      seen.push({ change, after: tilemap.getTile(0, 1, 0) });
    });
    const changed = tilemap.setCells([
      { layer: 0, x: 0, y: 0, tileId: 0 },
      { layer: 0, x: 1, y: 0, tileId: 0 },
      { layer: 0, x: 3, y: 1, tileId: 0 }, // already empty, so not a change
    ]);
    expect(changed).toBe(2);
    expect(seen.map((entry) => entry.change)).toEqual([
      { layer: 0, x: 0, y: 0, previous: 1, current: 0 },
      { layer: 0, x: 1, y: 0, previous: 1, current: 0 },
    ]);
    expect(seen.every((entry) => entry.after === 0)).toBe(true);
    expect(tilemap.getTile(0, 0, 0)).toBe(0);
    expect(tilemap.getTile(0, 1, 0)).toBe(0);
  });

  it("applies writes in order, so a repeated cell ends with the later id", async () => {
    const tilemap = await createMap();
    const seen: TileChange[] = [];
    tilemap.onTileChanged.connect((change) => seen.push(change));
    tilemap.setCells([
      { layer: 0, x: 3, y: 3, tileId: 2 },
      { layer: 0, x: 3, y: 3, tileId: 3 },
    ]);
    expect(tilemap.getTile(0, 3, 3)).toBe(3);
    expect(seen.map((change) => [change.previous, change.current])).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });

  it("is a no-op for an empty or unchanged batch", async () => {
    const tilemap = await createMap();
    const first = tilemap.collisionData.version;
    expect(tilemap.setCells([])).toBe(0);
    expect(tilemap.setCells([{ layer: 0, x: 0, y: 0, tileId: 1 }])).toBe(0);
    expect(tilemap.collisionData.version).toBe(first);
  });

  it("checks the whole batch before writing any of it", async () => {
    const tilemap = await createMap();
    let captured: unknown = null;
    try {
      tilemap.setCells([
        { layer: 0, x: 0, y: 0, tileId: 0 },
        { layer: 0, x: 99, y: 0, tileId: 1 },
      ]);
    } catch (error) {
      captured = error;
    }
    expect((captured as { readonly code?: string }).code).toBe("IGX-1111");
    expect(tilemap.getTile(0, 0, 0)).toBe(1);
  });

  it("merges collision once for the whole batch", async () => {
    const tilemap = await createMap();
    let fired = 0;
    tilemap.onCollisionChanged.connect(() => {
      fired += 1;
    });
    const first = tilemap.collisionData.version;
    tilemap.setCells([
      { layer: 0, x: 0, y: 0, tileId: 0 },
      { layer: 0, x: 1, y: 0, tileId: 0 },
      { layer: 0, x: 2, y: 0, tileId: 0 },
    ]);
    const second = tilemap.collisionData.version;
    expect(second).toBe(first + 1);
    expect(fired).toBe(2);
    expect(tilemap.collisionAt(1, 0).shape.kind).toBe("none");
  });
});

describe("cell arithmetic", () => {
  it("round trips a cell centre through world space", async () => {
    const tilemap = await createMap();
    const world = tilemap.cellToWorld(2, 1, new Vec2());
    const cell = tilemap.worldToCell(world, new Vec2());
    expect(cell.x).toBe(2);
    expect(cell.y).toBe(1);
  });

  it("returns the cell CENTRE, not its corner", async () => {
    const tilemap = await createMap();
    const size = tilemap.cellSize;
    const world = tilemap.cellToWorld(0, 0, new Vec2());
    expect(world.x).toBeCloseTo(size / 2, 10);
    expect(world.y).toBeCloseTo(size / 2, 10);
  });

  it("follows the tilemap entity's own transform", async () => {
    const tilemap = await createMap(new Vec2(10, -5));
    const world = tilemap.cellToWorld(0, 0, new Vec2());
    expect(world.x).toBeCloseTo(10 + tilemap.cellSize / 2, 10);
    expect(world.y).toBeCloseTo(-5 + tilemap.cellSize / 2, 10);
    const cell = tilemap.worldToCell(world, new Vec2());
    expect(cell.x).toBe(0);
    expect(cell.y).toBe(0);
  });
});

describe("collision", () => {
  it("merges the fixture's solid block into one polygon per chunk", async () => {
    const tilemap = await createMap();
    const data = tilemap.collisionData;
    expect(data.cellSize).toBeCloseTo(0.32, 10);
    expect(data.chunks).toHaveLength(1);
    const chunk = data.chunks[0];
    expect(chunk).toBeDefined();
    // The 3x2 solid block is one rectangle; the one-way tile contributes an edge, not a polygon.
    expect(chunk?.polygons).toHaveLength(1);
    expect(chunk?.polygons[0]).toHaveLength(4);
    expect(chunk?.oneWayEdges.length).toBeGreaterThan(0);
  });

  it("bumps the version and fires only for a collision layer", async () => {
    const tilemap = await createMap();
    let fired = 0;
    tilemap.onCollisionChanged.connect(() => {
      fired += 1;
    });
    const first = tilemap.collisionData.version;
    expect(fired).toBe(1);
    tilemap.setTile(0, 0, 0, 0);
    const second = tilemap.collisionData.version;
    expect(second).toBeGreaterThan(first);
    expect(fired).toBe(2);
    // A second read with nothing changed must not merge again.
    expect(tilemap.collisionData.version).toBe(second);
    expect(fired).toBe(2);
  });

  it("reports the topmost collider at a cell", async () => {
    const tilemap = await createMap();
    expect(tilemap.collisionAt(0, 0).shape.kind).toBe("box");
    expect(tilemap.collisionAt(3, 2).shape.kind).toBe("none");
    expect(tilemap.collisionAt(3, 0).oneWay).toBe(true);
  });
});

describe("before anything has loaded", () => {
  it("reports empty everything rather than throwing", async () => {
    harness = await createTwoDApp();
    const tilemap = harness.app.world.createEntity("empty").addComponent(Tilemap);
    expect(tilemap.definition).toBeNull();
    expect(tilemap.cellSize).toBe(0);
    expect(tilemap.layerCount).toBe(0);
    expect(tilemap.layerSize(0)).toEqual({ x: 0, y: 0 });
    expect(tilemap.getTile(0, 0, 0)).toBe(0);
    expect(tilemap.collisionData.chunks).toEqual([]);
    expect(tilemap.collisionAt(0, 0).shape.kind).toBe("none");
    expect(tilemap.worldToCell({ x: 1, y: 1 }, new Vec2())).toEqual({ x: 0, y: 0 });
  });

  it("builds the collision surface once a map read too early has loaded", async () => {
    const created = await createTwoDApp({ files: { "2d/level.tilemap.json": fixtureDocument() } });
    harness = created;
    const tilemap = created.app.world.createEntity("late").addComponent(Tilemap);
    expect(tilemap.collisionData.chunks).toEqual([]);
    tilemap.map = (await created.load<TilemapAsset>("2d/level.tilemap.json")).retain();
    expect(tilemap.collisionData.chunks).toHaveLength(1);
    expect(tilemap.collisionData.version).toBeGreaterThan(0);
  });
});

describe("tile objects", () => {
  it("are data: loading a scene with the map spawns nothing from them (ADR-0030)", async () => {
    const scene = JSON.stringify({
      format: "ignifx.scene",
      formatVersion: 1,
      name: "level",
      settings: {},
      entities: [
        {
          uid: "01M5019D56QN4RE9MGE5CG2Y05",
          name: "Level",
          parent: null,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          components: [
            {
              uid: "01M5019D57GNWGM08AR6VY0BYX",
              type: "ignifx/Tilemap",
              props: { map: { $asset: "2d/level.tilemap.json", type: "tilemap" } },
            },
          ],
        },
      ],
    });
    const created = await createTwoDApp({
      files: { "2d/level.tilemap.json": fixtureDocument(), "levels/one.scene.json": scene },
    });
    harness = created;
    const instance = await created.app.world.loadScene("levels/one.scene.json");
    created.step();

    expect(instance.roots.map((entity) => entity.name)).toEqual(["Level"]);
    expect(created.app.world.findByName("player-start")).toBeNull();
    const tilemap = instance.roots[0]?.requireComponent(Tilemap);
    // The importer put the object at (0.96, 0.64) in map metres; code can still read it.
    expect(tilemap?.definition?.objects.map((object) => [object.type, object.name])).toEqual([
      ["spawn", "player-start"],
    ]);
    expect(tilemap?.definition?.objects[0]?.x).toBeCloseTo(0.96, 6);
  });
});
