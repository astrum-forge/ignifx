import { posix } from "node:path";
import { CliError, CliErrorCode } from "../errors.js";
import { isRecord } from "../json-text.js";

/**
 * What the Tiled and LDtk converters hand the `ignifx import tilemap` command: an `ignifx.tilemap`
 * document whose tilesets still name their source images, plus the frame rectangles to cut from
 * each image when it has no `.atlas.json` yet. `@ignifx/cli` may not import `@ignifx/2d`
 * (`.dependency-cruiser.cjs`), so the document shape (`docs/architecture/11-2d-toolkit.md` §2.5)
 * is restated here, and `packages/2d/test/tilemap/cli-import.test.ts` loads what this writes.
 */

/** A read-only JSON object. */
export type JsonObject = Readonly<Record<string, unknown>>;

/** A custom-property record: the value types the tilemap format keeps. */
export type PropertyRecord = Readonly<Record<string, string | number | boolean>>;

/**
 * One frame rectangle of a generated atlas, in image pixels with a top-left origin.
 *
 * @internal
 */
export interface AtlasFrame {
  /** The frame name: `<tileset name>_<local tile index>`. */
  readonly name: string;
  /** The left edge. */
  readonly x: number;
  /** The top edge. */
  readonly y: number;
  /** The width. */
  readonly w: number;
  /** The height. */
  readonly h: number;
}

/**
 * A converted tileset, before its atlas address is known.
 *
 * @internal
 */
export interface ConvertedTileset {
  /** The tileset name; also the frame-name prefix. */
  readonly name: string;
  /** The source image's POSIX path relative to the map's folder, or `null` for a collision-only tileset. */
  readonly image: string | null;
  /** The global id of tile `0`. */
  readonly firstId: number;
  /** The `tiles` entries, in the tilemap format. */
  readonly tiles: readonly JsonObject[];
  /** The rectangles a generated atlas cuts out of {@link ConvertedTileset.image}. */
  readonly frames: readonly AtlasFrame[];
}

/**
 * One converted map: a Tiled map or one LDtk level.
 *
 * @internal
 */
export interface ConvertedMap {
  /** The map's name: the LDtk level identifier, or the Tiled file's base name. */
  readonly name: string;
  /** One tile's width, in pixels. */
  readonly tileWidth: number;
  /** One tile's height, in pixels. */
  readonly tileHeight: number;
  /** The width, in cells. */
  readonly width: number;
  /** The height, in cells. */
  readonly height: number;
  /** The tilesets, by ascending first id. */
  readonly tilesets: readonly ConvertedTileset[];
  /** The tile layers, back to front, in the tilemap format with dense `tiles`. */
  readonly layers: readonly JsonObject[];
  /** The objects, in metres with +Y up, in the tilemap format. */
  readonly objects: readonly JsonObject[];
  /** The map's custom properties. */
  readonly properties: PropertyRecord;
}

/**
 * The caps a conversion enforces so a hostile or broken map cannot exhaust memory: every count a
 * source file states that the converter would allocate for is checked before it allocates.
 *
 * @public
 */
export interface TilemapSourceLimits {
  /** The longest JSON text read, the map's own included, in UTF-16 code units. */
  readonly maxJsonLength: number;
  /** The most JSON text all files read may hold together, the map's own included. */
  readonly maxTotalJsonLength: number;
  /** The most cells one map or layer may span (`width × height`). */
  readonly maxLayerCells: number;
  /** The most layer cells and tileset tiles all converted maps may hold together. */
  readonly maxTotalCells: number;
  /** The most tile layers one map may have. */
  readonly maxLayers: number;
  /** The most tiles one tileset may declare. */
  readonly maxTilesetTiles: number;
  /** The most tilesets one map or project may declare. */
  readonly maxTilesets: number;
  /** The most levels an LDtk project may convert. */
  readonly maxLevels: number;
}

/**
 * The limits a conversion applies unless told otherwise: 64 Mi characters per JSON file and 256 Mi
 * in all, 4 Mi cells per map or layer (2048 × 2048), 16 Mi cells and tiles in all, 256 tile layers
 * per map, 256 tilesets, 65 536 tiles per tileset and 1 024 LDtk levels.
 *
 * @public
 */
