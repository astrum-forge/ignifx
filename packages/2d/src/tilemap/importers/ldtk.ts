import { twoDError, TwoDErrorCode } from "../../errors.js";
import { DEFAULT_PIXELS_PER_UNIT } from "../../math/coords.js";
import { defineTilemap } from "../definition.js";
import type {
  TileColliderDefinition,
  TileDefinition,
  TilemapDefinition,
  TilemapLayerInput,
  TilemapObjectDefinition,
  TilesetDefinition,
} from "../definition.js";

/**
 * The **LDtk** importer: turns an `.ldtk` project into an `ignifx.tilemap` document for one of its
 * levels (`docs/architecture/11-2d-toolkit.md` §2.5).
 *
 * Like the Tiled importer this is a pure function over parsed JSON. LDtk models a *project* of many
 * levels where ignifx models one map, so the importer picks a single level — by identifier, or the
 * first one — and flattens it.
 */

/**
 * A parallax multiplier pair, structurally the `Vec2Like` the tilemap format stores. Declaring it
 * here rather than importing `Vec2Like` keeps this module's type imports to a single specifier,
 * which is the shape the formatter and the import-order rule agree on.
 */
interface ParallaxFactor {
  /** The horizontal multiplier; `1` moves with the camera. */
  readonly x: number;
  /** The vertical multiplier; `1` moves with the camera. */
  readonly y: number;
}

/** The name reported in `IGX-1109` context so a developer knows which importer complained. */
const IMPORTER_NAME = "ldtk";

/** The layer types this importer understands; anything else is an `IGX-1109`. */
const SUPPORTED_LAYER_TYPES: readonly string[] = Object.freeze(["Tiles", "IntGrid", "Entities"]);

/**
 * The name given to the synthetic tileset that carries IntGrid colliders.
 *
 * @public
 */
export const LDTK_INTGRID_TILESET_NAME = "intgrid";

/**
 * The default meaning of an LDtk IntGrid value, in cell-normalised top-left-origin units.
 *
 * @remarks
 * `1` is "solid" — the whole cell collides. `2` is "one-way" — the top quarter of the cell collides,
 * and only from above. Those two conventions cover the LDtk projects people actually ship, and
 * anything else is project-specific, so {@link LdtkImportOptions.intGridColliders} replaces this
 * table wholesale. An IntGrid value with no entry still gets a tile id and a frame; it simply does
 * not collide.
 *
 * @public
 */
export const LDTK_DEFAULT_INTGRID_COLLIDERS: Readonly<Record<number, TileColliderDefinition>> = Object.freeze({
  1: { kind: "box", x: 0, y: 0, width: 1, height: 1 },
  2: { kind: "box", x: 0, y: 0, width: 1, height: 0.25, oneWay: true },
});

/**
 * How {@link importLdtkLevel} maps LDtk's conventions onto ignifx's.
 *
 * @public
 */
export interface LdtkImportOptions {
  /** The pixels one world metre spans. Defaults to `100`, matching `twoD.pixelsPerUnit`. */
  readonly pixelsPerUnit?: number;
  /** The `identifier` of the level to import. Defaults to the project's first level. */
  readonly level?: string;
  /** The sorting layer every layer lands in. Defaults to `"Default"`. */
  readonly sortingLayer?: string;
  /**
   * Maps an LDtk tileset's `relPath` onto the address of the ignifx `.atlas.json` generated from it.
   * Defaults to swapping the file extension for `.atlas.json`.
   */
  readonly atlasFor?: (relPath: string) => string;
  /** Replaces {@link LDTK_DEFAULT_INTGRID_COLLIDERS} for this import. */
  readonly intGridColliders?: Readonly<Record<number, TileColliderDefinition>>;
}

