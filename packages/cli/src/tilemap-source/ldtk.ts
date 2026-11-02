import { dirname, resolve } from "node:path";
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
 * Converts an LDtk project (`.ldtk`, https://ldtk.io/json/) into one `ignifx.tilemap` document per
 * level. It follows `importLdtkLevel` in `@ignifx/2d` and adds what a file-based import can do:
 * every level at once, external `.ldtkl` levels, `AutoLayer` and auto-tiled `IntGrid` tiles, flip
 * flags reported rather than hidden, and the frame rectangles for a generated atlas.
 */

/** The name of the collision-only tileset IntGrid values become. */
const INTGRID_TILESET = "intgrid";

/** The suffix of the art layer an auto-tiled IntGrid layer adds; LDtk identifiers have no dots. */
const AUTO_TILES_SUFFIX = ".tiles";

/** What IntGrid values `1` and `2` collide as, matching `LDTK_DEFAULT_INTGRID_COLLIDERS` in `@ignifx/2d`. */
const INTGRID_COLLIDERS: Readonly<Record<number, JsonObject>> = {
  1: { kind: "box", x: 0, y: 0, width: 1, height: 1 },
  2: { kind: "box", x: 0, y: 0, width: 1, height: 0.25, oneWay: true },
};

/** The fallback grid size LDtk itself uses. */
const LDTK_DEFAULT_GRID = 16;

/** The hint every refusal of an LDtk file ends with. */
const LDTK_HINT = "Save it from LDtk 1.5 or later, or import the level in code with importLdtkLevel from @ignifx/2d.";

/**
 * Converts a parsed `.ldtk` project.
 *
 * @param path - The file's absolute path; images and external levels resolve against its folder.
 * @param ldtk - The parsed project.
 * @param context - Pixels per unit, the flip policy, the warning sink and the JSON reader.
 * @returns One map per level, in the project's order.
 * @throws A `CliError` with code `IGX-1408` for a feature the format cannot hold.
 *
 * @internal
 */
export async function convertLdtkProject(
  path: string,
  ldtk: unknown,
  context: ConvertContext,
): Promise<ConvertedMap[]> {
  if (!isRecord(ldtk) || !isRecord(ldtk["defs"])) {
    return unsupported(path, "is not an LDtk project", LDTK_HINT);
  }
  const defs = ldtk["defs"];
  const folder = dirname(path);
  const levels = [
    ...records(readArray(ldtk, "levels")),
    ...records(readArray(ldtk, "worlds")).flatMap((world) => records(readArray(world, "levels"))),
  ];
  if (levels.length === 0) {
    return unsupported(path, "has no levels", LDTK_HINT);
  }
  const tilesets: ConvertedTileset[] = [];
  const tilesetsByUid = new Map<number, ConvertedTileset>();
  let nextFirstId = 1;
  for (const raw of records(readArray(defs, "tilesets"))) {
    const relPath = readString(raw, "relPath", "");
    if (relPath === "") {
      // LDtk's embedded icon atlas has no image file; a layer that uses it is refused below.
      continue;
    }
    const tileset = readTileset(raw, resolve(folder, relPath), nextFirstId);
    nextFirstId += tileset.tiles.length;
    tilesets.push(tileset);
    tilesetsByUid.set(readNumber(raw, "uid", -1), tileset);
  }
  const project: Project = {
    path,
    context,
    layerDefs: records(readArray(defs, "layers")),
    tilesets,
    tilesetsByUid,
    nextFirstId,
    defaultGrid: readNumber(ldtk, "defaultGridSize", LDTK_DEFAULT_GRID),
  };
  const loaded = await Promise.all(levels.map(async (level) => loadLevel(level, folder, context)));
  return loaded.map((level) => convertLevel(level, project));
}

/** The project-wide data every level reads. */
interface Project {
  readonly path: string;
  readonly context: ConvertContext;
  readonly layerDefs: readonly JsonObject[];
  readonly tilesets: readonly ConvertedTileset[];
  readonly tilesetsByUid: ReadonlyMap<number, ConvertedTileset>;
  readonly nextFirstId: number;
  readonly defaultGrid: number;
}

/**
 * Returns a level with its layers, reading its `.ldtkl` file when the project saves levels apart.
 *
 * @param level - The project's level entry.
 * @param folder - The project's folder.
 * @param context - The converter context.
 * @returns The level with `layerInstances`.
 */
async function loadLevel(level: JsonObject, folder: string, context: ConvertContext): Promise<JsonObject> {
  const external = readString(level, "externalRelPath", "");
  if (Array.isArray(level["layerInstances"]) || external === "") {
    return level;
  }
  const loaded = await context.readJson(resolve(folder, external));
  return isRecord(loaded) ? loaded : level;
}

/**
 * Reads one tileset definition.
 *
 * @param raw - The definition.
 * @param image - The image's absolute path.
 * @param firstId - The global id of its tile `0`.
 * @returns The tileset.
 */
function readTileset(raw: JsonObject, image: string, firstId: number): ConvertedTileset {
  const name = readString(raw, "identifier", `tileset${String(firstId)}`);
  const grid = Math.max(1, readNumber(raw, "tileGridSize", LDTK_DEFAULT_GRID));
  const spacing = readNumber(raw, "spacing", 0);
  const padding = readNumber(raw, "padding", 0);
  const columns = readNumber(
    raw,
    "__cWid",
    Math.floor((readNumber(raw, "pxWid", 0) - 2 * padding + spacing) / (grid + spacing)),
  );
  const rows = readNumber(
    raw,
    "__cHei",
    Math.floor((readNumber(raw, "pxHei", 0) - 2 * padding + spacing) / (grid + spacing)),
  );
  const solid = new Set<number>();
  for (const entry of records(readArray(raw, "customData"))) {
    if (isSolid(entry["data"])) {
      solid.add(readNumber(entry, "tileId", -1));
    }
  }
  const count = Math.max(0, columns * rows);
  const tiles: JsonObject[] = [];
  for (let localId = 0; localId < count; localId += 1) {
    const frame = `${name}_${String(localId)}`;
    tiles.push(solid.has(localId) ? { id: localId, frame, collider: INTGRID_COLLIDERS[1] } : { id: localId, frame });
  }
  return {
    name,
    image,
    firstId,
    tiles,
    frames: gridFrames(name, count, columns, { w: grid, h: grid }, padding, spacing),
  };
}

/**
 * Whether a tile's custom data is the JSON `{"solid": true}`.
 *
 * @param data - The custom data string.
 * @returns `true` for a solid tile.
 */
function isSolid(data: unknown): boolean {
  if (typeof data !== "string" || data === "") {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) && parsed["solid"] === true;
  } catch {
    // Custom data is free text; not JSON means no collider.
    return false;
  }
}

