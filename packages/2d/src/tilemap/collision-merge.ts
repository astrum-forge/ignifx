import type { TileCollisionInfo, TilemapCollisionChunk, TilemapCollisionData } from "./collision-data.js";
import type { Vec2Like } from "@ignifx/core";

/**
 * The greedy merge that turns a grid of per-tile collision shapes into the handful of polygons a 2D
 * physics backend actually wants (`docs/architecture/11-2d-toolkit.md` §2.5).
 *
 * A tilemap with ten thousand solid cells must not become ten thousand colliders: Rapier would
 * spend its whole broad-phase on them and the island solver would never sleep. Merging a solid
 * region into one polygon per rectangle is the standard fix, and it is worth doing at rebuild time
 * because a rebuild is rare and a step is not.
 */

/**
 * The grid {@link mergeTileCollisions} walks.
 *
 * @public
 */
export interface CollisionMergeOptions {
  /** The edge length of one cell, in metres. */
  readonly cellSize: number;
  /** The edge length of one chunk, in cells; `32` is what `TilemapRenderer` uses. */
  readonly chunkSize: number;
  /** The grid's width, in cells. */
  readonly width: number;
  /** The grid's height, in cells. */
  readonly height: number;
}

/**
 * One maximal horizontal run of full-cell solid tiles inside a chunk, in chunk-local cells.
 */
interface SolidRun {
  /** The run's first column, chunk-local. */
  readonly start: number;
  /** The run's last column, chunk-local and inclusive. */
  readonly end: number;
  /** Whether an earlier row has already absorbed this run into a taller block. */
  consumed: boolean;
}

/**
 * Whether a tile's collider fills its whole cell and is not a one-way platform — the only shape the
 * rectangle merge can absorb.
 *
 * @param info - The tile's collision info, in cell-local metres.
 * @param cellSize - The edge length of one cell, in metres.
 * @returns Whether the tile is a plain, full-cell solid.
 *
 * @example
 * ```ts
 * isFullCellSolid({ shape: { kind: "box", x: 0, y: 0, width: 1, height: 1 }, oneWay: false, properties: {} }, 1);
 * // true
 * ```
 *
 * @public
 */
export function isFullCellSolid(info: TileCollisionInfo, cellSize: number): boolean {
  if (info.oneWay) {
    return false;
  }
  const shape = info.shape;
  return (
    shape.kind === "box" && shape.x === 0 && shape.y === 0 && shape.width === cellSize && shape.height === cellSize
  );
}

/**
 * Merges a grid of per-tile collision shapes into chunked, world-space polygons.
 *
 * @remarks
 * **Coordinates.** `infoAt` is called with cell coordinates in which `y = 0` is the **bottom** row,
 * because the ignifx 2D world is +Y up; a caller reading a `TilemapLayerDefinition`, whose rows run
 * top-first, indexes it as `(height - 1 - y) * width + x`. Everything this function emits is world
 * metres relative to the tilemap's origin, so cell `(x, y)` spans
 * `[x·cellSize, (x+1)·cellSize] × [y·cellSize, (y+1)·cellSize]`.
 *
 * **The merge.** Each chunk is handled independently, so a later edit rebuilds one chunk rather than
 * the map. Inside a chunk, cells that {@link isFullCellSolid} accepts go into a boolean grid and are
 * merged in two greedy passes: first every row is cut into maximal horizontal runs, then a run
 * extends upwards for as long as the row above holds a run with exactly the same span, which is
 * marked consumed. Each surviving block is emitted as one counter-clockwise rectangle. It is the
 * classic row-then-column greedy mesher: linear in cells plus a small scan per row, and optimal for
 * rectangles while deliberately not optimal in general — an L-shape comes out as two rectangles, not
 * one six-vertex polygon, and that is the trade the algorithm makes for being O(n).
 *
 * Anything the rectangle pass cannot absorb — a partial box, a slope polygon — is emitted as its own
 * polygon, translated into world metres. Its winding is already counter-clockwise, because
 * `tileCollisionInfo` guarantees it.
 *
 * **One-way platforms.** A one-way tile contributes no polygon at all; it contributes its collider's
 * **top edge** to `oneWayEdges`. The winding follows the same rule as a polygon: the solid material
 * is to the **left** of `from → to`. For a directed edge `d = to − from`, "left" is `d` rotated a
 * quarter turn counter-clockwise, `(−dy, dx)`. An upward-facing platform is solid *below* its
 * surface — that is the half you cannot pass through once you have landed — so we need
 * `(−dy, dx) = (0, −1)`, giving `dy = 0` and `dx = −1`. The edge therefore runs from its **right**
 * end to its **left** end.
 *
 * Chunks that end up with neither a polygon nor a one-way edge are omitted entirely.
 *
 * @param infoAt - The per-cell collision info, in cell coordinates with `y = 0` at the bottom.
 * @param options - The cell size, chunk size, and grid extent.
 * @param version - The version stamp to carry into the result; callers increment it per rebuild.
 * @returns The chunked collision data.
 *
 * @example
 * ```ts
 * const data = mergeTileCollisions((x, y) => tileCollisionInfo(map, tileAt(x, y)), {
 *   cellSize: map.cellSize,
 *   chunkSize: 32,
 *   width: map.width,
 *   height: map.height,
 * }, 1);
 * ```
 *
 * @public
 */