export const DEFAULT_TILEMAP_SOURCE_LIMITS: TilemapSourceLimits = Object.freeze({
  maxJsonLength: 64 * 1024 * 1024,
  maxTotalJsonLength: 256 * 1024 * 1024,
  maxLayerCells: 2048 * 2048,
  maxTotalCells: 16 * 1024 * 1024,
  maxLayers: 256,
  maxTilesetTiles: 65_536,
  maxTilesets: 256,
  maxLevels: 1024,
});

/**
 * What a converter needs from the command.
 *
 * @internal
 */
export interface ConvertContext {
  /** The pixels one world metre spans. */
  readonly pixelsPerUnit: number;
  /** Whether a flipped or rotated tile is drawn unflipped (with a warning) instead of refused. */
  readonly dropFlips: boolean;
  /** Reports something the conversion lost or skipped. */
  readonly warn: (line: string) => void;
  /**
   * Reads and parses a JSON file another file references, such as a `.tsj` or an `.ldtkl`, by its
   * POSIX path relative to the base folder. Each path is read once; the path is confined first.
   */
  readonly readJson: (path: string) => Promise<unknown>;
  /** The caps, and the cells counted so far against `maxTotalCells`. */
  readonly budget: CellBudget;
}

/**
 * Counts the cells a conversion allocates against its limits.
 *
 * @internal
 */
export class CellBudget {
  /** The limits. */
  readonly limits: TilemapSourceLimits;
  #total = 0;

  /**
   * Starts a count at zero.
   *
   * @param limits - The limits.
   */
  constructor(limits: TilemapSourceLimits) {
    this.limits = limits;
  }

  /**
   * Checks a grid one map or layer spans, and counts a layer's cells against the total.
   *
   * @param path - The source file, for the message.
   * @param what - The map or layer, for the message.
   * @param columns - Its width in cells.
   * @param rows - Its height in cells.
   * @param allocate - `true` for a layer whose cells are allocated, counted against the total.
   * @throws A {@link CliError} with code `IGX-1408` past a limit.
   */
  cells(path: string, what: string, columns: number, rows: number, allocate: boolean): void {
    const count = Math.max(0, columns) * Math.max(0, rows);
    if (!Number.isFinite(count) || count > this.limits.maxLayerCells) {
      overLimit(path, `${what} spans ${String(count)} cells`, this.limits.maxLayerCells, "maxLayerCells");
    }
    if (allocate) {
      this.#total += count;
      if (this.#total > this.limits.maxTotalCells) {
        overLimit(
          path,
          `has ${String(this.#total)} tile cells and tiles in all`,
          this.limits.maxTotalCells,
          "maxTotalCells",
        );
      }
    }
  }

  /**
   * Checks the tiles one tileset declares, and counts them against the total: each becomes an
   * entry of the document and a frame of its atlas.
   *
   * @param path - The source file, for the message.
   * @param what - The tileset, for the message.
   * @param count - Its tile count.
   * @throws A {@link CliError} with code `IGX-1408` past a limit.
   */
  tiles(path: string, what: string, count: number): void {
    this.count(path, `the tile count of ${what}`, count, "maxTilesetTiles");
    this.#total += Math.max(0, count);
    if (this.#total > this.limits.maxTotalCells) {
      overLimit(
        path,
        `has ${String(this.#total)} tile cells and tiles in all`,
        this.limits.maxTotalCells,
        "maxTotalCells",
      );
    }
  }

  /**
   * Checks a count against one of the limits.
   *
   * @param path - The source file, for the message.
   * @param what - What is counted, for the message.
   * @param count - The count.
   * @param limit - Which limit applies.
   * @throws A {@link CliError} with code `IGX-1408` past it.
   */
  count(
    path: string,
    what: string,
    count: number,
    limit: "maxLayers" | "maxTilesetTiles" | "maxTilesets" | "maxLevels",
  ): void {
    if (!Number.isFinite(count) || count > this.limits[limit]) {
      overLimit(path, `${what}: ${String(count)}`, this.limits[limit], limit);
    }
  }
}

/**
 * Throws the error for a source file past an import limit.
 *
 * @param path - The source file.
 * @param what - What is over the limit.
 * @param limit - The limit's value.
 * @param name - The limit's name in {@link TilemapSourceLimits}.
 * @throws A {@link CliError} with code `IGX-1408`.
 */
function overLimit(path: string, what: string, limit: number, name: string): never {
  throw new CliError(
    CliErrorCode.unsupportedTilemapSource,
    `"${path}" ${what}, over the import limit of ${String(limit)} (${name}). Split the map, or raise limits.${name} if the file is trusted.`,
  );
}

