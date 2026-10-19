import { asset, Component, createDefaults, defineSchema, f32, Signal, u32 } from "@ignifx/core";
import { twoDError, TwoDErrorCode } from "../errors.js";
import { mergeTileCollisions } from "./collision-merge.js";
import { tileCollisionInfo } from "./definition.js";
import { TilemapAsset } from "./tilemap-asset.js";
import type { TileCollisionInfo, TilemapCollisionData } from "./collision-data.js";
import type { TilemapDefinition, TilemapLayerDefinition } from "./definition.js";
import type { AssetHandle, ComponentHooks, MutableVec2, Schema, Vec2Like } from "@ignifx/core";

/**
 * Keep the tile grid and collision data available without a renderer or GPU.
 * Cell `(0, 0)` is the bottom-left; document rows are flipped from their top-first order.
 * Cell/world conversions include the tilemap entity's transform (ADR-0011).
 */

/**
 * How many cells one chunk spans by default (`docs/architecture/11-2d-toolkit.md` §2.5).
 *
 * @public
 */
export const DEFAULT_CHUNK_SIZE = 32;

/**
 * One tile change, as {@link Tilemap.onTileChanged} reports it.
 *
 * @public
 */
export interface TileChange {
  /** The layer's index in the document. */
  readonly layer: number;
  /** The cell's column, with `0` at the left. */
  readonly x: number;
  /** The cell's row, with `0` at the **bottom**. */
  readonly y: number;
  /** The tile id that was there. */
  readonly previous: number;
  /** The tile id that is there now. */
  readonly current: number;
}

/**
 * One cell write in a {@link Tilemap.setCells} batch.
 *
 * @public
 */
export interface TileWrite {
  /** The layer's index in the document. */
  readonly layer: number;
  /** The cell's column, with `0` at the left. */
  readonly x: number;
  /** The cell's row, with `0` at the **bottom**. */
  readonly y: number;
  /** The tile id, or `0` to clear the cell. */
  readonly tileId: number;
}

/**
 * A tilemap.
 *
 * @example
 * ```ts
 * const level = app.world.createEntity({ name: "level" }).addComponent(Tilemap);
 * level.map = app.assets.load<TilemapAsset>("2d/level-1.tilemap.json");
 * level.setTile(0, 3, 2, 0); // carve a hole in the ground layer
 * level.setCells([
 *   { layer: 0, x: 4, y: 2, tileId: 0 },
 *   { layer: 0, x: 5, y: 2, tileId: 0 },
 * ]);
 * ```
 *
 * @public
 */
