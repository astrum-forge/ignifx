import { posix } from "node:path";
import { CliError, CliErrorCode } from "../errors.js";
import { canonical, compactJson, isRecord } from "../json-text.js";
import { convertLdtkProject } from "./ldtk.js";
import { CellBudget, DEFAULT_TILEMAP_SOURCE_LIMITS } from "./model.js";
import { convertTiledMap } from "./tiled.js";
import type { ConvertContext, ConvertedMap, JsonObject, TilemapSourceLimits } from "./model.js";

/**
 * The pure core of `ignifx import tilemap <map.tmj | project.ldtk>`: a map's text in, the documents
 * to write out. It touches no file system; the caller reads what the map references through a
 * callback and writes the result. `runConvertTilemap` is the file wrapper over it.
 */

/**
 * Which editor wrote a map source: a Tiled JSON map (`.tmj`) or an LDtk project (`.ldtk`). The same
 * names as `ConvertTilemapCommand.kind`.
 *
 * @public
 */
export type TilemapSourceKind = "tiled" | "ldtk";

/**
 * Reads a file a map source references (an external `.tsj` tileset, an `.ldtkl` level, or an
 * existing `.atlas.json`) as UTF-8 text.
 *
 * @remarks
 * The path is a normalised POSIX path relative to the base folder of the conversion (see
 * {@link ConvertTilemapSourceOptions.path}), resolved from what the map (or the tileset holding
 * it) wrote. Unless {@link ConvertTilemapSourceOptions.allowOutsideBase} is set, it is checked
 * before the call: never absolute, never above the base folder, and free of `:`, `\` and NUL; a
 * reference that is not is refused with `IGX-1408` instead. Each path is read at most once. `null`
 * means the file does not exist: a required file then fails the conversion with `IGX-1405`, and an
 * atlas is generated.
 *
 * @param path - The file, relative to the base folder.
 * @returns The text, or `null` when there is no such file.
 *
 * @public
 */
export type TilemapSourceReader = (path: string) => Promise<string | null>;

/**
 * Options of {@link convertTilemapSource}.
 *
 * @public
 */
export interface ConvertTilemapSourceOptions {
  /**
   * The map file's POSIX path relative to the base folder every path of the conversion is relative
   * to (usually the project root), such as `assets/maps/cave.tmj`: what the map references resolves
   * against its folder, a Tiled map's tilemap is named after it, and messages name it. Defaults to
   * `map.tmj` or `project.ldtk`, which makes the map's own folder the base.
   */
  readonly path?: string;
  /**
   * Where the tilemaps go, relative to the base folder: the `.tilemap.json` path for a Tiled map (by
   * default `<name>.tilemap.json` beside the map), the folder for an LDtk project's levels (by
   * default the map's folder). It may not climb above the base folder.
   */
  readonly output?: string;
  /**
   * Lets the map's references, and so the generated atlases, reach outside the base folder: absolute
   * paths and paths above it. Off by default, when such a reference is refused with `IGX-1408` before
   * `read` or `exists` sees it, so every {@link TilemapSourceDocument.path} stays inside the base
   * folder. `ignifx import tilemap` sets it, because a map on disk may use tilesets in any folder.
   * A path holding NUL is refused either way.
   */
  readonly allowOutsideBase?: boolean;
  /** The pixels one world metre spans; sets `cellSize` and the objects' metres. Defaults to `100`. */
  readonly pixelsPerUnit?: number;
  /** Whether flipped or rotated tiles import unflipped (with a warning) instead of failing. */
  readonly dropFlips?: boolean;
  /**
   * Caps over {@link DEFAULT_TILEMAP_SOURCE_LIMITS}; a hostile map past one fails with `IGX-1408`. A
   * member that is absent or `undefined` keeps its default.
   */
  readonly limits?: Partial<TilemapSourceLimits>;
  /**
   * Whether a file exists, for the warning about a tileset image that is not there yet. Without it,
   * images are not checked.
   */
  readonly exists?: (path: string) => Promise<boolean>;
}

/**
 * One document a conversion produces.
 *
 * @public
 */
export interface TilemapSourceDocument {
  /**
   * Where it goes: a normalised POSIX path relative to the base folder, never above it, absolute,
   * or holding `:`, `\` or NUL, unless {@link ConvertTilemapSourceOptions.allowOutsideBase} is set
   * (then an atlas beside a tileset image may be absolute or start with `..`).
   */
  readonly path: string;
  /** A `.tilemap.json` per Tiled map or LDtk level, or an `.atlas.json` generated for a tileset image. */
  readonly kind: "tilemap" | "atlas";
  /** The document. */
  readonly json: Readonly<Record<string, unknown>>;
  /** The document as `ignifx import tilemap` writes it: compact JSON with a final newline. */
  readonly text: string;
}

