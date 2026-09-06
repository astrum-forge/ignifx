import { assertNever } from "@ignifx/core";
import { twoDError, TwoDErrorCode } from "../errors.js";
import { DEFAULT_PIXELS_PER_UNIT } from "../math/coords.js";
import type { TileCollisionInfo, TileCollisionShape } from "./collision-data.js";
import type { Vec2Like } from "@ignifx/core";

/**
 * The `ignifx.tilemap` document — the `.tilemap.json` file that names tile sizes, tilesets, tile
 * layers and object layers (`docs/architecture/06-serialization-and-scene-format.md` §6,
 * `11-2d-toolkit.md` §2.5).
 *
 * Two coordinate conventions meet in this file and it is worth stating both loudly, because getting
 * them backwards is the single easiest mistake to make in a tilemap pipeline:
 *
 * - **Authoring space** (everything on `TileColliderDefinition` and every editor this package
 *   imports from) is cell-normalised `[0, 1]` with the origin at the **top-left** of the cell and
 *   +Y pointing **down**. Tiled and LDtk both emit pixels in that orientation, and the importers
 *   divide by the tile size rather than flipping.
 * - **Runtime space** (`TileCollisionShape`, `TilemapCollisionData`, and every world coordinate on
 *   `TilemapObjectDefinition`) is metres with the origin at the **bottom-left** and +Y pointing
 *   **up**, because that is the ignifx 2D world (ADR-0011).
 *
 * {@link tileCollisionInfo} is the one function that crosses between them, so the flip lives in
 * exactly one place — the same discipline `../math/coords.ts` applies to the render path.
 */

/**
 * The `format` discriminator every `.tilemap.json` document carries.
 *
 * @public
 */
export const TILEMAP_FORMAT = "ignifx.tilemap";

/**
 * The document version this build reads and writes.
 *
 * @public
 */
export const TILEMAP_FORMAT_VERSION = 1;

/**
 * The asset type name the loader registers.
 *
 * @public
 */
export const TILEMAP_ASSET_TYPE = "tilemap";

/**
 * The address suffixes that select the tilemap loader.
 *
 * @public
 */
export const TILEMAP_FILE_EXTENSIONS: readonly string[] = Object.freeze([".tilemap.json"]);

/**
 * The tile id that means "this cell is empty"; no tileset may claim it.
 *
 * @public
 */
export const EMPTY_TILE_ID = 0;

/** The properties record handed back for a tile that declares none; frozen and shared. */
const EMPTY_PROPERTIES: Readonly<Record<string, string | number | boolean>> = Object.freeze({});

/** The collision info of a cell that does not collide; frozen and shared. */
const NO_TILE_COLLISION: TileCollisionInfo = Object.freeze({
  shape: Object.freeze({ kind: "none" } as const),
  oneWay: false,
  properties: EMPTY_PROPERTIES,
});

/**
 * A tile's collision footprint **as authored**: cell-normalised `[0, 1]` units with the origin at
 * the cell's **top-left** corner and +Y pointing **down**.
 *
 * @remarks
 * This is deliberately *not* {@link TileCollisionShape}, which is cell-local **metres** with a
 * **bottom-left** origin, +Y up and counter-clockwise winding. Editors work top-down and the
 * physics world works bottom-up; {@link tileCollisionInfo} converts, and nothing else should.
 *
 * A box covering the top quarter of a cell — the usual one-way platform — is
 * `{ kind: "box", x: 0, y: 0, width: 1, height: 0.25, oneWay: true }`.
 *
 * @public
 */
export type TileColliderDefinition =
  | {
      /** Discriminant: an axis-aligned box. */
      readonly kind: "box";
      /** The box's left edge, in cell-normalised units. */
      readonly x: number;
      /** The box's **top** edge, in cell-normalised units measured downwards from the cell's top. */
      readonly y: number;
      /** The box's width, in cell-normalised units. */
      readonly width: number;
      /** The box's height, in cell-normalised units. */
      readonly height: number;
      /** Whether the tile is a one-way platform. Defaults to `false`. */
      readonly oneWay?: boolean;
    }
  | {
      /** Discriminant: an outline. */
      readonly kind: "polygon";
      /** The vertices in cell-normalised units with a top-left origin, in the editor's winding. */
      readonly points: readonly Vec2Like[];
      /** Whether the tile is a one-way platform. Defaults to `false`. */
      readonly oneWay?: boolean;
    }
  | {
      /** Discriminant: the tile renders but does not collide. */
      readonly kind: "none";
    };