/**
 * Imports one level of an LDtk project.
 *
 * @remarks
 * Three LDtk conventions need translating, and each is a place a naive importer goes wrong:
 *
 * - **Layer order is reversed.** LDtk stores `layerInstances` front-to-back — index `0` is the
 *   layer drawn on *top*. ignifx layers are back-to-front, so the list is reversed and
 *   `orderInLayer` follows the reversed index.
 * - **Tile layers are sparse.** `gridTiles` is a list of `{ px, t }` placements, not a grid; the
 *   importer expands it into the dense `__cWid * __cHei` array the tilemap format wants, filling
 *   the gaps with `0`. `t` is a tile index *within its tileset*, so the global id is
 *   `tileset.firstId + t`. A layer's `pxOffsetX`/`pxOffsetY` shift the grid; a dense grid has no
 *   sub-cell placement, so the offset is rounded to whole cells.
 * - **IntGrid layers are collision, not art.** An `intGridCsv` becomes a layer with
 *   `collision: true` whose ids point into a synthetic, art-less tileset named
 *   {@link LDTK_INTGRID_TILESET_NAME}; see {@link LDTK_DEFAULT_INTGRID_COLLIDERS} for the value
 *   mapping and {@link LdtkImportOptions.intGridColliders} for overriding it.
 *
 * A tileset's `customData` entries are read as JSON, and an entry that parses to an object with
 * `solid: true` gives its tile a full-cell box collider. Data that is not JSON, or that says
 * something else, is ignored rather than treated as an error — `customData` is a free-form field
 * and other tools put other things in it.
 *
 * Per-tile flips (`gridTiles[].f`) are dropped, as they are in the Tiled importer: the tilemap
 * format has no per-cell flip yet.
 *
 * @param ldtk - The parsed `.ldtk` project.
 * @param options - The level to pick, pixels-per-unit, the sorting layer, and the mappings.
 * @returns The `ignifx.tilemap` document for that level.
 * @throws IgnifxError with code `IGX-1109` when the project has no levels, when
 * {@link LdtkImportOptions.level} names a level that is not there, or when a layer's type is not
 * `Tiles`, `IntGrid` or `Entities`; and `IGX-1105` when what it decodes to is not a valid tilemap.
 *
 * @example
 * ```ts
 * const map = importLdtkLevel(JSON.parse(await readFile("world.ldtk", "utf8")), { level: "Cave" });
 * ```
 *
 * @public
 */