/**
 * What {@link convertTilemapSource} produces.
 *
 * @public
 */
export interface ConvertedTilemapSource {
  /**
   * The documents to write: the tilemaps in map order, then the atlases generated for tileset images
   * that had none (an existing atlas is kept and not listed).
   */
  readonly documents: readonly TilemapSourceDocument[];
  /** What the conversion skipped or lost, one line each. */
  readonly warnings: readonly string[];
}

/** The pixels one metre spans unless the options say otherwise, matching `twoD.pixelsPerUnit`. */
const DEFAULT_PIXELS_PER_UNIT = 100;

/** The suffix the engine's tilemap loader selects on. */
const TILEMAP_SUFFIX = ".tilemap.json";

/** The suffix the engine's atlas loader selects on. */
const ATLAS_SUFFIX = ".atlas.json";

/**
 * Converts a Tiled map, or every level of an LDtk project, into `.tilemap.json` documents and the
 * atlases their tileset images lack, without touching the file system.
 *
 * @remarks
 * The same conversion as `ignifx import tilemap`, which is a thin file wrapper over this function:
 * each tileset's `atlas` is `<image name>.atlas.json` beside its image, referenced relative to the
 * tilemap; an atlas `read` cannot find is generated (frames named `<tileset name>_<index>`,
 * `nearest` sampling), and an existing one is kept, with a warning when it lacks frames the map
 * uses. Every path is a POSIX path relative to one base folder (`options.path` is the map's).
 * Output is deterministic.
 *
 * Refused with `IGX-1408`: non-orthogonal or infinite Tiled maps, base64 or compressed layer data,
 * XML (`.tsx`) or image-collection tilesets, LDtk layers on different grid sizes, flipped tiles
 * unless `dropFlips` is set, and anything past {@link ConvertTilemapSourceOptions.limits} (map and
 * layer size, layer and level count, tiles per tileset, JSON length), which is checked before the
 * conversion allocates for it.
 *
 * @param text - The map file's text.
 * @param kind - Which editor wrote it.
 * @param read - Reads the files the map references.
 * @param options - Name, output, scale, flip policy and limits.
 * @returns The documents to write, and the warnings.
 * @throws A `CliError` with code `IGX-1403` for an output above the base folder or a pixels per
 * unit that is not positive, `IGX-1405` when `read` finds no file the map needs, `IGX-1407` when a
 * file is not JSON, or `IGX-1408` for a feature the tilemap format cannot hold or a limit.
 *
 * @example
 * ```ts
 * const { documents } = await convertTilemapSource(text, "tiled", async (path) => files.get(path) ?? null, {
 *   path: "assets/maps/cave.tmj",
 *   pixelsPerUnit: 16,
 * });
 * ```
 *
 * @public
 */
export async function convertTilemapSource(
  text: string,
  kind: TilemapSourceKind,
  read: TilemapSourceReader,
  options?: ConvertTilemapSourceOptions,
): Promise<ConvertedTilemapSource> {
  const allowOutside = options?.allowOutsideBase === true;
  const fileName = posix.normalize(options?.path ?? (kind === "tiled" ? "map.tmj" : "project.ldtk"));
  confine(fileName, fileName, "the map", allowOutside);
  const pixelsPerUnit = options?.pixelsPerUnit ?? DEFAULT_PIXELS_PER_UNIT;
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `pixelsPerUnit must be a positive number, not ${String(pixelsPerUnit)}.`,
    );
  }
  const limits = mergeLimits(options?.limits);
  const warnings: string[] = [];
  const total = { length: 0 };
  const cache = new Map<string, Promise<unknown>>();
  const readJson = async (path: string): Promise<unknown> => {
    confine(path, fileName, "a referenced file", allowOutside);
    let pending = cache.get(path);
    if (pending === undefined) {
      pending = read(path).then((found) => {
        if (found === null) {
          throw new CliError(CliErrorCode.fileNotAccessible, `Could not read ${JSON.stringify(path)}.`);
        }
        return parseJson(path, found, limits, total);
      });
      cache.set(path, pending);
    }
    return pending;
  };
  const context: ConvertContext = {
    pixelsPerUnit,
    dropFlips: options?.dropFlips === true,
    warn: (line: string): void => {
      warnings.push(line);
    },
    readJson,
    budget: new CellBudget(limits),
  };
  const parsed = parseJson(fileName, text, limits, total);
  const maps =
    kind === "tiled"
      ? [await convertTiledMap(fileName, parsed, context)]
      : await convertLdtkProject(fileName, parsed, context);
  const atlas: AtlasState = {
    frames: new Map(),
    written: [],
    warnings,
    read,
    exists: options?.exists,
    limits,
    total,
    fileName,
    allowOutside,
  };
  const documents: TilemapSourceDocument[] = [];
  const taken = new Set<string>();
  for (const map of maps) {
    const target = uniqueTarget(outputPath(kind, fileName, options?.output, map), taken, map.name, warnings);
    confine(target, fileName, "the output", false);
    // oxlint-disable-next-line no-await-in-loop -- maps share atlases; the first to need one makes it, in a stable order.
    const json = await tilemapDocument(map, target, pixelsPerUnit, atlas);
    documents.push(documentOf(target, "tilemap", json));
  }
  return { documents: [...documents, ...atlas.written], warnings };
}

