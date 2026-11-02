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
  /** The absolute path of the source image, or `null` for a collision-only tileset. */
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
  /** Reads and parses a JSON file another file references, such as a `.tsj` or an `.ldtkl`. */
  readonly readJson: (path: string) => Promise<unknown>;
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