export function importLdtkLevel(ldtk: unknown, options: LdtkImportOptions = {}): TilemapDefinition {
  const fail = (reason: string): never => {
    throw twoDError(TwoDErrorCode.unsupportedImport, `The LDtk importer cannot read this document: ${reason}.`, {
      context: { importer: IMPORTER_NAME, reason },
      hint: "Re-save the project from LDtk 1.5 or later with the default (single-file) JSON layout.",
    });
  };
  if (!isRecord(ldtk)) {
    return fail("it is not a JSON object");
  }
  const levels = readArray(ldtk, "levels");
  if (levels.length === 0) {
    return fail("the project declares no levels");
  }
  const wanted = options.level;
  const level = wanted === undefined ? firstRecord(levels) : findLevel(levels, wanted);
  if (level === null) {
    return fail(wanted === undefined ? "its first level is not an object" : `it declares no level named ${wanted}`);
  }

  const pixelsPerUnit = options.pixelsPerUnit ?? DEFAULT_PIXELS_PER_UNIT;
  const sortingLayer = options.sortingLayer ?? "Default";
  const atlasFor = options.atlasFor ?? defaultAtlasFor;
  const intGridColliders = options.intGridColliders ?? LDTK_DEFAULT_INTGRID_COLLIDERS;
  const defs = isRecord(ldtk["defs"]) ? ldtk["defs"] : null;
  const layerDefs = defs === null ? [] : readArray(defs, "layers");

  // LDtk stores layers front-to-back; ignifx draws index 0 first, so the list is reversed once here
  // and every downstream index — including `orderInLayer` — is in ignifx order.
  const instances: Readonly<Record<string, unknown>>[] = [];
  const rawInstances = readArray(level, "layerInstances");
  for (let index = rawInstances.length - 1; index >= 0; index -= 1) {
    const instance = rawInstances[index];
    if (isRecord(instance)) {
      const type = readString(instance, "__type", "");
      if (!SUPPORTED_LAYER_TYPES.includes(type)) {
        return fail(`layer ${readString(instance, "__identifier", "?")} has the unsupported type ${type}`);
      }
      instances.push(instance);
    }
  }

  const gridSize = resolveGridSize(instances, ldtk);
  const levelWidthPx = readNumber(level, "pxWid", 0);
  const levelHeightPx = readNumber(level, "pxHei", 0);
  const width = Math.max(1, Math.round(levelWidthPx / gridSize));
  const height = Math.max(1, Math.round(levelHeightPx / gridSize));

  const tilesets: TilesetDefinition[] = [];
  const tilesetsByUid = new Map<number, TilesetDefinition>();
  let nextFirstId = 1;
  const rawTilesets = defs === null ? [] : readArray(defs, "tilesets");
  for (let index = 0; index < rawTilesets.length; index += 1) {
    const raw = rawTilesets[index];
    if (!isRecord(raw)) {
      continue;
    }
    const tileset = readTileset(raw, nextFirstId, atlasFor);
    nextFirstId += tileset.tiles.length;
    tilesets.push(tileset);
    tilesetsByUid.set(readNumber(raw, "uid", -1), tileset);
  }

  const intGridTileset = buildIntGridTileset(instances, nextFirstId, intGridColliders);
  if (intGridTileset !== null) {
    tilesets.push(intGridTileset);
  }

  const layers: TilemapLayerInput[] = [];
  const objects: TilemapObjectDefinition[] = [];
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    if (instance === undefined) {
      continue;
    }
    const type = readString(instance, "__type", "");
    if (type === "Entities") {
      readEntities(instance, levelHeightPx, pixelsPerUnit, objects);
      continue;
    }
    const parallax = readParallax(layerDefs, readNumber(instance, "layerDefUid", -1));
    if (type === "IntGrid" && intGridTileset !== null) {
      layers.push(readIntGridLayer(instance, layers.length, sortingLayer, parallax, intGridTileset.firstId));
      continue;
    }
    if (type === "Tiles") {
      const tileset = tilesetsByUid.get(readNumber(instance, "__tilesetDefUid", -1)) ?? null;
      layers.push(readTilesLayer(instance, layers.length, sortingLayer, parallax, tileset));
    }
  }

  return defineTilemap(
    {
      tileWidth: gridSize,
      tileHeight: gridSize,
      cellSize: gridSize / pixelsPerUnit,
      width,
      height,
      tilesets,
      layers,
      objects,
      properties: fieldInstancesToRecord(level["fieldInstances"]),
    },
    "<ldtk>",
  );
}

/**
 * Flattens LDtk's `[{ __identifier, __type, __value }]` field instances into a plain record.
 *
 * @remarks
 * Only `string`, `number` and `boolean` values survive. LDtk's richer field types — points, entity
 * references, arrays, enum tuples — have no equivalent in the tilemap format's flat property record
 * and are dropped rather than stringified.
 *
 * @param fields - The value of a `fieldInstances` field, or anything else.
 * @returns The flattened record; empty when `fields` is not a field-instance array.
 *
 * @example
 * ```ts
 * fieldInstancesToRecord([{ __identifier: "facing", __type: "String", __value: "left" }]);
 * // { facing: "left" }
 * ```
 *
 * @public
 */
export function fieldInstancesToRecord(fields: unknown): Readonly<Record<string, string | number | boolean>> {
  if (!isUnknownArray(fields)) {
    return {};
  }
  const out: Record<string, string | number | boolean> = {};
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!isRecord(field)) {
      continue;
    }
    const name = field["__identifier"];
    const value = field["__value"];
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
 * Swaps a file extension for `.atlas.json`, the default {@link LdtkImportOptions.atlasFor}.
 *
 * @param relPath - The image path the editor recorded.
 * @returns The atlas address.
 */
function defaultAtlasFor(relPath: string): string {
  const slash = Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\"));
  const dot = relPath.lastIndexOf(".");
  return dot > slash ? `${relPath.slice(0, dot)}.atlas.json` : `${relPath}.atlas.json`;
}