/** What building the tilemaps of one conversion shares about atlases. */
interface AtlasState {
  /** Atlas path to the frame names it holds (`null` when unreadable). */
  readonly frames: Map<string, ReadonlySet<string> | null>;
  /** The atlases generated so far. */
  readonly written: TilemapSourceDocument[];
  /** The warning list. */
  readonly warnings: string[];
  /** Reads an existing atlas. */
  readonly read: TilemapSourceReader;
  /** Checks a tileset image, when the caller can. */
  readonly exists: ((path: string) => Promise<boolean>) | undefined;
  /** The limits, for the JSON length of an existing atlas. */
  readonly limits: TilemapSourceLimits;
  /** The JSON characters read so far. */
  readonly total: { length: number };
  /** The map's path, for messages. */
  readonly fileName: string;
  /** Whether references may leave the base folder. */
  readonly allowOutside: boolean;
}

/**
 * The limits with the caller's caps over the defaults; an `undefined` member keeps its default.
 *
 * @param caps - The caller's caps.
 * @returns The limits.
 */
function mergeLimits(caps: Partial<TilemapSourceLimits> | undefined): TilemapSourceLimits {
  const merged: Record<keyof TilemapSourceLimits, number> = { ...DEFAULT_TILEMAP_SOURCE_LIMITS };
  for (const key of Object.keys(merged) as (keyof TilemapSourceLimits)[]) {
    const value = caps?.[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Refuses a path a conversion may not touch: one holding NUL, and unless references may leave the
 * base folder, one that is absolute, climbs above the base folder, or holds `:` (a drive letter or
 * URL scheme) or `\`.
 *
 * @param path - The normalised path.
 * @param fileName - The map, for the message.
 * @param what - What the path is, for the message.
 * @param allowOutside - Whether paths outside the base folder are allowed.
 * @throws A `CliError` with code `IGX-1408` for a refused path.
 */
function confine(path: string, fileName: string, what: string, allowOutside: boolean): void {
  const outside =
    !allowOutside && (posix.isAbsolute(path) || path.includes(":") || path.includes("\\") || leadingUps(path) > 0);
  if (path.includes("\0") || outside) {
    throw new CliError(
      CliErrorCode.unsupportedTilemapSource,
      `${JSON.stringify(fileName)} names ${JSON.stringify(path)} as ${what}, which is outside the base folder the conversion may reach (absolute, above it, or holding ":", "\\" or NUL). Move the file under the base folder, or pass allowOutsideBase for a trusted map.`,
    );
  }
}

/**
 * Keeps two maps from writing one file: a later map whose path is taken (ignoring case, as some
 * file systems do) gets `_2`, `_3`, … before the suffix, with a warning.
 *
 * @param target - The path the map would get.
 * @param taken - The paths given so far, lower-cased; the returned one is added.
 * @param name - The map's name, for the warning.
 * @param warnings - The warning list.
 * @returns The unique path.
 */
function uniqueTarget(target: string, taken: Set<string>, name: string, warnings: string[]): string {
  let candidate = target;
  const stem = target.slice(0, -TILEMAP_SUFFIX.length);
  for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix += 1) {
    candidate = `${stem}_${String(suffix)}${TILEMAP_SUFFIX}`;
  }
  if (candidate !== target) {
    warnings.push(`Level ${JSON.stringify(name)} would overwrite ${target}, so it was written to ${candidate}.`);
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Parses JSON text, after checking its length.
 *
 * @param path - The file, for messages.
 * @param text - Its text.
 * @param limits - The limits.
 * @param total - The characters read so far; this file's are added.
 * @returns The value.
 * @throws A `CliError` with code `IGX-1408` past `maxJsonLength`, or `IGX-1407` when it is not JSON.
 */
function parseJson(path: string, text: string, limits: TilemapSourceLimits, total: { length: number }): unknown {
  total.length += text.length;
  if (total.length > limits.maxTotalJsonLength) {
    throw new CliError(
      CliErrorCode.unsupportedTilemapSource,
      `${JSON.stringify(path)} brings the JSON read to ${String(total.length)} characters, over the import limit of ${String(limits.maxTotalJsonLength)} (maxTotalJsonLength). Split the map, or raise limits.maxTotalJsonLength if the file is trusted.`,
    );
  }
  if (text.length > limits.maxJsonLength) {
    throw new CliError(
      CliErrorCode.unsupportedTilemapSource,
      `"${path}" is ${String(text.length)} characters long, over the import limit of ${String(limits.maxJsonLength)} (maxJsonLength). Split the map, or raise limits.maxJsonLength if the file is trusted.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(CliErrorCode.invalidDocument, `"${path}" is not JSON.`, { cause: error });
  }
}

/**
 * Wraps a document with its path, kind and text.
 *
 * @param path - Where it goes.
 * @param kind - What it is.
 * @param json - The document.
 * @returns The output entry.
 */
function documentOf(path: string, kind: TilemapSourceDocument["kind"], json: JsonObject): TilemapSourceDocument {
  return { path, kind, json, text: `${compactJson(json)}\n` };
}

/**
 * Where one converted map goes.
 *
 * @param kind - The source kind.
 * @param fileName - The map file's name.
 * @param output - The caller's output, if any.
 * @param map - The map.
 * @returns The `.tilemap.json` path, relative to the map's folder.
 */
function outputPath(kind: TilemapSourceKind, fileName: string, output: string | undefined, map: ConvertedMap): string {
  const folder = posix.dirname(fileName);
  const target =
    kind === "tiled"
      ? posix.normalize(output ?? posix.join(folder, `${map.name}${TILEMAP_SUFFIX}`))
      : // A level identifier comes from the file; keep it a plain file name so it cannot leave the folder.
        posix.join(output ?? folder, `${map.name.replaceAll(/[^\w-]/gu, "_")}${TILEMAP_SUFFIX}`);
  if (leadingUps(target) > 0 || posix.isAbsolute(target)) {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `The output "${target}" is not inside the base folder the paths are relative to; pick a base that holds the map's output.`,
    );
  }
  return target;
}