export function mergeTileCollisions(
  infoAt: (x: number, y: number) => TileCollisionInfo,
  options: CollisionMergeOptions,
  version: number,
): TilemapCollisionData {
  const { cellSize, chunkSize, width, height } = options;
  const chunks: TilemapCollisionChunk[] = [];
  if (cellSize <= 0 || chunkSize <= 0 || width <= 0 || height <= 0) {
    return { cellSize, chunkSize, chunks, version };
  }
  const chunksX = Math.ceil(width / chunkSize);
  const chunksY = Math.ceil(height / chunkSize);
  for (let chunkY = 0; chunkY < chunksY; chunkY += 1) {
    for (let chunkX = 0; chunkX < chunksX; chunkX += 1) {
      const chunk = mergeChunk(infoAt, options, chunkX, chunkY);
      if (chunk !== null) {
        chunks.push(chunk);
      }
    }
  }
  return { cellSize, chunkSize, chunks, version };
}

/**
 * Merges one chunk of the grid.
 *
 * @param infoAt - The per-cell collision info.
 * @param options - The cell size, chunk size, and grid extent.
 * @param chunkX - The chunk's column index.
 * @param chunkY - The chunk's row index.
 * @returns The chunk, or `null` when it carries no geometry.
 */
function mergeChunk(
  infoAt: (x: number, y: number) => TileCollisionInfo,
  options: CollisionMergeOptions,
  chunkX: number,
  chunkY: number,
): TilemapCollisionChunk | null {
  const { cellSize, chunkSize, width, height } = options;
  const originX = chunkX * chunkSize;
  const originY = chunkY * chunkSize;
  const columns = Math.min(chunkSize, width - originX);
  const rows = Math.min(chunkSize, height - originY);
  const polygons: (readonly Vec2Like[])[] = [];
  const oneWayEdges: (readonly [Vec2Like, Vec2Like])[] = [];
  const solid = new Uint8Array(columns * rows);

  for (let localY = 0; localY < rows; localY += 1) {
    for (let localX = 0; localX < columns; localX += 1) {
      const cellX = originX + localX;
      const cellY = originY + localY;
      const info = infoAt(cellX, cellY);
      const shape = info.shape;
      if (shape.kind === "none") {
        continue;
      }
      if (info.oneWay) {
        const edge = topEdge(shape, cellX * cellSize, cellY * cellSize);
        if (edge !== null) {
          oneWayEdges.push(edge);
        }
        continue;
      }
      if (isFullCellSolid(info, cellSize)) {
        solid[localY * columns + localX] = 1;
        continue;
      }
      polygons.push(translateShape(shape, cellX * cellSize, cellY * cellSize));
    }
  }

  mergeSolidRuns(solid, columns, rows, originX, originY, cellSize, polygons);

  if (polygons.length === 0 && oneWayEdges.length === 0) {
    return null;
  }
  return { chunkX, chunkY, polygons, oneWayEdges };
}

/**
 * Runs the row-then-column greedy merge over the chunk's full-cell solid mask.
 *
 * @param solid - The `columns * rows` mask, row-major with row `0` at the bottom.
 * @param columns - The chunk's width in cells.
 * @param rows - The chunk's height in cells.
 * @param originX - The chunk's first column, in grid cells.
 * @param originY - The chunk's first row, in grid cells.
 * @param cellSize - The edge length of one cell, in metres.
 * @param out - The polygon list to append merged rectangles to.
 */
