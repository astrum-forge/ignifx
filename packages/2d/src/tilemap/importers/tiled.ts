import { twoDError, TwoDErrorCode } from "../../errors.js";
import { DEFAULT_PIXELS_PER_UNIT } from "../../math/coords.js";
import { defineTilemap } from "../definition.js";
import type {
  TileAnimationFrame,
  TileColliderDefinition,
  TileDefinition,
  TilemapDefinition,
  TilemapLayerInput,
  TilemapObjectDefinition,
  TilesetDefinition,
} from "../definition.js";

/**
 * The **Tiled** importer: turns a `.tmj` (Tiled's JSON map format) into an `ignifx.tilemap`
 * document (`docs/architecture/11-2d-toolkit.md` §2.5).
 *
 * It is a pure function over already-parsed JSON — no file system, no network, no asset system — so
 * it runs identically in the Vite plugin, in a CLI importer and in a test. Orthogonal maps only;
 * isometric and hexagonal are post-MVP and are rejected rather than silently mangled.
 */

/** The three high bits Tiled packs the horizontal, vertical and diagonal flip flags into. */
const TILED_GID_MASK = 0x1fffffff;

/** The name reported in `IGX-1109` context so a developer knows which importer complained. */
const IMPORTER_NAME = "tiled";

/**
 * How {@link importTiledMap} maps Tiled's conventions onto ignifx's.
 *
 * @public
 */
export interface TiledImportOptions {
  /** The pixels one world metre spans. Defaults to `100`, matching `twoD.pixelsPerUnit`. */
  readonly pixelsPerUnit?: number;
  /** The sorting layer every tile layer lands in unless it says otherwise. Defaults to `"Default"`. */
  readonly sortingLayer?: string;
  /**
   * Maps a Tiled tileset's `image` path onto the address of the ignifx `.atlas.json` that was
   * generated from it. Defaults to swapping the file extension for `.atlas.json`.
   */
  readonly atlasFor?: (imageSource: string) => string;
}

/**
 * Flattens Tiled's `[{ name, type, value }]` property arrays into a plain record.
 *
 * @remarks
 * Only `string`, `number` and `boolean` values survive; Tiled's `object` and `class` property types
 * carry editor-side references that mean nothing at runtime, and are dropped rather than stringified
 * into something that looks meaningful but is not. `color` and `file` properties are strings in the
 * JSON and come through as strings.
 *
 * @param properties - The value of a Tiled `properties` field, or anything else.
 * @returns The flattened record; empty when `properties` is not a Tiled property array.
 *
 * @example
 * ```ts
 * tiledPropertiesToRecord([{ name: "biome", type: "string", value: "cave" }]); // { biome: "cave" }
 * ```
 *
 * @public
 */
