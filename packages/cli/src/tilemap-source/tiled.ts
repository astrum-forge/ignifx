import { basename, dirname, extname, resolve } from "node:path";
import { canonical, isRecord } from "../json-text.js";
import {
  gridFrames,
  propertyRecord,
  readArray,
  readNumber,
  readString,
  records,
  uniqueName,
  unsupported,
} from "./model.js";
import type { ConvertContext, ConvertedMap, ConvertedTileset, JsonObject, PropertyRecord } from "./model.js";

/**
 * Converts a Tiled JSON map (`.tmj`, https://doc.mapeditor.org/en/stable/reference/json-map-format/)
 * into an `ignifx.tilemap` document. It follows `importTiledMap` in `@ignifx/2d` and adds what a
 * file-based import can do: external `.tsj` tilesets, group layers, flip flags reported rather than
 * hidden, and the frame rectangles for a generated atlas.
 */

/** The four high bits of a Tiled global tile id: horizontal, vertical, diagonal and hexagonal flips. */
const FLIP_BITS = 0xf0000000;

/** The bits of a Tiled global tile id that are the id. */
const GID_BITS = 0x0fffffff;

/** The hint every refusal of a Tiled file ends with. */
const TILED_HINT =
  "Save it from Tiled as an orthogonal, finite map with CSV layer data and JSON (.tsj) tilesets, or import it in code with importTiledMap from @ignifx/2d.";

/**
 * Converts a parsed `.tmj` file.
 *
 * @param path - The file's absolute path; images and `.tsj` tilesets resolve against its folder.
 * @param tmj - The parsed file.
 * @param context - Pixels per unit, the flip policy, the warning sink and the JSON reader.
 * @returns The map.
 * @throws A `CliError` with code `IGX-1408` for a feature the format cannot hold.
 *
 * @internal
 */
export async function convertTiledMap(path: string, tmj: unknown, context: ConvertContext): Promise<ConvertedMap> {
  if (!isRecord(tmj) || readString(tmj, "type", "map") !== "map") {
    return unsupported(path, "is not a Tiled map", TILED_HINT);
  }
  const orientation = readString(tmj, "orientation", "orthogonal");
  if (orientation !== "orthogonal") {
    return unsupported(path, `is an ${orientation} map, and only orthogonal maps convert`, TILED_HINT);
  }
  if (tmj["infinite"] === true) {
    return unsupported(path, "is an infinite map, whose layers are chunks rather than one grid", TILED_HINT);
  }
  const tileWidth = readNumber(tmj, "tilewidth", 0);
  const tileHeight = readNumber(tmj, "tileheight", tileWidth);
  const width = readNumber(tmj, "width", 0);
  const height = readNumber(tmj, "height", 0);
  const tilesets = (
    await Promise.all(
      records(readArray(tmj, "tilesets")).map(async (raw) => readTileset(path, raw, tileWidth, tileHeight, context)),
    )
  ).toSorted((a, b) => a.firstId - b.firstId);
  const state: LayerState = {
    path,
    context,
    width,
    height,
    mapHeightPx: height * tileHeight,
    layers: [],
    objects: [],
    names: new Set<string>(),
  };
  readLayers(readArray(tmj, "layers"), "", state);
  return {
    name: basename(path, extname(path)),
    tileWidth,
    tileHeight,
    width,
    height,
    tilesets,
    layers: state.layers,
    objects: state.objects,
    properties: tiledProperties(tmj["properties"]),
  };
}

/** What walking the layer tree accumulates. */
interface LayerState {
  readonly path: string;
  readonly context: ConvertContext;
  readonly width: number;
  readonly height: number;
  readonly mapHeightPx: number;
  readonly layers: JsonObject[];
  readonly objects: JsonObject[];
  readonly names: Set<string>;
}

/**
 * Flattens Tiled's `[{ name, type, value }]` property array into a record.
 *
 * @param properties - The `properties` field.
 * @returns The record; `object` and `class` properties are dropped.
 */
function tiledProperties(properties: unknown): PropertyRecord {
  const entries = Array.isArray(properties) ? records(properties) : [];
  return propertyRecord(entries.map((entry) => [entry["name"], entry["value"]] as const));
}

/**
 * Reads one tileset entry, loading it from its `.tsj` file when it is external.
 *
 * @param path - The map file.
 * @param entry - The map's tileset entry.
 * @param tileWidth - The map's tile width, for normalising colliders.
 * @param tileHeight - The map's tile height.
 * @param context - The converter context.
 * @returns The tileset.
 */
