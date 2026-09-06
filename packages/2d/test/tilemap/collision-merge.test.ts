import { describe, expect, it } from "vitest";
import { isFullCellSolid, mergeTileCollisions } from "../../src/tilemap/collision-merge.js";
import type { TileCollisionInfo } from "../../src/tilemap/collision-data.js";

/** Every fixture in this file uses a one-metre cell, so cell coordinates read as world metres. */
const CELL = 1;

/** A tile that fills its whole cell. */
const SOLID: TileCollisionInfo = {
  shape: { kind: "box", x: 0, y: 0, width: CELL, height: CELL },
  oneWay: false,
  properties: {},
};

/** A tile that does not collide. */
const EMPTY: TileCollisionInfo = { shape: { kind: "none" }, oneWay: false, properties: {} };

/** A one-way platform occupying the top quarter of its cell. */
const ONE_WAY: TileCollisionInfo = {
  shape: { kind: "box", x: 0, y: 0.75, width: CELL, height: 0.25 },
  oneWay: true,
  properties: {},
};

/** A half-height box, which the rectangle merge cannot absorb. */
const PARTIAL: TileCollisionInfo = {
  shape: { kind: "box", x: 0, y: 0, width: CELL, height: 0.5 },
  oneWay: false,
  properties: {},
};

/** A triangular slope, wound counter-clockwise in cell-local metres. */
const SLOPE: TileCollisionInfo = {
  shape: {
    kind: "polygon",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  oneWay: false,
  properties: {},
};

/** A one-way tile whose collider is a polygon rather than a box. */
const ONE_WAY_POLYGON: TileCollisionInfo = {
  shape: {
    kind: "polygon",
    points: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 1, y: 0.75 },
      { x: 0, y: 0.75 },
    ],
  },
  oneWay: true,
  properties: {},
};

/** The characters a grid row may use. */
const LEGEND: Readonly<Record<string, TileCollisionInfo>> = {
  ".": EMPTY,
  "#": SOLID,
  "^": ONE_WAY,
  "-": PARTIAL,
  "/": SLOPE,
  "~": ONE_WAY_POLYGON,
};

/**
 * Builds an `infoAt` callback from rows written **top row first**, which is how a grid reads on the
 * page — the callback flips back into the +Y-up cell coordinates the merger expects.
 */
function gridInfo(rows: readonly string[]): (x: number, y: number) => TileCollisionInfo {
  return (x, y) => {
    const row = rows[rows.length - 1 - y];
    const cell = row === undefined ? "." : (row[x] ?? ".");
    return LEGEND[cell] ?? EMPTY;
  };
}

describe("isFullCellSolid", () => {
  it("accepts a plain full-cell box", () => {
    expect(isFullCellSolid(SOLID, CELL)).toBe(true);
  });

  it("rejects a one-way tile, a partial box, a polygon and an empty cell", () => {
    expect(isFullCellSolid({ ...SOLID, oneWay: true }, CELL)).toBe(false);
    expect(isFullCellSolid(PARTIAL, CELL)).toBe(false);
    expect(isFullCellSolid(SLOPE, CELL)).toBe(false);
    expect(isFullCellSolid(EMPTY, CELL)).toBe(false);
  });

  it("rejects a full-cell box measured against a different cell size", () => {
    expect(isFullCellSolid(SOLID, 0.32)).toBe(false);
  });
});