/**
 * Converts one level.
 *
 * @param level - The level, with its layers.
 * @param project - The project data.
 * @returns The map.
 */
function convertLevel(level: JsonObject, project: Project): ConvertedMap {
  const identifier = readString(level, "identifier", "level");
  const where = `level "${identifier}"`;
  // LDtk lists layers front to back; a tilemap draws index 0 first.
  const instances = records(readArray(level, "layerInstances")).toReversed();
  const grid =
    instances.map((instance) => readNumber(instance, "__gridSize", 0)).find((size) => size > 0) ?? project.defaultGrid;
  const levelHeightPx = readNumber(level, "pxHei", 0);
  const width = Math.max(1, Math.round(readNumber(level, "pxWid", 0) / grid));
  const height = Math.max(1, Math.round(levelHeightPx / grid));
  let maxIntGrid = 0;
  for (const instance of instances) {
    if (readString(instance, "__type", "") === "IntGrid") {
      for (const value of readArray(instance, "intGridCsv")) {
        maxIntGrid = typeof value === "number" && value > maxIntGrid ? value : maxIntGrid;
      }
    }
  }
  const intGrid = maxIntGrid > 0 ? intGridTileset(maxIntGrid, project.nextFirstId) : null;
  const layers: JsonObject[] = [];
  const objects: JsonObject[] = [];
  const names = new Set<string>();
  for (const instance of instances) {
    const type = readString(instance, "__type", "");
    const name = readString(instance, "__identifier", `Layer ${String(layers.length)}`);
    if (type === "Entities") {
      readEntities(instance, levelHeightPx, project.context.pixelsPerUnit, objects);
      continue;
    }
    if (type !== "IntGrid" && type !== "Tiles" && type !== "AutoLayer") {
      return unsupported(project.path, `has the ${type} layer "${name}" in ${where}`, LDTK_HINT);
    }
    const layerGrid = readNumber(instance, "__gridSize", grid);
    if (layerGrid !== grid) {
      return unsupported(
        project.path,
        `has the layer "${name}" on a ${String(layerGrid)} px grid in ${where}, whose other layers use ${String(grid)} px`,
        "Give every layer of a level the same grid size in LDtk.",
      );
    }
    const columns = Math.max(0, readNumber(instance, "__cWid", 0));
    const rows = Math.max(0, readNumber(instance, "__cHei", 0));
    const layer = (layerName: string, collision: boolean, tiles: readonly number[]): JsonObject => ({
      name: uniqueName(layerName, names),
      sortingLayer: "Default",
      orderInLayer: layers.length,
      opacity: readNumber(instance, "__opacity", 1),
      parallax: readParallax(project.layerDefs, readNumber(instance, "layerDefUid", -1)),
      collision,
      width: columns,
      height: rows,
      tiles,
    });
    const art = type === "Tiles" ? readArray(instance, "gridTiles") : readArray(instance, "autoLayerTiles");
    if (
      art.length === 0 &&
      type !== "IntGrid" &&
      !project.tilesetsByUid.has(readNumber(instance, "__tilesetDefUid", -1))
    ) {
      project.context.warn(`Skipped the empty layer "${name}" in ${where}: it has no tiles and no tileset.`);
    } else if (art.length > 0 || type !== "IntGrid") {
      const tileset = layerTileset(instance, project, `layer "${name}" in ${where}`);
      const tiles = placeTiles(records(art), instance, tileset.firstId, project, `layer "${name}" in ${where}`);
      const artName = type === "IntGrid" ? `${name}${AUTO_TILES_SUFFIX}` : name;
      layers.push(layer(artName, false, tiles));
    }
    if (type === "IntGrid" && intGrid !== null) {
      const csv = readArray(instance, "intGridCsv");
      const tiles = Array.from({ length: columns * rows }, (_, index): number => {
        const value = csv[index];
        return typeof value === "number" && value > 0 ? intGrid.firstId + value - 1 : 0;
      });
      layers.push(layer(name, true, tiles));
    }
  }
  return {
    name: identifier,
    tileWidth: grid,
    tileHeight: grid,
    width,
    height,
    tilesets: intGrid === null ? project.tilesets : [...project.tilesets, intGrid],
    layers,
    objects,
    properties: fieldRecord(level["fieldInstances"]),
  };
}