/**
 * One frame of an animated tile.
 *
 * @public
 */
export interface TileAnimationFrame {
  /** The atlas frame name drawn during this step. */
  readonly frame: string;
  /** How long the step lasts, in milliseconds. */
  readonly durationMs: number;
}

/**
 * One tile of a tileset: what it draws, what it collides with, and what it carries.
 *
 * @public
 */
export interface TileDefinition {
  /** The tile's index **within its tileset**, zero-based; the global id is `tileset.firstId + id`. */
  readonly id: number;
  /** The atlas frame the tile draws, by name. */
  readonly frame: string;
  /** The collision footprint, in cell-normalised top-left-origin units. Absent means no collider. */
  readonly collider?: TileColliderDefinition;
  /** The tile's custom properties, carried through from the editor. */
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
  /** The animation frames, when the tile animates. A single frame is treated as a static tile. */
  readonly animation?: readonly TileAnimationFrame[];
}

/**
 * A block of tiles cut from one atlas, occupying a contiguous run of global tile ids.
 *
 * @public
 */
export interface TilesetDefinition {
  /** The tileset's name, unique within the document; also the frame-name prefix. */
  readonly name: string;
  /** The address of the `.atlas.json` the frames come from; empty for a collision-only tileset. */
  readonly atlas: string;
  /** The global id of this tileset's tile `0`. Always at least `1`, because `0` means empty. */
  readonly firstId: number;
  /** The tiles, indexed by their local {@link TileDefinition.id}. */
  readonly tiles: readonly TileDefinition[];
}

/**
 * One layer of tiles.
 *
 * @remarks
 * `tiles` is **always** the dense, decoded array in the parsed form: `width * height` global tile
 * ids in row-major order with the **top** row first, which is how every editor stores a grid.
 * `0` ({@link EMPTY_TILE_ID}) means the cell is empty. Runtime code that thinks in +Y-up cell
 * coordinates reads index `(height - 1 - cellY) * width + cellX`.
 *
 * @public
 */
export interface TilemapLayerDefinition {
  /** The layer's name, unique within the document. */
  readonly name: string;
  /** The sorting layer the tiles draw in (`docs/architecture/11-2d-toolkit.md` §1). */
  readonly sortingLayer: string;
  /** The order within the sorting layer; higher draws in front. */
  readonly orderInLayer: number;
  /** The layer's opacity in `[0, 1]`. */
  readonly opacity: number;
  /** The parallax multiplier; `{ x: 1, y: 1 }` moves with the camera. */
  readonly parallax: Vec2Like;
  /** Whether the layer contributes collision geometry. */
  readonly collision: boolean;
  /** The layer's width, in cells. */
  readonly width: number;
  /** The layer's height, in cells. */
  readonly height: number;
  /** `width * height` global tile ids, row-major, top row first. */
  readonly tiles: readonly number[];
}

/**
 * One object placed on the map, to be turned into an entity by a registered `TileObjectFactory`.
 *
 * @remarks
 * `x`, `y`, `width` and `height` are **world metres with +Y up**, and `x`/`y` name the object's
 * **bottom-left** corner. Importers do the conversion out of the editor's top-left pixel space, so
 * nothing downstream has to know what editor the map came from.
 *
 * @public
 */