/**
 * Builds the `.tilemap.json` document for one map, generating each missing atlas on the way.
 *
 * @param map - The converted map.
 * @param target - Where the document goes.
 * @param pixelsPerUnit - The pixels one metre spans.
 * @param atlas - The atlas state shared across maps.
 * @returns The document.
 */
async function tilemapDocument(
  map: ConvertedMap,
  target: string,
  pixelsPerUnit: number,
  atlas: AtlasState,
): Promise<JsonObject> {
  const tilesets: JsonObject[] = [];
  for (const tileset of map.tilesets) {
    let address = "";
    if (tileset.image !== null) {
      const atlasPath = atlasPathFor(tileset.image);
      const owner = `tileset ${JSON.stringify(tileset.name)}`;
      confine(tileset.image, atlas.fileName, `the image of ${owner}`, atlas.allowOutside);
      confine(atlasPath, atlas.fileName, `the atlas of ${owner}`, atlas.allowOutside);
      let frames = atlas.frames.get(atlasPath);
      if (frames === undefined) {
        // oxlint-disable-next-line no-await-in-loop -- two tilesets may share an image; the first makes its atlas.
        frames = await ensureAtlas(atlasPath, tileset.image, tileset.frames, atlas);
        atlas.frames.set(atlasPath, frames);
      }
      const missing = frames === null ? [] : tileset.frames.filter((frame) => !frames.has(frame.name));
      if (missing.length > 0) {
        atlas.warnings.push(
          `${atlasPath} already exists and lacks ${String(missing.length)} frame(s) tileset "${tileset.name}" uses, such as "${missing[0]?.name ?? ""}"; delete it to regenerate it.`,
        );
      }
      address = relativePath(posix.dirname(target), atlasPath);
    }
    tilesets.push({ name: tileset.name, atlas: address, firstId: tileset.firstId, tiles: tileset.tiles });
  }
  return {
    format: "ignifx.tilemap",
    formatVersion: 1,
    tileWidth: map.tileWidth,
    tileHeight: map.tileHeight,
    cellSize: canonical(map.tileWidth / pixelsPerUnit),
    width: map.width,
    height: map.height,
    tilesets,
    layers: map.layers.map(packLayer),
    ...(map.objects.length === 0 ? {} : { objects: map.objects }),
    ...(Object.keys(map.properties).length === 0 ? {} : { properties: map.properties }),
  };
}