/**
 * The first entry of a list that is an object.
 *
 * @param values - The parsed list.
 * @returns The first object, or `null`.
 */
function firstRecord(values: readonly unknown[]): Readonly<Record<string, unknown>> | null {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (isRecord(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Finds a level by its `identifier`.
 *
 * @param levels - The project's levels.
 * @param identifier - The level name to match.
 * @returns The level, or `null` when the project has no such level.
 */
function findLevel(levels: readonly unknown[], identifier: string): Readonly<Record<string, unknown>> | null {
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (isRecord(level) && readString(level, "identifier", "") === identifier) {
      return level;
    }
  }
  return null;
}

/**
 * Picks the cell size of the level: the first layer's `__gridSize`, else the project default.
 *
 * @param instances - The level's layer instances, already filtered to objects.
 * @param project - The project root, for `defaultGridSize`.
 * @returns The grid size in pixels; never zero.
 */
function resolveGridSize(
  instances: readonly Readonly<Record<string, unknown>>[],
  project: Readonly<Record<string, unknown>>,
): number {
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    if (instance === undefined) {
      continue;
    }
    const size = readNumber(instance, "__gridSize", 0);
    if (size > 0) {
      return size;
    }
  }
  const fallback = readNumber(project, "defaultGridSize", 0);
  return fallback > 0 ? fallback : 16;
}

/**
 * Reads one LDtk tileset definition, including its `customData` colliders.
 *
 * @param raw - The tileset definition.
 * @param firstId - The global id this tileset's tile `0` takes.
 * @param atlasFor - The image-to-atlas address mapping.
 * @returns The tileset definition.
 */
function readTileset(
  raw: Readonly<Record<string, unknown>>,
  firstId: number,
  atlasFor: (relPath: string) => string,
): TilesetDefinition {
  const name = readString(raw, "identifier", `tileset${String(firstId)}`);
  const gridSize = Math.max(1, readNumber(raw, "tileGridSize", 16));
  const columns = readNumber(raw, "__cWid", Math.floor(readNumber(raw, "pxWid", 0) / gridSize));
  const rows = readNumber(raw, "__cHei", Math.floor(readNumber(raw, "pxHei", 0) / gridSize));
  const solid = new Set<number>();
  const customData = readArray(raw, "customData");
  for (let index = 0; index < customData.length; index += 1) {
    const entry = customData[index];
    if (isRecord(entry) && isSolidCustomData(entry["data"])) {
      solid.add(readNumber(entry, "tileId", -1));
    }
  }
  const tiles: TileDefinition[] = [];
  const tileCount = Math.max(0, columns * rows);
  for (let localId = 0; localId < tileCount; localId += 1) {
    const frame = `${name}_${String(localId)}`;
    tiles.push(
      solid.has(localId)
        ? { id: localId, frame, collider: { kind: "box", x: 0, y: 0, width: 1, height: 1 } }
        : { id: localId, frame },
    );
  }
  return { name, atlas: atlasFor(readString(raw, "relPath", "")), firstId, tiles };
}

/**
 * Decides whether an LDtk `customData` payload marks its tile solid.
 *
 * @param data - The raw `data` string.
 * @returns Whether it parses as JSON with a `solid: true` field.
 */
function isSolidCustomData(data: unknown): boolean {
  if (typeof data !== "string" || data === "") {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) && parsed["solid"] === true;
  } catch {
    // `customData` is free-form; other tools store plain text in it. Not JSON simply means "no
    // collider", which is the same answer as an absent entry.
    return false;
  }
}

/**
 * Builds the synthetic, art-less tileset the IntGrid layers point into.
 *
 * @param instances - The level's layer instances, in ignifx order.
 * @param firstId - The global id the synthetic tile for IntGrid value `1` takes.
 * @param colliders - The IntGrid value to collider mapping.
 * @returns The tileset, or `null` when the level has no IntGrid data.
 */