export function tiledPropertiesToRecord(properties: unknown): Readonly<Record<string, string | number | boolean>> {
  if (!isUnknownArray(properties)) {
    return {};
  }
  const out: Record<string, string | number | boolean> = {};
  for (let index = 0; index < properties.length; index += 1) {
    const entry = properties[index];
    if (!isRecord(entry)) {
      continue;
    }
    const name = entry["name"];
    const value = entry["value"];
    if (typeof name !== "string" || name === "") {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Imports a Tiled JSON map.
 *
 * @remarks
 * Three Tiled features are rejected outright with `IGX-1109` rather than approximated: a non
 * orthogonal `orientation`, an `infinite` map (whose layers are chunked rather than dense), and
 * base64/compressed layer `data` (which arrives as a string). Everything else degrades quietly —
 * image layers and group layers are skipped, and unknown properties are carried through.
 *
 * Tiled stores the horizontal, vertical and diagonal flip flags in the top three bits of every
 * global tile id. ignifx has no per-cell flip yet, so those bits are **masked off** and the tile
 * draws unflipped; without the mask a flipped tile would resolve to a nonsensical tileset.
 *
 * The frame names this importer emits are `<tilesetName>_<localTileIndex>` — the same names
 * the grid-atlas generator gives the frames it cuts out of the tileset image, which is the contract
 * that lets `TilemapRenderer` look a tile's sprite up without a side table.
 *
 * @param tmj - The parsed `.tmj` document.
 * @param options - Pixels-per-unit, the default sorting layer, and the atlas address mapping.
 * @returns The `ignifx.tilemap` document.
 * @throws IgnifxError with code `IGX-1109` when the document is not an orthogonal, finite,
 * uncompressed Tiled map, and `IGX-1105` when what it decodes to is not a valid tilemap.
 *
 * @example
 * ```ts
 * const map = importTiledMap(JSON.parse(await readFile("cave.tmj", "utf8")), { pixelsPerUnit: 32 });
 * ```
 *
 * @public
 */
export function importTiledMap(tmj: unknown, options: TiledImportOptions = {}): TilemapDefinition {
  const fail = (reason: string): never => {
    throw twoDError(TwoDErrorCode.unsupportedImport, `The Tiled importer cannot read this document: ${reason}.`, {
      context: { importer: IMPORTER_NAME, reason },
      hint: "Re-export the map from Tiled as an orthogonal, finite map with uncompressed CSV layer data.",
    });
  };
  if (!isRecord(tmj)) {
    return fail("it is not a JSON object");
  }
  const orientation = readString(tmj, "orientation", "orthogonal");
  if (orientation !== "orthogonal") {
    return fail(`its orientation is ${orientation}, and only orthogonal maps are supported`);
  }
  if (tmj["infinite"] === true) {
    return fail("it is an infinite map, whose layers are stored as chunks rather than a dense grid");
  }

  const pixelsPerUnit = options.pixelsPerUnit ?? DEFAULT_PIXELS_PER_UNIT;
  const defaultSortingLayer = options.sortingLayer ?? "Default";
  const atlasFor = options.atlasFor ?? defaultAtlasFor;
  const tileWidth = readNumber(tmj, "tilewidth", 0);
  const tileHeight = readNumber(tmj, "tileheight", tileWidth);
  const width = readNumber(tmj, "width", 0);
  const height = readNumber(tmj, "height", 0);
  const mapHeightPx = height * tileHeight;

  const tilesets: TilesetDefinition[] = [];
  const rawTilesets = readArray(tmj, "tilesets");
  for (let index = 0; index < rawTilesets.length; index += 1) {
    const raw = rawTilesets[index];
    if (!isRecord(raw)) {
      continue;
    }
    if (typeof raw["source"] === "string") {
      return fail(`tileset ${String(index)} is an external .tsx reference, which this importer cannot resolve`);
    }
    tilesets.push(readTileset(raw, index, tileWidth, tileHeight, atlasFor));
  }

  const layers: TilemapLayerInput[] = [];
  const objects: TilemapObjectDefinition[] = [];
  const rawLayers = readArray(tmj, "layers");
  for (let index = 0; index < rawLayers.length; index += 1) {
    const raw = rawLayers[index];
    if (!isRecord(raw)) {
      continue;
    }
    const type = readString(raw, "type", "");
    if (type === "tilelayer") {
      layers.push(readTileLayer(raw, layers.length, width, height, defaultSortingLayer, fail));
      continue;
    }
    if (type === "objectgroup") {
      readObjectLayer(raw, mapHeightPx, pixelsPerUnit, objects);
    }
    // Image layers and group layers carry nothing the tilemap format models; skipping them is
    // friendlier than refusing a map that merely has a reference image pinned to it.
  }

  return defineTilemap(
    {
      tileWidth,
      tileHeight,
      cellSize: tileWidth / pixelsPerUnit,
      width,
      height,
      tilesets,
      layers,
      objects,
      properties: tiledPropertiesToRecord(tmj["properties"]),
    },
    "<tiled>",
  );
}

/**
 * Swaps a file extension for `.atlas.json`, the default {@link TiledImportOptions.atlasFor}.
 *
 * @param imageSource - The image path the editor recorded.
 * @returns The atlas address.
 */
function defaultAtlasFor(imageSource: string): string {
  const slash = Math.max(imageSource.lastIndexOf("/"), imageSource.lastIndexOf("\\"));
  const dot = imageSource.lastIndexOf(".");
  return dot > slash ? `${imageSource.slice(0, dot)}.atlas.json` : `${imageSource}.atlas.json`;
}

/**
 * Reads one embedded Tiled tileset.
 *
 * @param raw - The tileset object.
 * @param index - Its position in the `tilesets` array, used to name an unnamed tileset.
 * @param tileWidth - The map's tile width in pixels, for normalising colliders.
 * @param tileHeight - The map's tile height in pixels, for normalising colliders.
 * @param atlasFor - The image-to-atlas address mapping.
 * @returns The tileset definition.
 */
function readTileset(
  raw: Readonly<Record<string, unknown>>,
  index: number,
  tileWidth: number,
  tileHeight: number,
  atlasFor: (imageSource: string) => string,
): TilesetDefinition {
  const name = readString(raw, "name", `tileset${String(index)}`);
  const image = readString(raw, "image", "");
  const tileCount = readNumber(raw, "tilecount", 0);
  const overrides = new Map<number, Readonly<Record<string, unknown>>>();
  const rawTiles = readArray(raw, "tiles");
  for (let tileIndex = 0; tileIndex < rawTiles.length; tileIndex += 1) {
    const entry = rawTiles[tileIndex];
    if (isRecord(entry)) {
      overrides.set(readNumber(entry, "id", -1), entry);
    }
  }
  const tiles: TileDefinition[] = [];
  for (let localId = 0; localId < tileCount; localId += 1) {
    tiles.push(readTile(overrides.get(localId), localId, name, tileWidth, tileHeight));
  }
  return { name, atlas: atlasFor(image), firstId: readNumber(raw, "firstgid", 1), tiles };
}

/**
 * Reads one tile of a Tiled tileset, filling in the parts Tiled only writes when they are not empty.
 *
 * @param entry - The `tiles[]` override for this local id, when there is one.
 * @param localId - The tile's index within its tileset.
 * @param tilesetName - The frame-name prefix.
 * @param tileWidth - The map's tile width in pixels.
 * @param tileHeight - The map's tile height in pixels.
 * @returns The tile definition.
 */
function readTile(
  entry: Readonly<Record<string, unknown>> | undefined,
  localId: number,
  tilesetName: string,
  tileWidth: number,
  tileHeight: number,
): TileDefinition {
  const frame = `${tilesetName}_${String(localId)}`;
  if (entry === undefined) {
    return { id: localId, frame };
  }
  const properties = tiledPropertiesToRecord(entry["properties"]);
  const oneWay = properties["oneWay"] === true;
  const collider = readCollider(entry["objectgroup"], tileWidth, tileHeight, oneWay);
  const animation = readAnimation(entry["animation"], tilesetName);
  return {
    id: localId,
    frame,
    ...(collider === null ? {} : { collider }),
    ...(Object.keys(properties).length === 0 ? {} : { properties }),
    ...(animation === null ? {} : { animation }),
  };
}

/**
 * Turns a per-tile `objectgroup` into a cell-normalised collider.
 *
 * @remarks
 * Tiled lets an artist draw any number of shapes on a tile; the tilemap format models one, so the
 * first shape wins. A shape with a `polygon` array becomes a polygon collider (its points are
 * relative to the object's own origin, so the object position is added back in); anything else with
 * a positive size becomes a box. Both stay in the editor's top-left-origin normalised space —
 * `tileCollisionInfo` performs the flip into metres.
 *
 * @param objectGroup - The tile's `objectgroup` field.
 * @param tileWidth - The map's tile width in pixels.
 * @param tileHeight - The map's tile height in pixels.
 * @param oneWay - Whether the tile's `oneWay` property is set.
 * @returns The collider, or `null` when the tile declares none and is not a bare one-way tile.
 */
function readCollider(
  objectGroup: unknown,
  tileWidth: number,
  tileHeight: number,
  oneWay: boolean,
): TileColliderDefinition | null {
  const group = isRecord(objectGroup) ? objectGroup : null;
  const shapes = group === null ? [] : readArray(group, "objects");
  for (let index = 0; index < shapes.length; index += 1) {
    const shape = shapes[index];
    if (!isRecord(shape)) {
      continue;
    }
    const originX = readNumber(shape, "x", 0);
    const originY = readNumber(shape, "y", 0);
    const polygon = shape["polygon"];
    if (isUnknownArray(polygon)) {
      const points: { readonly x: number; readonly y: number }[] = [];
      for (let pointIndex = 0; pointIndex < polygon.length; pointIndex += 1) {
        const point = polygon[pointIndex];
        if (isRecord(point)) {
          points.push({
            x: (originX + readNumber(point, "x", 0)) / tileWidth,
            y: (originY + readNumber(point, "y", 0)) / tileHeight,
          });
        }
      }
      if (points.length >= 3) {
        return { kind: "polygon", points, ...(oneWay ? { oneWay: true } : {}) };
      }
      continue;
    }
    const shapeWidth = readNumber(shape, "width", 0);
    const shapeHeight = readNumber(shape, "height", 0);
    if (shapeWidth > 0 && shapeHeight > 0) {
      return {
        kind: "box",
        x: originX / tileWidth,
        y: originY / tileHeight,
        width: shapeWidth / tileWidth,
        height: shapeHeight / tileHeight,
        ...(oneWay ? { oneWay: true } : {}),
      };
    }
  }
  // A tile marked one-way but drawn with no shape is still meant to be a platform; giving it the
  // whole cell is the only reading that does what the author asked.
  return oneWay ? { kind: "box", x: 0, y: 0, width: 1, height: 1, oneWay: true } : null;
}

/**
 * Turns Tiled's `[{ tileid, duration }]` animation into {@link TileAnimationFrame}s.
 *
 * @param animation - The tile's `animation` field.
 * @param tilesetName - The frame-name prefix.
 * @returns The frames, or `null` when the tile does not animate.
 */
function readAnimation(animation: unknown, tilesetName: string): readonly TileAnimationFrame[] | null {
  if (!isUnknownArray(animation) || animation.length === 0) {
    return null;
  }
  const frames: TileAnimationFrame[] = [];
  for (let index = 0; index < animation.length; index += 1) {
    const step = animation[index];
    if (!isRecord(step)) {
      continue;
    }
    frames.push({
      frame: `${tilesetName}_${String(readNumber(step, "tileid", 0))}`,
      durationMs: readNumber(step, "duration", 0),
    });
  }
  return frames.length === 0 ? null : frames;
}

/**
 * Reads one Tiled tile layer.
 *
 * @param raw - The layer object.
 * @param order - The layer's position among the emitted layers, used as the default draw order.
 * @param mapWidth - The map's width in cells.
 * @param mapHeight - The map's height in cells.
 * @param defaultSortingLayer - The sorting layer to use when the layer names none.
 * @param fail - The `IGX-1109` thrower.
 * @returns The layer input.
 */
function readTileLayer(
  raw: Readonly<Record<string, unknown>>,
  order: number,
  mapWidth: number,
  mapHeight: number,
  defaultSortingLayer: string,
  fail: (reason: string) => never,
): TilemapLayerInput {
  const name = readString(raw, "name", `Layer ${String(order)}`);
  const data = raw["data"];
  if (typeof data === "string") {
    fail(
      `layer ${name} stores its data as a string, and compressed layer data is not supported; export uncompressed CSV/array data`,
    );
  }
  if (!isUnknownArray(data)) {
    return fail(`layer ${name} has no tile data array`);
  }
  const tiles: number[] = [];
  for (let index = 0; index < data.length; index += 1) {
    const gid = data[index];
    tiles.push(typeof gid === "number" ? gid & TILED_GID_MASK : 0);
  }
  const properties = tiledPropertiesToRecord(raw["properties"]);
  const sortingLayer = properties["sortingLayer"];
  const orderInLayer = properties["orderInLayer"];
  return {
    name,
    sortingLayer: typeof sortingLayer === "string" ? sortingLayer : defaultSortingLayer,
    orderInLayer: typeof orderInLayer === "number" ? orderInLayer : order,
    opacity: readNumber(raw, "opacity", 1),
    parallax: { x: readNumber(raw, "parallaxx", 1), y: readNumber(raw, "parallaxy", 1) },
    collision: properties["collision"] === true,
    width: readNumber(raw, "width", mapWidth),
    height: readNumber(raw, "height", mapHeight),
    tiles,
  };
}

/**
 * Reads one Tiled object layer, appending its objects to the map's flat object list.
 *
 * @remarks
 * Tiled measures an object rectangle from the **map's top-left** in pixels, with `y` at the
 * rectangle's top. ignifx wants world metres with +Y up and `y` at the bottom, so the conversion is
 * `xM = x / ppu` and `yM = (mapHeightPx - y - height) / ppu`.
 *
 * @param raw - The layer object.
 * @param mapHeightPx - The map's height in pixels.
 * @param pixelsPerUnit - The pixels one world metre spans.
 * @param out - The object list to append to.
 */
function readObjectLayer(
  raw: Readonly<Record<string, unknown>>,
  mapHeightPx: number,
  pixelsPerUnit: number,
  out: TilemapObjectDefinition[],
): void {
  const objects = readArray(raw, "objects");
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    if (!isRecord(object)) {
      continue;
    }
    const objectHeight = readNumber(object, "height", 0);
    out.push({
      name: readString(object, "name", ""),
      // Tiled 1.9 renamed the object's `type` field to `class`; both spellings are in the wild.
      type: readString(object, "type", readString(object, "class", "")),
      x: readNumber(object, "x", 0) / pixelsPerUnit,
      y: (mapHeightPx - readNumber(object, "y", 0) - objectHeight) / pixelsPerUnit,
      width: readNumber(object, "width", 0) / pixelsPerUnit,
      height: objectHeight / pixelsPerUnit,
      properties: tiledPropertiesToRecord(object["properties"]),
    });
  }
}

/**
 * Narrows an unknown JSON value to a plain object.
 *
 * @param value - The parsed JSON value.
 * @returns Whether it is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows an unknown JSON value to an array without widening its elements to `any`.
 *
 * @param value - The parsed JSON value.
 * @returns Whether it is an array.
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Reads a numeric field.
 *
 * @param source - The object to read from.
 * @param key - The field name.
 * @param fallback - What to return when the field is missing or not a finite number.
 * @returns The number.
 */
function readNumber(source: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Reads a string field.
 *
 * @param source - The object to read from.
 * @param key - The field name.
 * @param fallback - What to return when the field is missing or not a string.
 * @returns The string.
 */
function readString(source: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads an array field.
 *
 * @param source - The object to read from.
 * @param key - The field name.
 * @returns The array, or an empty one when the field is missing or not an array.
 */
function readArray(source: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const value = source[key];
  return isUnknownArray(value) ? value : [];
}