/**
 * Resolves a path a source file references against the folder of the file holding it, both POSIX
 * paths relative to the map's folder.
 *
 * @param folder - The referencing file's folder.
 * @param reference - The path as the file wrote it.
 * @returns The normalised path; an absolute reference stays absolute.
 *
 * @internal
 */
export function resolveReference(folder: string, reference: string): string {
  const normal = reference.replaceAll("\\", "/");
  return posix.isAbsolute(normal) ? posix.normalize(normal) : posix.normalize(posix.join(folder, normal));
}

/**
 * Throws the error for a source file feature the command cannot convert.
 *
 * @param path - The source file, for the message.
 * @param reason - What it uses.
 * @param hint - How to re-export it.
 * @throws A {@link CliError} with code `IGX-1408`.
 *
 * @internal
 */
export function unsupported(path: string, reason: string, hint: string): never {
  throw new CliError(CliErrorCode.unsupportedTilemapSource, `"${path}" ${reason}. ${hint}`);
}

/**
 * Reads a numeric field.
 *
 * @param source - The object.
 * @param key - The field.
 * @param fallback - The value when the field is missing or not a finite number.
 * @returns The number.
 *
 * @internal
 */
export function readNumber(source: JsonObject, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Reads a string field.
 *
 * @param source - The object.
 * @param key - The field.
 * @param fallback - The value when the field is missing or not a string.
 * @returns The string.
 *
 * @internal
 */
export function readString(source: JsonObject, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads an array field.
 *
 * @param source - The object.
 * @param key - The field.
 * @returns The array, or an empty one.
 *
 * @internal
 */
export function readArray(source: JsonObject, key: string): readonly unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

/**
 * The objects in an array, skipping anything else.
 *
 * @param values - The array.
 * @returns Its object entries, in order.
 *
 * @internal
 */
export function records(values: readonly unknown[]): readonly JsonObject[] {
  return values.filter(isRecord);
}

/**
 * Builds a property record from `[name, value]` pairs, keeping only the value types the format has.
 *
 * @param pairs - The pairs, in document order.
 * @returns The record.
 *
 * @internal
 */
export function propertyRecord(pairs: readonly (readonly [unknown, unknown])[]): PropertyRecord {
  const out: [string, string | number | boolean][] = [];
  for (const [name, value] of pairs) {
    if (typeof name !== "string" || name === "") {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out.push([name, value]);
    }
  }
  // `fromEntries` defines own properties, so a property named `__proto__` stays a property.
  return Object.fromEntries(out);
}

/**
 * Cuts a grid of frames out of a tileset image, in reading order.
 *
 * @param name - The frame-name prefix.
 * @param count - How many tiles the tileset has.
 * @param columns - Tiles per row.
 * @param cell - One tile's size, in pixels.
 * @param cell.w - The width.
 * @param cell.h - The height.
 * @param margin - The border around the grid, in pixels.
 * @param spacing - The gap between tiles, in pixels.
 * @returns The frames.
 *
 * @internal
 */
export function gridFrames(
  name: string,
  count: number,
  columns: number,
  cell: { readonly w: number; readonly h: number },
  margin: number,
  spacing: number,
): readonly AtlasFrame[] {
  const frames: AtlasFrame[] = [];
  const perRow = Math.max(1, columns);
  for (let index = 0; index < count; index += 1) {
    frames.push({
      name: `${name}_${String(index)}`,
      x: margin + (index % perRow) * (cell.w + spacing),
      y: margin + Math.floor(index / perRow) * (cell.h + spacing),
      w: cell.w,
      h: cell.h,
    });
  }
  return frames;
}

/**
 * Gives every layer a unique name by suffixing repeats with `_2`, `_3`, and so on, because the
 * tilemap format requires unique layer names and both editors allow repeats.
 *
 * @param name - The name the editor gave the layer.
 * @param taken - The names already used; the returned one is added.
 * @returns The unique name.
 *
 * @internal
 */
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${name}_${String(suffix)}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Maps items through an async function, at most `limit` at a time, keeping their order.
 *
 * @param items - The items.
 * @param limit - The most calls in flight.
 * @param map - The function.
 * @returns The results, in item order.
 *
 * @internal
 */
export async function mapLimited<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        // oxlint-disable-next-line no-await-in-loop -- the point is a bounded number in flight.
        results[index] = await map(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