export class Tilemap extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/Tilemap";

  /** One tilemap per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = tilemapSchema();

  /** The `.tilemap.json` document. */
  declare map: AssetHandle<TilemapAsset> | null;

  /** How many cells one chunk spans on each axis. */
  declare chunkSize: number;

  /** The metres one cell spans, overriding the document's own; `0` uses the document's. */
  declare cellSizeOverride: number;

  /** The mutable tile grids, bottom row first, one per document layer. */
  #grids: Int32Array[] = [];

  /** The document the grids were built from, so a swapped asset rebuilds them. */
  #built: TilemapAsset | null = null;

  /** The merged collision surface, rebuilt lazily after a change. */
  #collision: TilemapCollisionData = EMPTY_COLLISION;

  /** Whether the collision surface needs rebuilding. */
  #collisionDirty = true;

  /** Bumped on every collision rebuild, so a physics backend can skip unchanged frames. */
  #version = 0;

  /** Bumped once per `setTile` or `setCells` call that changed a cell, and on a layout change. */
  #tileVersion = 0;

  /** Per render chunk, the `#tileVersion` of its last change; row-major, `#stampChunksX` wide. */
  #chunkStamps = new Uint32Array(0);

  /** The chunk size `#chunkStamps` was laid out for; `0` forces a new layout. */
  #stampChunkSize = 0;

  /** How many chunk columns `#chunkStamps` has. */
  #stampChunksX = 0;

  readonly #onTileChanged = new Signal<TileChange>();

  readonly #onCollisionChanged = new Signal();

  /**
   * Builds a tilemap with the schema's defaults.
   */
  constructor() {
    super();
    Object.assign(this, createDefaults(Tilemap.schema));
  }

  /**
   * Drops the grids, so a recycled component does not inherit the previous one's.
   */
  onAttach(): void {
    this.#grids = [];
    this.#built = null;
    this.#stampChunkSize = 0;
    this.#collision = EMPTY_COLLISION;
    this.#collisionDirty = true;
  }

  /**
   * Releases the grids.
   */
  onDetach(): void {
    this.#grids = [];
    this.#built = null;
  }

  /**
   * Emitted whenever `setTile` or `setCells` changes a cell.
   *
   * @returns The signal.
   */
  get onTileChanged(): Signal<TileChange> {
    return this.#onTileChanged;
  }

  /**
   * Emitted after the merged collision surface has been rebuilt.
   *
   * @remarks
   * `@ignifx/physics-2d` connects to this and rebuilds only the chunks whose geometry moved. The
   * rebuild is lazy: the signal fires on the first read of {@link Tilemap.collisionData} after a
   * change, not on the `setTile` call itself, so a script that rewrites a thousand tiles in one
   * frame pays for one merge.
   *
   * @returns The signal.
   */
  get onCollisionChanged(): Signal {
    return this.#onCollisionChanged;
  }

  /**
   * The loaded document, or `null` while it is still loading.
   *
   * @returns The asset.
   */
  get asset(): TilemapAsset | null {
    const handle = this.map;
    return handle?.state === "loaded" ? handle.value : null;
  }

  /**
   * The parsed document, or `null`.
   *
   * @returns The definition.
   */
  get definition(): TilemapDefinition | null {
    return this.asset?.definition ?? null;
  }

  /**
   * How many metres one cell spans.
   *
   * @returns The cell size; `0` when nothing has loaded.
   */
  get cellSize(): number {
    if (this.cellSizeOverride > 0) {
      return this.cellSizeOverride;
    }
    return this.definition?.cellSize ?? 0;
  }

  /**
   * How many layers the document has.
   *
   * @returns The layer count.
   */
  get layerCount(): number {
    return this.definition?.layers.length ?? 0;
  }

  /**
   * The merged collision surface, rebuilt if a tile changed since the last read.
   *
   * @remarks
   * The shape is the contract `@ignifx/physics-2d` consumes: chunked, in world metres relative to
   * the tilemap entity's origin, with adjacent full-cell tiles merged into as few counter-clockwise
   * rectangles as possible.
   *
   * @returns The collision data; empty until the map has loaded.
   */
  get collisionData(): TilemapCollisionData {
    // A map that finished loading, or was swapped, since the last read has to rebuild.
    this.#ensureGrids();
    if (this.#collisionDirty) {
      this.#rebuildCollision();
    }
    return this.#collision;
  }

  /**
   * Reads a tile.
   *
   * @param layer - The layer's index in the document.
   * @param x - The cell's column, with `0` at the left.
   * @param y - The cell's row, with `0` at the bottom.
   * @returns The tile id, or `0` for an empty or out-of-range cell.
   */
  getTile(layer: number, x: number, y: number): number {
    this.#ensureGrids();
    const definition = this.definition;
    const grid = this.#grids[layer];
    const declared = definition?.layers[layer];
    if (grid === undefined || declared === undefined || !inRange(x, y, declared.width, declared.height)) {
      return 0;
    }
    return grid[y * declared.width + x] ?? 0;
  }

  /**
   * Writes a tile.
   *
   * @param layer - The layer's index in the document.
   * @param x - The cell's column, with `0` at the left.
   * @param y - The cell's row, with `0` at the bottom.
   * @param tileId - The tile id, or `0` to clear the cell.
   * @throws IgnifxError with code `IGX-1111` when the cell is outside the layer.
   */
  setTile(layer: number, x: number, y: number, tileId: number): void {
    this.#ensureGrids();
    const declared = this.#checkCell(layer, x, y);
    const grid = this.#grids[layer];
    const offset = y * declared.width + x;
    const previous = grid?.[offset] ?? 0;
    if (grid === undefined || previous === tileId) {
      return;
    }
    this.#tileVersion += 1;
    grid[offset] = tileId;
    this.#stampCell(x, y);
    if (declared.collision) {
      this.#collisionDirty = true;
    }
    this.#onTileChanged.emit({ layer, x, y, previous, current: tileId });
  }

  /**
   * Writes many tiles as one change.
   *
   * @remarks
   * Each write means what the same `setTile` call means, applied in order, so a cell named twice
   * ends with the later id. The batch is checked before anything is written: one out-of-range cell
   * throws and leaves the map untouched. The renderer rebuilds each touched chunk once and the
   * collision surface merges once, however many cells changed; `onTileChanged` then fires once per
   * changed cell, after every write has landed.
   *
   * @param cells - The writes.
   * @returns How many writes changed a cell.
   * @throws IgnifxError with code `IGX-1111` when a cell is outside its layer.
   *
   * @example
   * ```ts
   * // Clear a 3x3 room on layer 0.
   * const cells: TileWrite[] = [];
   * for (let y = 4; y < 7; y += 1) {
   *   for (let x = 2; x < 5; x += 1) {
   *     cells.push({ layer: 0, x, y, tileId: 0 });
   *   }
   * }
   * level.setCells(cells);
   * ```
   */
  setCells(cells: readonly TileWrite[]): number {
    this.#ensureGrids();
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (cell !== undefined) {
        this.#checkCell(cell.layer, cell.x, cell.y);
      }
    }
    const changes: TileChange[] = [];
    const definition = this.definition;
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const grid = cell === undefined ? undefined : this.#grids[cell.layer];
      const declared = cell === undefined ? undefined : definition?.layers[cell.layer];
      if (cell === undefined || grid === undefined || declared === undefined) {
        continue;
      }
      const offset = cell.y * declared.width + cell.x;
      const previous = grid[offset] ?? 0;
      if (previous === cell.tileId) {
        continue;
      }
      if (changes.length === 0) {
        this.#tileVersion += 1;
      }
      grid[offset] = cell.tileId;
      this.#stampCell(cell.x, cell.y);
      if (declared.collision) {
        this.#collisionDirty = true;
      }
      changes.push({ layer: cell.layer, x: cell.x, y: cell.y, previous, current: cell.tileId });
    }
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      if (change !== undefined) {
        this.#onTileChanged.emit(change);
      }
    }
    return changes.length;
  }

  /**
   * When a render chunk's tiles last changed, so a `TilemapRenderer` rebuilds only the chunks a
   * `setTile` or `setCells` touched.
   *
   * @param chunkX - The chunk's column, in chunks of `chunkSize` cells.
   * @param chunkY - The chunk's row.
   * @returns An opaque stamp; it differs from the last one read exactly when the chunk changed.
   *
   * @internal
   */
  chunkStamp(chunkX: number, chunkY: number): number {
    this.#ensureGrids();
    this.#ensureStamps();
    if (chunkX < 0 || chunkX >= this.#stampChunksX) {
      return this.#tileVersion;
    }
    return this.#chunkStamps[chunkY * this.#stampChunksX + chunkX] ?? this.#tileVersion;
  }

  /**
   * A layer's size, in cells.
   *
   * @param layer - The layer's index.
   * @returns The size, or a zero size for an unknown layer.
   */
  layerSize(layer: number): Vec2Like {
    const declared = this.definition?.layers[layer];
    return declared === undefined ? ZERO : { x: declared.width, y: declared.height };
  }

  /**
   * Converts a world point into the cell containing it.
   *
   * @remarks
   * The point is in world metres; the map's own origin is the tilemap entity's position, so a moved
   * or scaled tilemap still answers correctly. The result is floored, so a point exactly on a cell
   * boundary belongs to the cell above and to the right of it.
   *
   * @param point - The world point, in metres.
   * @param out - The vector to write.
   * @returns `out`, holding integer cell coordinates that may be outside the map.
   */
  worldToCell<TOut extends MutableVec2>(point: Vec2Like, out: TOut): TOut {
    const size = this.cellSize;
    const matrix = this.entity.transform.worldMatrix;
    const originX = matrix[12] ?? 0;
    const originY = matrix[13] ?? 0;
    if (size <= 0) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    out.x = Math.floor((point.x - originX) / size);
    out.y = Math.floor((point.y - originY) / size);
    return out;
  }

  /**
   * Converts a cell into the world point at its **centre**.
   *
   * @param x - The cell's column.
   * @param y - The cell's row, with `0` at the bottom.
   * @param out - The vector to write.
   * @returns `out`, in world metres.
   */
  cellToWorld<TOut extends MutableVec2>(x: number, y: number, out: TOut): TOut {
    const size = this.cellSize;
    const matrix = this.entity.transform.worldMatrix;
    out.x = (matrix[12] ?? 0) + (x + 0.5) * size;
    out.y = (matrix[13] ?? 0) + (y + 0.5) * size;
    return out;
  }

  /**
   * The collision footprint of whatever is at a cell, across every collision layer.
   *
   * @param x - The cell's column.
   * @param y - The cell's row, with `0` at the bottom.
   * @returns The topmost non-empty collider, or a `"none"` shape.
   */
  collisionAt(x: number, y: number): TileCollisionInfo {
    const definition = this.definition;
    if (definition === null) {
      return NO_COLLISION;
    }
    for (let layer = definition.layers.length - 1; layer >= 0; layer -= 1) {
      const declared = definition.layers[layer];
      if (declared === undefined || !declared.collision) {
        continue;
      }
      const info = tileCollisionInfo(definition, this.getTile(layer, x, y));
      if (info.shape.kind !== "none") {
        return info;
      }
    }
    return NO_COLLISION;
  }

  /**
   * Forces the collision surface to be rebuilt on the next read.
   *
   * @internal
   */
  invalidateCollision(): void {
    this.#collisionDirty = true;
  }

  /**
   * Checks a cell against its layer.
   *
   * @param layer - The layer's index.
   * @param x - The column.
   * @param y - The row.
   * @returns The layer's declaration.
   * @throws IgnifxError with code `IGX-1111` when the cell is outside the layer.
   */
  #checkCell(layer: number, x: number, y: number): TilemapLayerDefinition {
    const declared = this.definition?.layers[layer];
    if (this.#grids[layer] === undefined || declared === undefined || !inRange(x, y, declared.width, declared.height)) {
      throw twoDError(
        TwoDErrorCode.tileOutOfRange,
        `Cell ${String(x)},${String(y)} is outside layer ${String(layer)}.`,
        {
          context: { x, y, layer },
          hint: "Check the cell against Tilemap.layerSize; cell (0, 0) is the bottom-left.",
        },
      );
    }
    return declared;
  }

  /**
   * Stamps the chunk holding a cell with the current tile version.
   *
   * @param x - The column.
   * @param y - The row.
   */
  #stampCell(x: number, y: number): void {
    this.#ensureStamps();
    const chunkSize = this.#stampChunkSize;
    const chunkX = Math.floor(x / chunkSize);
    const index = Math.floor(y / chunkSize) * this.#stampChunksX + chunkX;
    if (chunkX < this.#stampChunksX && index < this.#chunkStamps.length) {
      this.#chunkStamps[index] = this.#tileVersion;
    }
  }

  /**
   * Lays the chunk stamps out for the current map and chunk size.
   *
   * @remarks
   * A new layout stamps every chunk with a fresh version, so whatever a renderer built under the
   * old one is rebuilt.
   */
  #ensureStamps(): void {
    const chunkSize = Math.max(1, this.chunkSize);
    if (chunkSize === this.#stampChunkSize) {
      return;
    }
    const definition = this.definition;
    const chunksX = definition === null ? 0 : Math.ceil(definition.width / chunkSize);
    const chunksY = definition === null ? 0 : Math.ceil(definition.height / chunkSize);
    this.#tileVersion += 1;
    this.#chunkStamps = new Uint32Array(chunksX * chunksY).fill(this.#tileVersion);
    this.#stampChunkSize = chunkSize;
    this.#stampChunksX = chunksX;
  }

  /**
   * Builds the mutable grids from the document, flipping each layer bottom-row-first.
   */
  #ensureGrids(): void {
    const loaded = this.asset;
    if (loaded === null || loaded === this.#built) {
      return;
    }
    this.#built = loaded;
    this.#collisionDirty = true;
    this.#stampChunkSize = 0;
    const grids: Int32Array[] = [];
    const layers = loaded.definition.layers;
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      if (layer === undefined) {
        grids.push(new Int32Array(0));
        continue;
      }
      const grid = new Int32Array(layer.width * layer.height);
      for (let row = 0; row < layer.height; row += 1) {
        // The document stores the top row first; cell row 0 is the bottom.
        const source = (layer.height - 1 - row) * layer.width;
        for (let column = 0; column < layer.width; column += 1) {
          grid[row * layer.width + column] = layer.tiles[source + column] ?? 0;
        }
      }
      grids.push(grid);
    }
    this.#grids = grids;
  }

  /**
   * Merges every collision layer's tiles into chunked polygons.
   */
  #rebuildCollision(): void {
    this.#ensureGrids();
    this.#collisionDirty = false;
    const definition = this.definition;
    const size = this.cellSize;
    if (definition === null || size <= 0) {
      this.#collision = EMPTY_COLLISION;
      return;
    }
    this.#version += 1;
    this.#collision = mergeTileCollisions(
      (x: number, y: number): TileCollisionInfo => this.collisionAt(x, y),
      { cellSize: size, chunkSize: Math.max(1, this.chunkSize), width: definition.width, height: definition.height },
      this.#version,
    );
    this.#onCollisionChanged.emit();
  }
}