export interface TilemapObjectDefinition {
  /** The object's name, as authored; not required to be unique. */
  readonly name: string;
  /** The object's type — what `app.twoD.registerTileObjectFactory` keys on. */
  readonly type: string;
  /** The left edge, in world metres. */
  readonly x: number;
  /** The bottom edge, in world metres, +Y up. */
  readonly y: number;
  /** The width, in world metres. */
  readonly width: number;
  /** The height, in world metres. */
  readonly height: number;
  /** The object's custom properties. */
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

/**
 * The parsed `.tilemap.json` document.
 *
 * @example
 * ```ts
 * const map = defineTilemap({
 *   tileWidth: 32,
 *   width: 2,
 *   height: 1,
 *   tilesets: [{ name: "hero", atlas: "2d/hero.atlas.json", firstId: 1, tiles: [{ id: 0, frame: "hero_0" }] }],
 *   layers: [{ name: "Ground", tiles: [1, 0] }],
 * });
 * map.cellSize; // 0.32 — 32 px at the default 100 pixels per unit
 * ```
 *
 * @public
 */
export interface TilemapDefinition {
  /** Always `"ignifx.tilemap"`. */
  readonly format: typeof TILEMAP_FORMAT;
  /** Always `1` in this build. */
  readonly formatVersion: number;
  /** The width of one tile, in **pixels**. */
  readonly tileWidth: number;
  /** The height of one tile, in **pixels**. */
  readonly tileHeight: number;
  /**
   * The world size of one cell, in metres — `tileWidth / pixelsPerUnit`.
   *
   * @remarks
   * Collision uses this single number on both axes. A map whose tiles are not square still gets a
   * square collision cell; that is a deliberate MVP limitation and it is why the importers warn
   * nothing and simply record both pixel sizes above.
   */
  readonly cellSize: number;
  /** The map's width, in cells. */
  readonly width: number;
  /** The map's height, in cells. */
  readonly height: number;
  /** The tilesets, sorted by ascending {@link TilesetDefinition.firstId}. */
  readonly tilesets: readonly TilesetDefinition[];
  /** The tile layers, back to front: index `0` draws behind index `1`. */
  readonly layers: readonly TilemapLayerDefinition[];
  /** The objects gathered from every object layer, in document order. */
  readonly objects: readonly TilemapObjectDefinition[];
  /** The map's custom properties. */
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

/**
 * A run-length-encoded tile array, as a `.tilemap.json` may store it to keep sparse maps small.
 *
 * @public
 */
export interface TileRleData {
  /** Flattened `[count, value, count, value, …]` pairs; see {@link decodeTileRle}. */
  readonly rle: readonly number[];
}

/**
 * What {@link defineTilemap} accepts for one layer: every defaulted field optional, and `tiles`
 * either dense or run-length encoded.
 *
 * @public
 */
export interface TilemapLayerInput {
  /** The layer's name, unique within the document. */
  readonly name: string;
  /** The sorting layer. Defaults to `"Default"`. */
  readonly sortingLayer?: string;
  /** The order within the sorting layer. Defaults to `0`. */
  readonly orderInLayer?: number;
  /** The opacity in `[0, 1]`. Defaults to `1`. */
  readonly opacity?: number;
  /** The parallax multiplier. Defaults to `{ x: 1, y: 1 }`. */
  readonly parallax?: Vec2Like;
  /** Whether the layer collides. Defaults to `false`. */
  readonly collision?: boolean;
  /** The layer's width in cells. Defaults to the map's width. */
  readonly width?: number;
  /** The layer's height in cells. Defaults to the map's height. */
  readonly height?: number;
  /** The tile ids, dense (row-major, top row first) or run-length encoded. */
  readonly tiles: readonly number[] | TileRleData;
}

/**
 * What {@link defineTilemap} accepts: the document with every defaulted field optional.
 *
 * @public
 */
export interface TilemapInput {
  /** Always `"ignifx.tilemap"` when present. */
  readonly format?: string;
  /** The document version. */
  readonly formatVersion?: number;
  /** The width of one tile, in pixels. */
  readonly tileWidth: number;
  /** The height of one tile, in pixels. Defaults to `tileWidth`. */
  readonly tileHeight?: number;
  /** The metre size of one cell. Defaults to `tileWidth / 100`, the default pixels-per-unit. */
  readonly cellSize?: number;
  /** The map's width, in cells. */
  readonly width: number;
  /** The map's height, in cells. */
  readonly height: number;
  /** The tilesets. Defaults to none. */
  readonly tilesets?: readonly TilesetDefinition[];
  /** The tile layers, back to front. Defaults to none. */
  readonly layers?: readonly TilemapLayerInput[];
  /** The objects. Defaults to none. */
  readonly objects?: readonly TilemapObjectDefinition[];
  /** The map's custom properties. Defaults to none. */
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Run-length encodes a dense tile array.
 *
 * @remarks
 * The layout is flat `[count, value, count, value, …]` pairs, read left to right, so
 * `[1, 1, 0, 0, 0]` encodes to `[2, 1, 3, 0]`. It is the same shape Tiled's chunk encoding and
 * LDtk's exports settle on, and it round-trips exactly through {@link decodeTileRle}.
 *
 * @param tiles - The dense tile ids.
 * @returns The encoded pairs; empty for an empty input.
 *
 * @example
 * ```ts
 * encodeTileRle([1, 1, 0, 0, 0]); // [2, 1, 3, 0]
 * ```
 *
 * @public
 */
export function encodeTileRle(tiles: readonly number[]): readonly number[] {
  const out: number[] = [];
  let index = 0;
  while (index < tiles.length) {
    const value = tiles[index] ?? EMPTY_TILE_ID;
    let count = 1;
    while (index + count < tiles.length && tiles[index + count] === value) {
      count += 1;
    }
    out.push(count, value);
    index += count;
  }
  return out;
}

/**
 * Expands the `[count, value, …]` pairs {@link encodeTileRle} produces back into a dense array.
 *
 * @param rle - The encoded pairs.
 * @returns The dense tile ids.
 * @throws IgnifxError with code `IGX-1105` when the array has an odd length, or a run count that is
 * not a finite non-negative integer.
 *
 * @example
 * ```ts
 * decodeTileRle([2, 1, 3, 0]); // [1, 1, 0, 0, 0]
 * ```
 *
 * @public
 */
export function decodeTileRle(rle: readonly number[]): readonly number[] {
  if (rle.length % 2 !== 0) {
    throw twoDError(
      TwoDErrorCode.invalidTilemapFile,
      `A run-length-encoded tile array must hold [count, value] pairs, and this one has ${String(rle.length)} entries.`,
      { context: { file: "<inline>", length: rle.length }, hint: "Re-export the map, or pass a dense tiles array." },
    );
  }
  const out: number[] = [];
  for (let index = 0; index < rle.length; index += 2) {
    const count = rle[index] ?? 0;
    const value = rle[index + 1] ?? EMPTY_TILE_ID;
    if (!Number.isInteger(count) || count < 0) {
      throw twoDError(
        TwoDErrorCode.invalidTilemapFile,
        `A run-length-encoded tile array has the run count ${String(count)} at index ${String(index)}.`,
        { context: { file: "<inline>", index }, hint: "Run counts must be non-negative integers." },
      );
    }
    for (let repeat = 0; repeat < count; repeat += 1) {
      out.push(value);
    }
  }
  return out;
}

/**
 * Fills in the defaults of a tilemap document, decodes any run-length-encoded layer, and checks the
 * invariants the renderer and the collider rely on.
 *
 * @param input - The document, as authored or as an importer emitted it.
 * @param address - What to name in an error; defaults to `"\<inline\>"`.
 * @returns The complete document, with every layer's `tiles` dense.
 * @throws IgnifxError with code `IGX-1105` when the format tag or version is wrong, a tile size is
 * not positive, a tileset's `firstId` is not positive, two layers share a name, a run-length array
 * has an odd length, or a layer's decoded tile count is not `width * height`.
 *
 * @public
 */
export function defineTilemap(input: TilemapInput, address = "<inline>"): TilemapDefinition {
  const fail = (reason: string): never => {
    throw twoDError(
      TwoDErrorCode.invalidTilemapFile,
      `${address} is not a readable ignifx.tilemap document: ${reason}.`,
      {
        context: { file: address },
        hint: "Re-import the map with `ignifx import tilemap`, or check the format and version fields.",
      },
    );
  };
  if (input.format !== undefined && input.format !== TILEMAP_FORMAT) {
    fail(`its format is ${input.format}, not ${TILEMAP_FORMAT}`);
  }
  if (input.formatVersion !== undefined && input.formatVersion !== TILEMAP_FORMAT_VERSION) {
    fail(`its formatVersion is ${String(input.formatVersion)}, and this build reads ${String(TILEMAP_FORMAT_VERSION)}`);
  }
  const tileWidth = input.tileWidth;
  const tileHeight = input.tileHeight ?? input.tileWidth;
  if (!(tileWidth > 0) || !(tileHeight > 0)) {
    fail(`its tile size is ${String(tileWidth)}x${String(tileHeight)} pixels, which is not positive`);
  }
  const width = input.width;
  const height = input.height;
  if (!(width > 0) || !(height > 0)) {
    fail(`its size is ${String(width)}x${String(height)} cells, which is not positive`);
  }

  const tilesetsInput = input.tilesets ?? [];
  for (let index = 0; index < tilesetsInput.length; index += 1) {
    const tileset = tilesetsInput[index];
    if (tileset === undefined) {
      continue;
    }
    if (!Number.isInteger(tileset.firstId) || tileset.firstId <= EMPTY_TILE_ID) {
      fail(`tileset ${tileset.name} has firstId ${String(tileset.firstId)}, and 0 is reserved for the empty tile`);
    }
  }
  // A stable ascending order is what makes `findTileset`'s "highest firstId that fits" a single
  // backward scan rather than a search over an arbitrary order.
  const tilesets = tilesetsInput.toSorted((left, right) => left.firstId - right.firstId);

  const layersInput = input.layers ?? [];
  const layers: TilemapLayerDefinition[] = [];
  const seenLayerNames = new Set<string>();
  for (let index = 0; index < layersInput.length; index += 1) {
    const layer = layersInput[index];
    if (layer === undefined) {
      continue;
    }
    if (seenLayerNames.has(layer.name)) {
      fail(`two layers are named ${layer.name}`);
    }
    seenLayerNames.add(layer.name);
    const layerWidth = layer.width ?? width;
    const layerHeight = layer.height ?? height;
    const tilesInput = layer.tiles;
    const tiles = "rle" in tilesInput ? decodeTileRle(tilesInput.rle) : tilesInput;
    if (tiles.length !== layerWidth * layerHeight) {
      fail(
        `layer ${layer.name} is ${String(layerWidth)}x${String(layerHeight)} cells but decodes to ${String(tiles.length)} tiles`,
      );
    }
    layers.push({
      name: layer.name,
      sortingLayer: layer.sortingLayer ?? "Default",
      orderInLayer: layer.orderInLayer ?? 0,
      opacity: layer.opacity ?? 1,
      parallax: layer.parallax ?? { x: 1, y: 1 },
      collision: layer.collision ?? false,
      width: layerWidth,
      height: layerHeight,
      tiles,
    });
  }

  return {
    format: TILEMAP_FORMAT,
    formatVersion: TILEMAP_FORMAT_VERSION,
    tileWidth,
    tileHeight,
    cellSize: input.cellSize ?? tileWidth / DEFAULT_PIXELS_PER_UNIT,
    width,
    height,
    tilesets,
    layers,
    objects: input.objects ?? [],
    properties: input.properties ?? EMPTY_PROPERTIES,
  };
}

/**
 * Resolves a global tile id to the tileset that owns it.
 *
 * @remarks
 * The owner is the tileset with the highest {@link TilesetDefinition.firstId} that is still less
 * than or equal to `tileId` — the rule Tiled's `firstgid` implies. `defineTilemap` sorts the
 * tilesets ascending, so this is a backward scan over a handful of entries.
 *
 * @param map - The parsed document.
 * @param tileId - The global tile id.
 * @returns The owning tileset, or `null` for the empty tile and for an id no tileset claims.
 *
 * @public
 */
export function findTileset(map: TilemapDefinition, tileId: number): TilesetDefinition | null {
  if (tileId <= EMPTY_TILE_ID) {
    return null;
  }
  for (let index = map.tilesets.length - 1; index >= 0; index -= 1) {
    const tileset = map.tilesets[index];
    if (tileset !== undefined && tileset.firstId <= tileId) {
      // An id past the end of the highest tileset belongs to nobody; no earlier tileset can claim
      // it either, because their ranges all end before this one begins.
      return tileId - tileset.firstId < tileset.tiles.length ? tileset : null;
    }
  }
  return null;
}

/**
 * Resolves a global tile id to the tile entry that describes it.
 *
 * @param map - The parsed document.
 * @param tileId - The global tile id.
 * @returns The tile entry, or `null` when no tileset claims the id.
 */
function findTile(map: TilemapDefinition, tileId: number): TileDefinition | null {
  const tileset = findTileset(map, tileId);
  if (tileset === null) {
    return null;
  }
  const localId = tileId - tileset.firstId;
  const byIndex = tileset.tiles[localId];
  if (byIndex !== undefined && byIndex.id === localId) {
    return byIndex;
  }
  for (let index = 0; index < tileset.tiles.length; index += 1) {
    const tile = tileset.tiles[index];
    if (tile !== undefined && tile.id === localId) {
      return tile;
    }
  }
  return null;
}

/**
 * The atlas frame a global tile id draws.
 *
 * @param map - The parsed document.
 * @param tileId - The global tile id.
 * @returns The frame name, or `null` for the empty tile and for an id no tileset claims.
 *
 * @example
 * ```ts
 * tileFrameName(map, 1); // "hero_0"
 * ```
 *
 * @public
 */
export function tileFrameName(map: TilemapDefinition, tileId: number): string | null {
  return findTile(map, tileId)?.frame ?? null;
}

/**
 * Resolves a global tile id into the collision information a physics backend consumes.
 *
 * @remarks
 * This is the only place the authoring convention becomes the runtime one. A
 * {@link TileColliderDefinition} is cell-normalised with a **top-left** origin and +Y down; a
 * {@link TileCollisionShape} is cell-local **metres** with a **bottom-left** origin, +Y up and
 * counter-clockwise winding. So:
 *
 * - a box's bottom edge is `(1 - y - height) * cellSize`, because the authored `y` measures the
 *   distance from the cell's top down to the box's *top* edge;
 * - a polygon's points each become `(x * cellSize, (1 - y) * cellSize)`, and the point **order is
 *   reversed**, because mirroring a ring about a horizontal axis flips its winding — a clockwise
 *   editor outline is counter-clockwise once flipped only if it is also walked backwards.
 *
 * @param map - The parsed document.
 * @param tileId - The global tile id, `0` for an empty cell.
 * @returns The tile's runtime collision info; a non-colliding, non-one-way default for the empty
 * tile, for an id no tileset claims, and for a tile that declares no collider.
 *
 * @example
 * ```ts
 * // A one-way platform authored as the top quarter of the cell, at cellSize 1:
 * tileCollisionInfo(map, 2).shape; // { kind: "box", x: 0, y: 0.75, width: 1, height: 0.25 }
 * ```
 *
 * @public
 */
export function tileCollisionInfo(map: TilemapDefinition, tileId: number): TileCollisionInfo {
  const tile = findTile(map, tileId);
  if (tile === null) {
    return NO_TILE_COLLISION;
  }
  const collider = tile.collider;
  const properties = tile.properties ?? EMPTY_PROPERTIES;
  if (collider === undefined) {
    return { shape: { kind: "none" }, oneWay: false, properties };
  }
  const cellSize = map.cellSize;
  switch (collider.kind) {
    case "none": {
      return { shape: { kind: "none" }, oneWay: false, properties };
    }
    case "box": {
      const shape: TileCollisionShape = {
        kind: "box",
        x: collider.x * cellSize,
        y: (1 - collider.y - collider.height) * cellSize,
        width: collider.width * cellSize,
        height: collider.height * cellSize,
      };
      return { shape, oneWay: collider.oneWay ?? false, properties };
    }
    case "polygon": {
      const points: Vec2Like[] = [];
      for (let index = collider.points.length - 1; index >= 0; index -= 1) {
        const point = collider.points[index];
        if (point === undefined) {
          continue;
        }
        points.push({ x: point.x * cellSize, y: (1 - point.y) * cellSize });
      }
      return { shape: { kind: "polygon", points }, oneWay: collider.oneWay ?? false, properties };
    }
    default: {
      return assertNever(collider, "TileColliderDefinition.kind");
    }
  }
}