async function readTileset(
  path: string,
  entry: JsonObject,
  tileWidth: number,
  tileHeight: number,
  context: ConvertContext,
): Promise<ConvertedTileset> {
  const firstId = readNumber(entry, "firstgid", 1);
  const source = entry["source"];
  let raw = entry;
  let folder = dirname(path);
  if (typeof source === "string") {
    if (extname(source).toLowerCase() !== ".tsj" && extname(source).toLowerCase() !== ".json") {
      return unsupported(path, `uses the tileset "${source}", which is not a JSON (.tsj) tileset`, TILED_HINT);
    }
    const tsjPath = resolve(folder, source);
    const loaded = await context.readJson(tsjPath);
    if (!isRecord(loaded)) {
      return unsupported(tsjPath, "is not a Tiled tileset", TILED_HINT);
    }
    raw = loaded;
    folder = dirname(tsjPath);
  }
  const name = readString(raw, "name", `tileset${String(firstId)}`);
  const image = readString(raw, "image", "");
  if (image === "") {
    return unsupported(
      path,
      `uses the tileset "${name}", which is a collection of images rather than one image`,
      "Pack the images into one tileset image in Tiled, or build the atlas yourself.",
    );
  }
  const count = readNumber(raw, "tilecount", 0);
  const cell = { w: readNumber(raw, "tilewidth", tileWidth), h: readNumber(raw, "tileheight", tileHeight) };
  const overrides = new Map<number, JsonObject>();
  for (const tile of records(readArray(raw, "tiles"))) {
    overrides.set(readNumber(tile, "id", -1), tile);
  }
  const tiles: JsonObject[] = [];
  for (let localId = 0; localId < count; localId += 1) {
    tiles.push(readTile(overrides.get(localId), localId, name, tileWidth, tileHeight));
  }
  return {
    name,
    image: resolve(folder, image),
    firstId,
    tiles,
    frames: gridFrames(
      name,
      count,
      readNumber(raw, "columns", 1),
      cell,
      readNumber(raw, "margin", 0),
      readNumber(raw, "spacing", 0),
    ),
  };
}

/**
 * Reads one tile of a tileset: its frame, collider, properties and animation.
 *
 * @param entry - The tile's `tiles[]` entry, when it has one.
 * @param localId - The tile's index in its tileset.
 * @param tilesetName - The frame-name prefix.
 * @param tileWidth - The map's tile width.
 * @param tileHeight - The map's tile height.
 * @returns The tile in the tilemap format.
 */
function readTile(
  entry: JsonObject | undefined,
  localId: number,
  tilesetName: string,
  tileWidth: number,
  tileHeight: number,
): JsonObject {
  const frame = `${tilesetName}_${String(localId)}`;
  if (entry === undefined) {
    return { id: localId, frame };
  }
  const properties = tiledProperties(entry["properties"]);
  const collider = readCollider(entry["objectgroup"], tileWidth, tileHeight, properties["oneWay"] === true);
  const animation = records(readArray(entry, "animation")).map((step) => ({
    frame: `${tilesetName}_${String(readNumber(step, "tileid", 0))}`,
    durationMs: readNumber(step, "duration", 0),
  }));
  return {
    id: localId,
    frame,
    ...(collider === null ? {} : { collider }),
    ...(Object.keys(properties).length === 0 ? {} : { properties }),
    ...(animation.length === 0 ? {} : { animation }),
  };
}

/**
 * Turns a tile's first collision shape into a cell-normalised collider, top-left origin.
 *
 * @param objectGroup - The tile's `objectgroup`.
 * @param tileWidth - The map's tile width.
 * @param tileHeight - The map's tile height.
 * @param oneWay - Whether the tile's `oneWay` property is set.
 * @returns The collider, or `null` for none.
 */
function readCollider(objectGroup: unknown, tileWidth: number, tileHeight: number, oneWay: boolean): JsonObject | null {
  const shapes = isRecord(objectGroup) ? records(readArray(objectGroup, "objects")) : [];
  const flag = oneWay ? { oneWay: true } : {};
  for (const shape of shapes) {
    const originX = readNumber(shape, "x", 0);
    const originY = readNumber(shape, "y", 0);
    const polygon = shape["polygon"];
    if (Array.isArray(polygon)) {
      const points = records(polygon).map((point) => ({
        x: canonical((originX + readNumber(point, "x", 0)) / tileWidth),
        y: canonical((originY + readNumber(point, "y", 0)) / tileHeight),
      }));
      if (points.length >= 3) {
        return { kind: "polygon", points, ...flag };
      }
      continue;
    }
    const shapeWidth = readNumber(shape, "width", 0);
    const shapeHeight = readNumber(shape, "height", 0);
    if (shapeWidth > 0 && shapeHeight > 0) {
      return {
        kind: "box",
        x: canonical(originX / tileWidth),
        y: canonical(originY / tileHeight),
        width: canonical(shapeWidth / tileWidth),
        height: canonical(shapeHeight / tileHeight),
        ...flag,
      };
    }
  }
  // A one-way tile drawn with no shape is still meant to be a platform: the whole cell.
  return oneWay ? { kind: "box", x: 0, y: 0, width: 1, height: 1, oneWay: true } : null;
}