/** The cell size a tilemap with nothing loaded reports. */
const ZERO: Vec2Like = Object.freeze({ x: 0, y: 0 });

/** The collision surface of a tilemap with nothing loaded. */
const EMPTY_COLLISION: TilemapCollisionData = Object.freeze({
  cellSize: 0,
  chunkSize: 0,
  chunks: Object.freeze([]),
  version: 0,
});

/** The answer for a cell that carries no collider. */
const NO_COLLISION: TileCollisionInfo = Object.freeze({
  shape: Object.freeze({ kind: "none" as const }),
  oneWay: false,
  properties: Object.freeze({}),
});

/**
 * Whether a cell is inside a layer.
 *
 * @param x - The column.
 * @param y - The row.
 * @param width - The layer width, in cells.
 * @param height - The layer height, in cells.
 * @returns `true` when the cell exists.
 */
function inRange(x: number, y: number, width: number, height: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
}

/**
 * The `Tilemap` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function tilemapSchema(): Schema {
  return defineSchema({
    map: asset(TilemapAsset, { tooltip: "The .tilemap.json document." }),
    chunkSize: u32(DEFAULT_CHUNK_SIZE, { min: 1, tooltip: "How many cells one render and collision chunk spans." }),
    cellSizeOverride: f32(0, { min: 0, tooltip: "Metres per cell, overriding the document's own; 0 uses it." }),
  });
}
