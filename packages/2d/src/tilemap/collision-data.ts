import type { Vec2Like } from "@ignifx/core";

/**
 * The collision footprint of a single tile, expressed in **cell-local metres** with the origin at
 * the bottom-left corner of the cell (ignifx 2D is +Y up — `docs/adr/0011`).
 *
 * @remarks
 * `"none"` is the shape of a tile that renders but does not collide; it is the default for a tile
 * whose tileset entry declares no collider.
 *
 * @public
 */
export type TileCollisionShape =
  | {
      /** Discriminant: an axis-aligned box. */
      readonly kind: "box";
      /** The box's left edge, in cell-local metres. */
      readonly x: number;
      /** The box's bottom edge, in cell-local metres. */
      readonly y: number;
      /** The box's width, in metres. */
      readonly width: number;
      /** The box's height, in metres. */
      readonly height: number;
    }
  | {
      /** Discriminant: a convex or concave outline. */
      readonly kind: "polygon";
      /** The outline's vertices in cell-local metres, wound counter-clockwise. */
      readonly points: readonly Vec2Like[];
    }
  | {
      /** Discriminant: the tile does not collide. */
      readonly kind: "none";
    };

/**
 * Everything a physics backend needs to know about one tile of a tileset.
 *
 * @public
 */
export interface TileCollisionInfo {
  /** The tile's collision footprint in cell-local metres. */
  readonly shape: TileCollisionShape;
  /** Whether the tile is a one-way platform (solid only when crossed from above). */
  readonly oneWay: boolean;
  /** The tile's custom properties, carried through from the tileset or the importer. */
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

/**
 * The merged collision geometry of one chunk of a tilemap, in **world-space metres relative to the
 * tilemap entity's origin**.
 *
 * @remarks
 * Adjacent solid tiles are merged into as few polygons as possible before they reach this shape, so
 * a solid 3x2 block of tiles arrives as a single six-vertex rectangle rather than six boxes.
 *
 * @public
 */
export interface TilemapCollisionChunk {
  /** The chunk's column index, in chunks. */
  readonly chunkX: number;
  /** The chunk's row index, in chunks. */
  readonly chunkY: number;
  /** The merged solid outlines, each wound counter-clockwise. */
  readonly polygons: readonly (readonly Vec2Like[])[];
  /** The one-way platform edges, each a `[from, to]` pair with solid side to the left of `from → to`. */
  readonly oneWayEdges: readonly (readonly [Vec2Like, Vec2Like])[];
}

/**
 * The whole collision surface of a `Tilemap`, chunked so a physics backend can rebuild only the
 * chunks that changed.
 *
 * @remarks
 * `version` increments whenever any chunk changes; a backend that caches colliders compares it to
 * the version it last consumed and rebuilds when they differ. `Tilemap.onCollisionChanged` fires at
 * the same moment.
 *
 * @public
 */
export interface TilemapCollisionData {
  /** The edge length of one cell, in metres. */
  readonly cellSize: number;
  /** The edge length of one chunk, in cells. */
  readonly chunkSize: number;
  /** The chunks that carry at least one collider; empty chunks are omitted. */
  readonly chunks: readonly TilemapCollisionChunk[];
  /** Increments on every change to the merged geometry. */
  readonly version: number;
}