/**
 * The collision-only tileset IntGrid values `1..max` map onto.
 *
 * @param max - The largest value any IntGrid layer of the level uses.
 * @param firstId - The global id after the project's tilesets.
 * @returns The tileset; its `image` is `null` because it has no art.
 */
function intGridTileset(max: number, firstId: number): ConvertedTileset {
  const tiles: JsonObject[] = [];
  for (let value = 1; value <= max; value += 1) {
    const collider = INTGRID_COLLIDERS[value];
    const frame = `${INTGRID_TILESET}_${String(value)}`;
    tiles.push(collider === undefined ? { id: value - 1, frame } : { id: value - 1, frame, collider });
  }
  return { name: INTGRID_TILESET, image: null, firstId, tiles, frames: [] };
}

/**
 * Finds the tileset a tile layer draws from.
 *
 * @param instance - The layer instance.
 * @param project - The project data.
 * @param where - The layer, for messages.
 * @returns The tileset.
 */
function layerTileset(instance: JsonObject, project: Project, where: string): ConvertedTileset {
  const tileset = project.tilesetsByUid.get(readNumber(instance, "__tilesetDefUid", -1));
  if (tileset === undefined) {
    return unsupported(
      project.path,
      `draws ${where} from a tileset with no image file (or none at all)`,
      "Give the layer a tileset made from an image file in LDtk.",
    );
  }
  return tileset;
}

/**
 * Places a layer's tile instances on its grid. Where LDtk stacks several tiles in one cell, the
 * last one, which LDtk draws on top, is kept.
 *
 * @param art - The `gridTiles` or `autoLayerTiles` entries.
 * @param instance - The layer instance.
 * @param firstId - The tileset's first global id.
 * @param project - The project data.
 * @param where - The layer, for messages.
 * @returns The dense tile ids, top row first.
 */
