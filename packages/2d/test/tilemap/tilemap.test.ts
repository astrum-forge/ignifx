import { Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { importTiledMap } from "../../src/tilemap/importers/tiled.js";
import { spawnTilemapObjects } from "../../src/tilemap/spawn-objects.js";
import { Tilemap } from "../../src/tilemap/tilemap.js";
import { createTwoDApp, readFixtureJson } from "../support/app.js";
import type { TilemapAsset } from "../../src/tilemap/tilemap-asset.js";
import type { TileChange } from "../../src/tilemap/tilemap.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { Entity } from "@ignifx/core";

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
});

describe("tile objects", () => {
  it("hands a registered factory the object's world placement and properties", async () => {
    const tilemap = await createMap(new Vec2(1, 2));
    const created = harness;
    expect(created).not.toBeNull();
    if (created === null) {
      return;
    }
    const seen: { readonly name: string; readonly type: string; readonly x: number; readonly y: number }[] = [];
    created.app.twoD.registerTileObjectFactory("spawn", (context): Entity | null => {
      seen.push({ name: context.name, type: context.type, x: context.position.x, y: context.position.y });
      return created.app.world.createEntity(context.name);
    });
    const spawned = spawnTilemapObjects(created.app, created.app.twoD, tilemap);
    expect(spawned).toHaveLength(1);
    expect(seen[0]?.name).toBe("player-start");
    expect(seen[0]?.type).toBe("spawn");
    // The importer put the object at (0.96, 0.64) in map metres; the entity adds (1, 2).
    expect(seen[0]?.x).toBeCloseTo(1.96, 6);
    expect(seen[0]?.y).toBeCloseTo(2.64, 6);
  });

  it("skips an object type nothing registered", async () => {
    const tilemap = await createMap();
    const created = harness;
    if (created === null) {
      return;
    }
    expect(spawnTilemapObjects(created.app, created.app.twoD, tilemap)).toEqual([]);
  });

  it("contains a throwing factory and keeps going", async () => {
    const tilemap = await createMap();
    const created = harness;
    if (created === null) {
      return;
    }
    const reported: unknown[] = [];
    created.app.onError.connect((report) => reported.push(report.error));
    created.app.twoD.registerTileObjectFactory("spawn", (): Entity | null => {
      throw new Error("factory blew up");
    });
    expect(spawnTilemapObjects(created.app, created.app.twoD, tilemap)).toEqual([]);
    expect(reported).toHaveLength(1);
  });

  it("refuses a second factory for one type and forgets it on request", async () => {
    harness = await createTwoDApp();
    const service = harness.app.twoD;
    service.registerTileObjectFactory("spawn", (): Entity | null => null);
    let captured: unknown = null;
    try {
      service.registerTileObjectFactory("spawn", (): Entity | null => null);
    } catch (error) {
      captured = error;
    }
    expect((captured as { readonly code?: string }).code).toBe("IGX-1110");
    expect(service.unregisterTileObjectFactory("spawn")).toBe(true);
    expect(service.unregisterTileObjectFactory("spawn")).toBe(false);
  });
});