function buildIntGridTileset(
  instances: readonly Readonly<Record<string, unknown>>[],
  firstId: number,
  colliders: Readonly<Record<number, TileColliderDefinition>>,
): TilesetDefinition | null {
  let maxValue = 0;
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    if (instance === undefined || readString(instance, "__type", "") !== "IntGrid") {
      continue;
    }
    const csv = readArray(instance, "intGridCsv");
    for (let cell = 0; cell < csv.length; cell += 1) {
      const value = csv[cell];
      if (typeof value === "number" && value > maxValue) {
        maxValue = value;
      }
    }
  }
  if (maxValue <= 0) {
    return null;
  }
  const tiles: TileDefinition[] = [];
  for (let value = 1; value <= maxValue; value += 1) {
    const frame = `${LDTK_INTGRID_TILESET_NAME}_${String(value)}`;
    const collider = colliders[value];
    tiles.push(collider === undefined ? { id: value - 1, frame } : { id: value - 1, frame, collider });
  }
  // The atlas address is deliberately empty: an IntGrid layer is collision, not art, and there is
  // no image to cut frames from.
  return { name: LDTK_INTGRID_TILESET_NAME, atlas: "", firstId, tiles };
}

/**
 * Converts an LDtk parallax factor pair into an ignifx parallax multiplier.
 *
 * @remarks
 * LDtk's `parallaxFactorX` is an offset *fraction*: `0` means the layer sits still relative to the
 * level, and a positive factor makes it lag the camera. ignifx's `parallax` is a speed multiplier
 * where `1` moves with the camera, so the two are related by `multiplier = 1 - factor`.
 *
 * @param layerDefs - The project's `defs.layers`.
 * @param uid - The `layerDefUid` to look up.
 * @returns The parallax multiplier.
 */
function readParallax(layerDefs: readonly unknown[], uid: number): ParallaxFactor {
  for (let index = 0; index < layerDefs.length; index += 1) {
    const def = layerDefs[index];
    if (isRecord(def) && readNumber(def, "uid", -1) === uid) {
      return { x: 1 - readNumber(def, "parallaxFactorX", 0), y: 1 - readNumber(def, "parallaxFactorY", 0) };
    }
  }
  return { x: 1, y: 1 };
}

/**
 * Expands an LDtk `Tiles` layer's sparse `gridTiles` into a dense tile array.
 *
 * @param instance - The layer instance.
 * @param order - The layer's position in ignifx order.
 * @param sortingLayer - The sorting layer to place it in.
 * @param parallax - The parallax multiplier.
 * @param tileset - The tileset the layer draws from, or `null` when it names none.
 * @returns The layer input.
 */
function readTilesLayer(
  instance: Readonly<Record<string, unknown>>,
  order: number,
  sortingLayer: string,
  parallax: ParallaxFactor,
  tileset: TilesetDefinition | null,
): TilemapLayerInput {
  const columns = Math.max(0, readNumber(instance, "__cWid", 0));
  const rows = Math.max(0, readNumber(instance, "__cHei", 0));
  const gridSize = Math.max(1, readNumber(instance, "__gridSize", 1));
  const offsetX = Math.round(readNumber(instance, "pxOffsetX", 0) / gridSize);
  const offsetY = Math.round(readNumber(instance, "pxOffsetY", 0) / gridSize);
  const firstId = tileset === null ? 1 : tileset.firstId;
  const tiles = Array.from({ length: columns * rows }, (): number => 0);
  const gridTiles = readArray(instance, "gridTiles");
  for (let index = 0; index < gridTiles.length; index += 1) {
    const gridTile = gridTiles[index];
    if (!isRecord(gridTile)) {
      continue;
    }
    const px = gridTile["px"];
    if (!isUnknownArray(px)) {
      continue;
    }
    const rawX = px[0];
    const rawY = px[1];
    if (typeof rawX !== "number" || typeof rawY !== "number") {
      continue;
    }
    const cellX = Math.floor(rawX / gridSize) + offsetX;
    const cellY = Math.floor(rawY / gridSize) + offsetY;
    if (cellX < 0 || cellY < 0 || cellX >= columns || cellY >= rows) {
      continue;
    }
    tiles[cellY * columns + cellX] = firstId + readNumber(gridTile, "t", 0);
  }
  return {
    name: readString(instance, "__identifier", `Layer ${String(order)}`),
    sortingLayer,
    orderInLayer: order,
    opacity: readNumber(instance, "__opacity", 1),
    parallax,
    collision: false,
    width: columns,
    height: rows,
    tiles,
  };
}