describe("mergeTileCollisions", () => {
  it("merges a solid 3x2 block into one four-point rectangle", () => {
    const data = mergeTileCollisions(
      gridInfo(["....", "....", "###.", "###."]),
      { cellSize: CELL, chunkSize: 8, width: 4, height: 4 },
      1,
    );
    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0]?.chunkX).toBe(0);
    expect(data.chunks[0]?.chunkY).toBe(0);
    expect(data.chunks[0]?.polygons).toHaveLength(1);
    expect(data.chunks[0]?.polygons[0]).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(data.chunks[0]?.oneWayEdges).toEqual([]);
  });

  it("carries the version and the grid geometry through", () => {
    const data = mergeTileCollisions(gridInfo(["#"]), { cellSize: 0.32, chunkSize: 32, width: 1, height: 1 }, 7);
    expect(data.version).toBe(7);
    expect(data.cellSize).toBe(0.32);
    expect(data.chunkSize).toBe(32);
  });

  it("cuts an L-shape into two rectangles, because the merge is row-then-column greedy", () => {
    const data = mergeTileCollisions(
      gridInfo(["....", "....", "#...", "###."]),
      { cellSize: CELL, chunkSize: 8, width: 4, height: 4 },
      1,
    );
    expect(data.chunks[0]?.polygons).toHaveLength(2);
    // The bottom row's full run first, then the single cell above its left end.
    expect(data.chunks[0]?.polygons[0]).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(data.chunks[0]?.polygons[1]).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ]);
  });

  it("keeps two runs on the same row apart", () => {
    const data = mergeTileCollisions(gridInfo(["#.##"]), { cellSize: CELL, chunkSize: 8, width: 4, height: 1 }, 1);
    expect(data.chunks[0]?.polygons).toHaveLength(2);
  });

  it("emits one polygon per chunk for a block that spans a chunk boundary", () => {
    const data = mergeTileCollisions(gridInfo(["####"]), { cellSize: CELL, chunkSize: 2, width: 4, height: 1 }, 1);
    expect(data.chunks).toHaveLength(2);
    expect(data.chunks[0]?.chunkX).toBe(0);
    expect(data.chunks[0]?.polygons).toHaveLength(1);
    expect(data.chunks[0]?.polygons[0]?.[1]).toEqual({ x: 2, y: 0 });
    expect(data.chunks[1]?.chunkX).toBe(1);
    expect(data.chunks[1]?.polygons).toHaveLength(1);
    expect(data.chunks[1]?.polygons[0]?.[0]).toEqual({ x: 2, y: 0 });
  });

  it("omits chunks that carry no geometry", () => {
    const data = mergeTileCollisions(
      gridInfo(["....", "....", "..##", "..##"]),
      { cellSize: CELL, chunkSize: 2, width: 4, height: 4 },
      1,
    );
    // Four chunks exist; only the bottom-right one has anything in it.
    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0]).toMatchObject({ chunkX: 1, chunkY: 0 });
  });

  it("returns no chunks for an entirely empty grid", () => {
    const data = mergeTileCollisions(
      gridInfo(["....", "...."]),
      { cellSize: CELL, chunkSize: 2, width: 4, height: 2 },
      3,
    );
    expect(data.chunks).toEqual([]);
    expect(data.version).toBe(3);
  });

  it("returns no chunks for a degenerate grid", () => {
    for (const options of [
      { cellSize: 0, chunkSize: 2, width: 2, height: 2 },
      { cellSize: 1, chunkSize: 0, width: 2, height: 2 },
      { cellSize: 1, chunkSize: 2, width: 0, height: 2 },
      { cellSize: 1, chunkSize: 2, width: 2, height: 0 },
    ]) {
      expect(mergeTileCollisions(gridInfo(["##", "##"]), options, 1).chunks).toEqual([]);
    }
  });
});

describe("mergeTileCollisions one-way platforms", () => {
  it("emits a top edge per one-way tile and no polygon", () => {
    const data = mergeTileCollisions(gridInfo(["^^^"]), { cellSize: CELL, chunkSize: 8, width: 3, height: 1 }, 1);
    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0]?.polygons).toEqual([]);
    expect(data.chunks[0]?.oneWayEdges).toHaveLength(3);
  });

  it("winds each edge from its right end to its left end, so the solid side is on the left", () => {
    const data = mergeTileCollisions(gridInfo(["^"]), { cellSize: CELL, chunkSize: 8, width: 1, height: 1 }, 1);
    const edge = data.chunks[0]?.oneWayEdges[0];
    expect(edge).toEqual([
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    // The left of `from → to` is `(-dy, dx)`; with d = (-1, 0) that is (0, -1), pointing down into
    // the platform — which is exactly the half a one-way platform is solid from.
    const from = edge![0];
    const to = edge![1];
    const leftNormal = { x: -(to.y - from.y), y: to.x - from.x };
    expect(leftNormal.x).toBeCloseTo(0, 10);
    expect(leftNormal.y).toBe(-1);
  });

  it("uses a one-way polygon's bounding top edge", () => {
    const data = mergeTileCollisions(gridInfo(["~"]), { cellSize: CELL, chunkSize: 8, width: 1, height: 1 }, 1);
    expect(data.chunks[0]?.oneWayEdges[0]).toEqual([
      { x: 1, y: 0.75 },
      { x: 0, y: 0.75 },
    ]);
  });

  it("ignores a one-way tile whose collider has no width", () => {
    const zeroWidth: TileCollisionInfo = {
      shape: { kind: "box", x: 0, y: 0, width: 0, height: 1 },
      oneWay: true,
      properties: {},
    };
    const degeneratePolygon: TileCollisionInfo = {
      shape: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
      },
      oneWay: true,
      properties: {},
    };
    const data = mergeTileCollisions(
      (x) => (x === 0 ? zeroWidth : degeneratePolygon),
      { cellSize: CELL, chunkSize: 8, width: 2, height: 1 },
      1,
    );
    expect(data.chunks).toEqual([]);
  });
});

describe("mergeTileCollisions shapes the rectangle pass cannot absorb", () => {
  it("emits a partial box as its own world-space rectangle", () => {
    const data = mergeTileCollisions(gridInfo([".-"]), { cellSize: CELL, chunkSize: 8, width: 2, height: 1 }, 1);
    expect(data.chunks[0]?.polygons).toEqual([
      [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    ]);
  });

  it("translates a slope polygon into world metres without changing its winding", () => {
    const data = mergeTileCollisions(gridInfo(["/."]), { cellSize: CELL, chunkSize: 8, width: 2, height: 1 }, 1);
    expect(data.chunks[0]?.polygons).toEqual([
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    ]);
  });

  it("keeps partial shapes and merged solids in the same chunk", () => {
    const data = mergeTileCollisions(gridInfo(["--", "##"]), { cellSize: CELL, chunkSize: 8, width: 2, height: 2 }, 1);
    expect(data.chunks).toHaveLength(1);
    expect(data.chunks[0]?.polygons).toHaveLength(3);
  });
});