function mergeSolidRuns(
  solid: Uint8Array,
  columns: number,
  rows: number,
  originX: number,
  originY: number,
  cellSize: number,
  out: (readonly Vec2Like[])[],
): void {
  const runsByRow: SolidRun[][] = [];
  for (let localY = 0; localY < rows; localY += 1) {
    const runs: SolidRun[] = [];
    let localX = 0;
    while (localX < columns) {
      if (solid[localY * columns + localX] !== 1) {
        localX += 1;
        continue;
      }
      const start = localX;
      while (localX + 1 < columns && solid[localY * columns + localX + 1] === 1) {
        localX += 1;
      }
      runs.push({ start, end: localX, consumed: false });
      localX += 1;
    }
    runsByRow.push(runs);
  }

  for (let localY = 0; localY < rows; localY += 1) {
    const runs = runsByRow[localY];
    if (runs === undefined) {
      continue;
    }
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (run === undefined || run.consumed) {
        continue;
      }
      let top = localY;
      while (top + 1 < rows) {
        const above = findRun(runsByRow[top + 1], run.start, run.end);
        if (above === null) {
          break;
        }
        above.consumed = true;
        top += 1;
      }
      const left = (originX + run.start) * cellSize;
      const right = (originX + run.end + 1) * cellSize;
      const bottom = (originY + localY) * cellSize;
      const ceiling = (originY + top + 1) * cellSize;
      out.push([
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: right, y: ceiling },
        { x: left, y: ceiling },
      ]);
    }
  }
}

/**
 * Finds an unconsumed run with exactly the given span.
 *
 * @param runs - The candidate row's runs.
 * @param start - The span's first column.
 * @param end - The span's last column.
 * @returns The matching run, or `null`.
 */
function findRun(runs: readonly SolidRun[] | undefined, start: number, end: number): SolidRun | null {
  if (runs === undefined) {
    return null;
  }
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (run !== undefined && !run.consumed && run.start === start && run.end === end) {
      return run;
    }
  }
  return null;
}

/**
 * Moves a cell-local shape into world metres.
 *
 * @param shape - The tile's shape, in cell-local metres with a bottom-left origin.
 * @param offsetX - The cell's left edge, in world metres.
 * @param offsetY - The cell's bottom edge, in world metres.
 * @returns The outline, counter-clockwise, in world metres.
 */
function translateShape(shape: TileCollisionInfo["shape"], offsetX: number, offsetY: number): readonly Vec2Like[] {
  if (shape.kind === "box") {
    const left = offsetX + shape.x;
    const bottom = offsetY + shape.y;
    const right = left + shape.width;
    const top = bottom + shape.height;
    return [
      { x: left, y: bottom },
      { x: right, y: bottom },
      { x: right, y: top },
      { x: left, y: top },
    ];
  }
  if (shape.kind === "polygon") {
    const points: Vec2Like[] = [];
    for (let index = 0; index < shape.points.length; index += 1) {
      const point = shape.points[index];
      if (point !== undefined) {
        points.push({ x: offsetX + point.x, y: offsetY + point.y });
      }
    }
    return points;
  }
  return [];
}

/**
 * The top edge of a one-way tile's collider, wound so the solid side is to the left.
 *
 * @param shape - The tile's shape, in cell-local metres with a bottom-left origin.
 * @param offsetX - The cell's left edge, in world metres.
 * @param offsetY - The cell's bottom edge, in world metres.
 * @returns The `[from, to]` pair, right end first, or `null` when the shape has no width.
 */
function topEdge(
  shape: TileCollisionInfo["shape"],
  offsetX: number,
  offsetY: number,
): readonly [Vec2Like, Vec2Like] | null {
  if (shape.kind === "box") {
    if (shape.width <= 0) {
      return null;
    }
    const left = offsetX + shape.x;
    const right = left + shape.width;
    const top = offsetY + shape.y + shape.height;
    return [
      { x: right, y: top },
      { x: left, y: top },
    ];
  }
  if (shape.kind === "polygon") {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < shape.points.length; index += 1) {
      const point = shape.points[index];
      if (point === undefined) {
        continue;
      }
      left = Math.min(left, point.x);
      right = Math.max(right, point.x);
      top = Math.max(top, point.y);
    }
    if (!(right > left)) {
      return null;
    }
    return [
      { x: offsetX + right, y: offsetY + top },
      { x: offsetX + left, y: offsetY + top },
    ];
  }
  return null;
}