/**
 * Turns an LDtk `IntGrid` layer's `intGridCsv` into a collision layer over the synthetic tileset.
 *
 * @param instance - The layer instance.
 * @param order - The layer's position in ignifx order.
 * @param sortingLayer - The sorting layer to place it in.
 * @param parallax - The parallax multiplier.
 * @param firstId - The synthetic tileset's `firstId`.
 * @returns The layer input.
 */
function readIntGridLayer(
  instance: Readonly<Record<string, unknown>>,
  order: number,
  sortingLayer: string,
  parallax: ParallaxFactor,
  firstId: number,
): TilemapLayerInput {
  const columns = Math.max(0, readNumber(instance, "__cWid", 0));
  const rows = Math.max(0, readNumber(instance, "__cHei", 0));
  const csv = readArray(instance, "intGridCsv");
  const tiles = Array.from({ length: columns * rows }, (): number => 0);
  for (let index = 0; index < tiles.length && index < csv.length; index += 1) {
    const value = csv[index];
    if (typeof value === "number" && value > 0) {
      tiles[index] = firstId + (value - 1);
    }
  }
  return {
    name: readString(instance, "__identifier", `Layer ${String(order)}`),
    sortingLayer,
    orderInLayer: order,
    opacity: readNumber(instance, "__opacity", 1),
    parallax,
    collision: true,
    width: columns,
    height: rows,
    tiles,
  };
}

/**
 * Converts an LDtk `Entities` layer into tilemap objects.
 *
 * @remarks
 * `px` is the entity's **pivot** in level pixels from the level's top-left, so the box's top-left is
 * `px - pivot * size`; the layer's `pxOffset` shifts it, and the +Y flip then puts the bottom edge
 * at `(levelHeightPx - top - height) / ppu`.
 *
 * @param instance - The layer instance.
 * @param levelHeightPx - The level's height in pixels.
 * @param pixelsPerUnit - The pixels one world metre spans.
 * @param out - The object list to append to.
 */
function readEntities(
  instance: Readonly<Record<string, unknown>>,
  levelHeightPx: number,
  pixelsPerUnit: number,
  out: TilemapObjectDefinition[],
): void {
  const offsetX = readNumber(instance, "pxOffsetX", 0);
  const offsetY = readNumber(instance, "pxOffsetY", 0);
  const entities = readArray(instance, "entityInstances");
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    if (!isRecord(entity)) {
      continue;
    }
    const identifier = readString(entity, "__identifier", "");
    const entityWidth = readNumber(entity, "width", 0);
    const entityHeight = readNumber(entity, "height", 0);
    const px = entity["px"];
    const pivot = entity["__pivot"];
    const pivotX = isUnknownArray(pivot) && typeof pivot[0] === "number" ? pivot[0] : 0;
    const pivotY = isUnknownArray(pivot) && typeof pivot[1] === "number" ? pivot[1] : 0;
    const pivotPxX = isUnknownArray(px) && typeof px[0] === "number" ? px[0] : 0;
    const pivotPxY = isUnknownArray(px) && typeof px[1] === "number" ? px[1] : 0;
    const left = pivotPxX + offsetX - pivotX * entityWidth;
    const top = pivotPxY + offsetY - pivotY * entityHeight;
    const properties = fieldInstancesToRecord(entity["fieldInstances"]);
    const named = properties["name"];
    out.push({
      name: typeof named === "string" && named !== "" ? named : identifier,
      type: identifier,
      x: left / pixelsPerUnit,
      y: (levelHeightPx - top - entityHeight) / pixelsPerUnit,
      width: entityWidth / pixelsPerUnit,
      height: entityHeight / pixelsPerUnit,
      properties,
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