function placeTiles(
  art: readonly JsonObject[],
  instance: JsonObject,
  firstId: number,
  project: Project,
  where: string,
): number[] {
  const columns = Math.max(0, readNumber(instance, "__cWid", 0));
  const rows = Math.max(0, readNumber(instance, "__cHei", 0));
  const grid = Math.max(1, readNumber(instance, "__gridSize", 1));
  const offsetX = Math.round(readNumber(instance, "pxOffsetX", 0) / grid);
  const offsetY = Math.round(readNumber(instance, "pxOffsetY", 0) / grid);
  const tiles = Array.from({ length: columns * rows }, (): number => 0);
  let flipped = 0;
  let stacked = 0;
  for (const tile of art) {
    const px = readArray(tile, "px");
    const x = px[0];
    const y = px[1];
    if (typeof x !== "number" || typeof y !== "number") {
      continue;
    }
    const cellX = Math.floor(x / grid) + offsetX;
    const cellY = Math.floor(y / grid) + offsetY;
    if (cellX < 0 || cellY < 0 || cellX >= columns || cellY >= rows) {
      continue;
    }
    if (readNumber(tile, "f", 0) !== 0) {
      flipped += 1;
    }
    const index = cellY * columns + cellX;
    if (tiles[index] !== 0) {
      stacked += 1;
    }
    tiles[index] = firstId + readNumber(tile, "t", 0);
  }
  if (flipped > 0) {
    if (!project.context.dropFlips) {
      return unsupported(
        project.path,
        `has ${String(flipped)} flipped tile(s) in ${where}, and a tilemap cell has no flip`,
        "Use unflipped tiles in LDtk, or pass --drop-flips to import them unflipped.",
      );
    }
    project.context.warn(`${capitalise(where)}: ${String(flipped)} flipped tile(s) imported unflipped.`);
  }
  if (stacked > 0) {
    project.context.warn(`${capitalise(where)}: ${String(stacked)} stacked tile(s) dropped; a cell holds one tile.`);
  }
  return tiles;
}

/**
 * Upper-cases a message's first letter.
 *
 * @param text - The text.
 * @returns The text with a capital first letter.
 */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Reads a layer definition's parallax as the tilemap's multiplier, where `1` moves with the camera.
 *
 * @param layerDefs - The project's layer definitions.
 * @param uid - The layer's definition uid.
 * @returns The multiplier.
 */
function readParallax(layerDefs: readonly JsonObject[], uid: number): JsonObject {
  const def = layerDefs.find((entry) => readNumber(entry, "uid", -1) === uid);
  return def === undefined
    ? { x: 1, y: 1 }
    : {
        x: canonical(1 - readNumber(def, "parallaxFactorX", 0)),
        y: canonical(1 - readNumber(def, "parallaxFactorY", 0)),
      };
}

/**
 * Flattens LDtk `fieldInstances` into a record.
 *
 * @param fields - The `fieldInstances` field.
 * @returns The record; array, point and entity-reference fields are dropped.
 */
function fieldRecord(fields: unknown): PropertyRecord {
  const entries = Array.isArray(fields) ? records(fields) : [];
  return propertyRecord(entries.map((field) => [field["__identifier"], field["__value"]] as const));
}

/**
 * Reads an Entities layer into the map's objects, in metres with +Y up and `y` at the bottom edge.
 *
 * @param instance - The layer instance.
 * @param levelHeightPx - The level's height in pixels.
 * @param ppu - The pixels one metre spans.
 * @param out - The object list.
 */
function readEntities(instance: JsonObject, levelHeightPx: number, ppu: number, out: JsonObject[]): void {
  const offsetX = readNumber(instance, "pxOffsetX", 0);
  const offsetY = readNumber(instance, "pxOffsetY", 0);
  for (const entity of records(readArray(instance, "entityInstances"))) {
    const identifier = readString(entity, "__identifier", "");
    const entityWidth = readNumber(entity, "width", 0);
    const entityHeight = readNumber(entity, "height", 0);
    const px = readArray(entity, "px");
    const pivot = readArray(entity, "__pivot");
    const pivotX = typeof pivot[0] === "number" ? pivot[0] : 0;
    const pivotY = typeof pivot[1] === "number" ? pivot[1] : 0;
    const left = (typeof px[0] === "number" ? px[0] : 0) + offsetX - pivotX * entityWidth;
    const top = (typeof px[1] === "number" ? px[1] : 0) + offsetY - pivotY * entityHeight;
    const properties = fieldRecord(entity["fieldInstances"]);
    const named = properties["name"];
    out.push({
      name: typeof named === "string" && named !== "" ? named : identifier,
      type: identifier,
      x: canonical(left / ppu),
      y: canonical((levelHeightPx - top - entityHeight) / ppu),
      width: canonical(entityWidth / ppu),
      height: canonical(entityHeight / ppu),
      properties,
    });
  }
}