/**
 * Walks a layer list, descending into group layers, and appends tile layers and objects.
 *
 * @param layers - The `layers` array.
 * @param prefix - The enclosing groups' names, joined with `/`.
 * @param state - The accumulator.
 */
function readLayers(layers: readonly unknown[], prefix: string, state: LayerState): void {
  for (const raw of records(layers)) {
    const type = readString(raw, "type", "");
    const name = prefix + readString(raw, "name", `Layer ${String(state.layers.length)}`);
    if (type === "group") {
      readLayers(readArray(raw, "layers"), `${name}/`, state);
    } else if (type === "tilelayer") {
      state.layers.push(readTileLayer(raw, uniqueName(name, state.names), state));
    } else if (type === "objectgroup") {
      readObjectLayer(raw, state);
    } else {
      state.context.warn(`Skipped the layer "${name}" (${type}): a tilemap holds tile layers and objects only.`);
    }
  }
}

/**
 * Reads one tile layer.
 *
 * @param raw - The layer.
 * @param name - Its unique name.
 * @param state - The accumulator.
 * @returns The layer in the tilemap format.
 */
function readTileLayer(raw: JsonObject, name: string, state: LayerState): JsonObject {
  const data = raw["data"];
  if (typeof data === "string") {
    return unsupported(
      state.path,
      `stores layer "${name}" as ${readString(raw, "encoding", "base64")} data`,
      TILED_HINT,
    );
  }
  if (!Array.isArray(data)) {
    return unsupported(state.path, `has no tile data in layer "${name}"`, TILED_HINT);
  }
  if (readNumber(raw, "offsetx", 0) !== 0 || readNumber(raw, "offsety", 0) !== 0) {
    state.context.warn(`Layer "${name}" has a pixel offset, which a tilemap layer does not keep.`);
  }
  let flipped = 0;
  const tiles = data.map((value: unknown): number => {
    if (typeof value !== "number") {
      return 0;
    }
    // `>>> 0` reads the 32-bit id as unsigned, so the flag test works on ids above 2^31.
    if (((value >>> 0) & FLIP_BITS) !== 0) {
      flipped += 1;
    }
    return value & GID_BITS;
  });
  if (flipped > 0) {
    if (!state.context.dropFlips) {
      return unsupported(
        state.path,
        `has ${String(flipped)} flipped or rotated tile(s) in layer "${name}", and a tilemap cell has no flip`,
        "Draw those tiles unflipped in Tiled, or pass --drop-flips to import them unflipped.",
      );
    }
    state.context.warn(`Layer "${name}": ${String(flipped)} flipped or rotated tile(s) imported unflipped.`);
  }
  const properties = tiledProperties(raw["properties"]);
  const sortingLayer = properties["sortingLayer"];
  const orderInLayer = properties["orderInLayer"];
  return {
    name,
    sortingLayer: typeof sortingLayer === "string" ? sortingLayer : "Default",
    orderInLayer: typeof orderInLayer === "number" ? orderInLayer : state.layers.length,
    opacity: readNumber(raw, "opacity", 1),
    parallax: { x: readNumber(raw, "parallaxx", 1), y: readNumber(raw, "parallaxy", 1) },
    collision: properties["collision"] === true,
    width: readNumber(raw, "width", state.width),
    height: readNumber(raw, "height", state.height),
    tiles,
  };
}

/**
 * Reads one object layer into the map's object list, converting from Tiled's top-left pixels to
 * metres with +Y up and `y` at the bottom edge.
 *
 * @param raw - The layer.
 * @param state - The accumulator.
 */
function readObjectLayer(raw: JsonObject, state: LayerState): void {
  const ppu = state.context.pixelsPerUnit;
  for (const object of records(readArray(raw, "objects"))) {
    const objectHeight = readNumber(object, "height", 0);
    // A tile object's `y` is its bottom edge; every other object's is its top.
    const top = readNumber(object, "y", 0) - (typeof object["gid"] === "number" ? objectHeight : 0);
    state.objects.push({
      name: readString(object, "name", ""),
      // Tiled 1.9 renamed the object's `type` to `class`; both spellings are in the wild.
      type: readString(object, "type", readString(object, "class", "")),
      x: canonical(readNumber(object, "x", 0) / ppu),
      y: canonical((state.mapHeightPx - top - objectHeight) / ppu),
      width: canonical(readNumber(object, "width", 0) / ppu),
      height: canonical(objectHeight / ppu),
      properties: tiledProperties(object["properties"]),
    });
  }
}