/**
 * The path from one folder to a file, both relative to the map's folder, which may climb above it.
 *
 * @param from - The folder.
 * @param to - The file.
 * @returns The relative POSIX path.
 */
function relativePath(from: string, to: string): string {
  if (posix.isAbsolute(to)) {
    // Only with `allowOutsideBase`: an absolute reference has no path from the base folder.
    return to;
  }
  // Anchor both under a virtual root deep enough that no `..` reaches its top, so the answer does
  // not depend on the process's working directory.
  const depth = Math.max(leadingUps(from), leadingUps(to)) + 1;
  const root = `/${"r/".repeat(depth)}`;
  return posix.relative(posix.join(root, from), posix.join(root, to));
}

/**
 * How many `..` segments a normalised relative path starts with.
 *
 * @param path - The path.
 * @returns The count.
 */
function leadingUps(path: string): number {
  const segments = posix.normalize(path).split("/");
  let count = 0;
  while (segments[count] === "..") {
    count += 1;
  }
  return count;
}

/**
 * The `.atlas.json` path for a tileset image: the image's path with its extension swapped.
 *
 * @param image - The image's path.
 * @returns The atlas path.
 */
function atlasPathFor(image: string): string {
  const extension = posix.extname(image);
  return `${extension === "" ? image : image.slice(0, -extension.length)}${ATLAS_SUFFIX}`;
}

/**
 * Generates an atlas for a tileset image when none exists, or reads the frame names of the one there.
 *
 * @param atlasPath - The atlas path.
 * @param image - The image's path.
 * @param frames - The frames to cut when generating.
 * @param atlas - The shared atlas state.
 * @returns The frame names the atlas holds, or `null` when an existing atlas cannot be read.
 */
async function ensureAtlas(
  atlasPath: string,
  image: string,
  frames: ConvertedMap["tilesets"][number]["frames"],
  atlas: AtlasState,
): Promise<ReadonlySet<string> | null> {
  const existing = await atlas.read(atlasPath);
  if (existing !== null) {
    let parsed: unknown;
    atlas.total.length += existing.length;
    try {
      parsed =
        existing.length > atlas.limits.maxJsonLength || atlas.total.length > atlas.limits.maxTotalJsonLength
          ? null
          : JSON.parse(existing);
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      atlas.warnings.push(`${atlasPath} exists but is not JSON; it was left alone.`);
      return null;
    }
    const list = isRecord(parsed) && Array.isArray(parsed["frames"]) ? parsed["frames"] : [];
    return new Set(list.filter(isRecord).map((frame) => String(frame["name"])));
  }
  if (frames.length === 0) {
    atlas.warnings.push(`The tileset image ${image} yields no tiles, so no atlas was written for it.`);
    return new Set();
  }
  if (atlas.exists !== undefined && !(await atlas.exists(image))) {
    atlas.warnings.push(`The tileset image ${image} does not exist yet; its atlas names it anyway.`);
  }
  atlas.written.push(
    documentOf(atlasPath, "atlas", {
      format: "ignifx.spriteatlas",
      formatVersion: 1,
      image: posix.basename(image),
      sampling: "nearest",
      premultipliedAlpha: false,
      frames,
    }),
  );
  return new Set(frames.map((frame) => frame.name));
}

/**
 * Stores a layer's tiles run-length encoded when that is shorter than the dense list.
 *
 * @param layer - The layer, with dense `tiles`.
 * @returns The layer as written.
 */
function packLayer(layer: JsonObject): JsonObject {
  const tiles = layer["tiles"];
  if (!Array.isArray(tiles)) {
    return layer;
  }
  const rle: number[] = [];
  let index = 0;
  while (index < tiles.length) {
    const value: unknown = tiles[index];
    let count = 1;
    while (index + count < tiles.length && tiles[index + count] === value) {
      count += 1;
    }
    rle.push(count, typeof value === "number" ? value : 0);
    index += count;
  }
  return rle.length < tiles.length ? { ...layer, tiles: { rle } } : layer;
}
