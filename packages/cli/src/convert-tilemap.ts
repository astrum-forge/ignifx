import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { CliError, CliErrorCode } from "./errors.js";
import { canonical, compactJson, isRecord } from "./json-text.js";
import { convertLdtkProject } from "./tilemap-source/ldtk.js";
import { convertTiledMap } from "./tilemap-source/tiled.js";
import type { ImportIo } from "./import-heightmap.js";
import type { ConvertContext, ConvertedMap, JsonObject } from "./tilemap-source/model.js";

/**
 * `ignifx import tilemap <map.tmj | project.ldtk>`: converts a Tiled map or every level of an LDtk
 * project into `.tilemap.json` documents, and writes an `.atlas.json` beside each tileset image
 * that has none yet (`docs/architecture/11-2d-toolkit.md` §2.5). Pure JavaScript, no engine import:
 * `@ignifx/cli` may not depend on `@ignifx/2d` (`.dependency-cruiser.cjs`).
 */

/**
 * The usage string printed with every argument error of the Tiled and LDtk form.
 *
 * @public
 */
export const CONVERT_TILEMAP_USAGE: string =
  "Usage: ignifx import tilemap <map.tmj> [<out.tilemap.json>] [--pixels-per-unit <n>] [--drop-flips]\n" +
  "       ignifx import tilemap <project.ldtk> [<out directory>] [--pixels-per-unit <n>] [--drop-flips]";

/** The pixels one metre spans unless the command says otherwise, matching `twoD.pixelsPerUnit`. */
const DEFAULT_PIXELS_PER_UNIT = 100;

/** The suffix the engine's tilemap loader selects on. */
const TILEMAP_SUFFIX = ".tilemap.json";

/** The suffix the engine's atlas loader selects on. */
const ATLAS_SUFFIX = ".atlas.json";

/**
 * A parsed `ignifx import tilemap` invocation for a Tiled or LDtk file.
 *
 * @public
 */
export interface ConvertTilemapCommand {
  /** The `.tmj` or `.ldtk` file, exactly as the user typed it. */
  readonly source: string;
  /** Which editor wrote it. */
  readonly kind: "tiled" | "ldtk";
  /**
   * Where to write: the `.tilemap.json` for a Tiled map, the folder for an LDtk project's levels.
   * `null` writes beside the source.
   */
  readonly output: string | null;
  /** The pixels one world metre spans; sets `cellSize` and the objects' metres. Defaults to `100`. */
  readonly pixelsPerUnit: number;
  /** Whether flipped or rotated tiles import unflipped instead of failing the command. */
  readonly dropFlips: boolean;
}

/**
 * What {@link runConvertTilemap} wrote.
 *
 * @public
 */
export interface ConvertTilemapResult {
  /** The source file. */
  readonly source: string;
  /** The `.tilemap.json` files written, absolute, one per Tiled map or LDtk level. */
  readonly tilemaps: readonly string[];
  /** The `.atlas.json` files written, absolute; a tileset image that already had one keeps it. */
  readonly atlases: readonly string[];
  /** What the conversion skipped or lost, one line each. */
  readonly warnings: readonly string[];
}

/**
 * Whether a path names a file this form of the command converts: a Tiled `.tmj` or an LDtk `.ldtk`.
 *
 * @param path - The path.
 * @returns `true` for a `.tmj` or `.ldtk` file.
 *
 * @public
 */
export function isTilemapSource(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".tmj" || extension === ".ldtk";
}

/**
 * Parses the arguments of `ignifx import tilemap` for a Tiled or LDtk source.
 *
 * @param argv - The arguments after `import tilemap`.
 * @returns The parsed command.
 * @throws A {@link CliError} with code `IGX-1403` when the command line is unparseable, names no
 * `.tmj` or `.ldtk` file, names a Tiled output that does not end in `.tilemap.json`, or gives a
 * pixels-per-unit that is not a positive number.
 *
 * @example
 * ```ts
 * const command = parseConvertTilemapArgs(["maps/cave.tmj", "--pixels-per-unit", "16"]);
 * ```
 *
 * @public
 */
export function parseConvertTilemapArgs(argv: readonly string[]): ConvertTilemapCommand {
  let parsed: {
    readonly positionals: readonly string[];
    readonly ppu: string | undefined;
    readonly dropFlips: boolean | undefined;
  };
  try {
    const result = parseNodeArgs({
      args: [...argv],
      options: { "pixels-per-unit": { type: "string" }, "drop-flips": { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    parsed = {
      positionals: result.positionals,
      ppu: result.values["pixels-per-unit"],
      dropFlips: result.values["drop-flips"],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse the command line.";
    throw new CliError(CliErrorCode.invalidArguments, `${message}\n${CONVERT_TILEMAP_USAGE}`, { cause: error });
  }
  const [source, output, ...extra] = parsed.positionals;
  if (source === undefined || !isTilemapSource(source)) {
    throw new CliError(CliErrorCode.invalidArguments, `Missing <map.tmj> or <project.ldtk>.\n${CONVERT_TILEMAP_USAGE}`);
  }
  if (extra.length > 0) {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `Expected at most two paths but got ${String(parsed.positionals.length)}.\n${CONVERT_TILEMAP_USAGE}`,
    );
  }
  const kind = extname(source).toLowerCase() === ".tmj" ? "tiled" : "ldtk";
  if (kind === "tiled" && output !== undefined && !output.endsWith(TILEMAP_SUFFIX)) {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `The output "${output}" must end in ${TILEMAP_SUFFIX}, which is how the engine finds its loader.\n${CONVERT_TILEMAP_USAGE}`,
    );
  }
  const pixelsPerUnit = parsed.ppu === undefined ? DEFAULT_PIXELS_PER_UNIT : Number(parsed.ppu);
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `--pixels-per-unit needs a positive number, not "${parsed.ppu ?? ""}".\n${CONVERT_TILEMAP_USAGE}`,
    );
  }
  return { source, kind, output: output ?? null, pixelsPerUnit, dropFlips: parsed.dropFlips === true };
}

/**
 * Converts a Tiled map, or every level of an LDtk project, into `.tilemap.json` documents.
 *
 * @remarks
 * A Tiled map is written to `<out.tilemap.json>`, by default `<name>.tilemap.json` beside the
 * `.tmj`. An LDtk project writes one `<level identifier>.tilemap.json` per level into
 * `<out directory>`, by default the project's folder. Existing tilemaps are overwritten.
 *
 * Each tileset's `atlas` is `<image name>.atlas.json` beside its image, referenced relative to the
 * tilemap. When that atlas does not exist the command writes one, cutting the image into frames
 * named `<tileset name>_<index>` with `nearest` sampling; an existing atlas is kept, with a warning
 * when it lacks frames the map uses. Objects land in the map's `objects` field, which
 * `ignifx import tilemap <map.tilemap.json> <scene.scene.json>` moves into a scene (ADR-0030).
 *
 * Refused with `IGX-1408`: non-orthogonal or infinite Tiled maps, base64 or compressed layer data,
 * XML (`.tsx`) or image-collection tilesets, LDtk layers on different grid sizes, and flipped tiles
 * unless `--drop-flips` is passed. Output is deterministic: the same input writes the same bytes.
 *
 * @param argv - The arguments after `import tilemap`.
 * @param io - The injected output sinks.
 * @returns What was written.
 * @throws A {@link CliError} with code `IGX-1403` for bad arguments, `IGX-1405` when a file cannot
 * be read or written, `IGX-1407` when a file is not JSON, or `IGX-1408` for a feature the
 * tilemap format cannot hold.
 *
 * @example
 * ```ts
 * await runConvertTilemap(["assets/maps/cave.tmj", "--pixels-per-unit", "16"], io);
 * ```
 *
 * @public
 */
export async function runConvertTilemap(argv: readonly string[], io: ImportIo): Promise<ConvertTilemapResult> {
  const command = parseConvertTilemapArgs(argv);
  const source = resolve(command.source);
  const warnings: string[] = [];
  const context: ConvertContext = {
    pixelsPerUnit: command.pixelsPerUnit,
    dropFlips: command.dropFlips,
    warn: (line: string): void => {
      warnings.push(line);
    },
    readJson,
  };
  const parsed = await readJson(source);
  const maps =
    command.kind === "tiled"
      ? [await convertTiledMap(source, parsed, context)]
      : await convertLdtkProject(source, parsed, context);
  const atlases = new Map<string, ReadonlySet<string> | null>();
  const writtenAtlases: string[] = [];
  const tilemaps: string[] = [];
  for (const map of maps) {
    const target = outputPath(command, source, map);
    // oxlint-disable-next-line no-await-in-loop -- maps share atlases; the first to need one writes it, in a stable order.
    const document = await tilemapDocument(map, target, command.pixelsPerUnit, atlases, writtenAtlases, warnings);
    // oxlint-disable-next-line no-await-in-loop -- see above.
    await writeText(target, compactJson(document));
    tilemaps.push(target);
  }
  for (const line of tilemaps.map((path) => `Wrote ${shown(path)}`)) {
    io.stdout(line);
  }
  for (const path of writtenAtlases) {
    io.stdout(`Wrote ${shown(path)}`);
  }
  for (const line of warnings) {
    io.stderr(`warning: ${line}`);
  }
  return { source: command.source, tilemaps, atlases: writtenAtlases, warnings };
}

/**
 * Where one converted map is written.
 *
 * @param command - The command.
 * @param source - The source's absolute path.
 * @param map - The map.
 * @returns The absolute `.tilemap.json` path.
 */
function outputPath(command: ConvertTilemapCommand, source: string, map: ConvertedMap): string {
  if (command.kind === "tiled") {
    return command.output === null ? join(dirname(source), `${map.name}${TILEMAP_SUFFIX}`) : resolve(command.output);
  }
  const folder = command.output === null ? dirname(source) : resolve(command.output);
  // A level identifier comes from the file; keep it a plain file name so it cannot leave `folder`.
  return join(folder, `${map.name.replaceAll(/[^\w-]/gu, "_")}${TILEMAP_SUFFIX}`);
}

/**
 * Builds the `.tilemap.json` document for one map, writing each missing atlas on the way.
 *
 * @param map - The converted map.
 * @param target - Where the document goes.
 * @param pixelsPerUnit - The pixels one metre spans.
 * @param atlases - Atlas path to the frame names it holds (`null` when unreadable); shared across maps.
 * @param written - The atlases this run wrote; appended to.
 * @param warnings - The warning list; appended to.
 * @returns The document.
 */
async function tilemapDocument(
  map: ConvertedMap,
  target: string,
  pixelsPerUnit: number,
  atlases: Map<string, ReadonlySet<string> | null>,
  written: string[],
  warnings: string[],
): Promise<JsonObject> {
  const tilesets: JsonObject[] = [];
  for (const tileset of map.tilesets) {
    let atlas = "";
    if (tileset.image !== null) {
      const atlasPath = atlasPathFor(tileset.image);
      let frames = atlases.get(atlasPath);
      if (frames === undefined) {
        // oxlint-disable-next-line no-await-in-loop -- two tilesets may share an image; the first writes its atlas.
        frames = await ensureAtlas(atlasPath, tileset.image, tileset.frames, written, warnings);
        atlases.set(atlasPath, frames);
      }
      const missing = frames === null ? [] : tileset.frames.filter((frame) => !frames.has(frame.name));
      if (missing.length > 0) {
        warnings.push(
          `${shown(atlasPath)} already exists and lacks ${String(missing.length)} frame(s) tileset "${tileset.name}" uses, such as "${missing[0]?.name ?? ""}"; delete it to regenerate it.`,
        );
      }
      atlas = relative(dirname(target), atlasPath).split(sep).join("/");
    }
    tilesets.push({ name: tileset.name, atlas, firstId: tileset.firstId, tiles: tileset.tiles });
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
 * The `.atlas.json` path for a tileset image: the image's path with its extension swapped.
 *
 * @param image - The image's absolute path.
 * @returns The atlas path.
 */
function atlasPathFor(image: string): string {
  const extension = extname(image);
  return `${extension === "" ? image : image.slice(0, -extension.length)}${ATLAS_SUFFIX}`;
}

/**
 * Writes an atlas for a tileset image when none exists, or reads the frame names of the one there.
 *
 * @param atlasPath - The atlas path.
 * @param image - The image's absolute path.
 * @param frames - The frames to cut when writing.
 * @param written - The atlases this run wrote; appended to.
 * @param warnings - The warning list; appended to.
 * @returns The frame names the atlas holds, or `null` when an existing atlas cannot be read.
 */
async function ensureAtlas(
  atlasPath: string,
  image: string,
  frames: ConvertedMap["tilesets"][number]["frames"],
  written: string[],
  warnings: string[],
): Promise<ReadonlySet<string> | null> {
  if (await exists(atlasPath)) {
    try {
      const existing: unknown = JSON.parse(await readFile(atlasPath, "utf8"));
      const list = isRecord(existing) && Array.isArray(existing["frames"]) ? existing["frames"] : [];
      return new Set(list.filter(isRecord).map((frame) => String(frame["name"])));
    } catch {
      warnings.push(`${shown(atlasPath)} exists but is not JSON; it was left alone.`);
      return null;
    }
  }
  if (frames.length === 0) {
    warnings.push(`The tileset image ${shown(image)} yields no tiles, so no atlas was written for it.`);
    return new Set();
  }
  if (!(await exists(image))) {
    warnings.push(`The tileset image ${shown(image)} does not exist yet; its atlas names it anyway.`);
  }
  await writeText(
    atlasPath,
    compactJson({
      format: "ignifx.spriteatlas",
      formatVersion: 1,
      image: basename(image),
      sampling: "nearest",
      premultipliedAlpha: false,
      frames,
    }),
  );
  written.push(atlasPath);
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

/**
 * A path as the report prints it: relative to the working directory when it is inside it.
 *
 * @param path - The absolute path.
 * @returns The path to print.
 */
function shown(path: string): string {
  const fromHere = relative(resolve(), path);
  return fromHere === "" || fromHere.startsWith("..") ? path : fromHere;
}

/**
 * Whether a file exists.
 *
 * @param path - The file.
 * @returns `true` when it can be accessed.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and parses a JSON file.
 *
 * @param path - The file.
 * @returns The parsed value.
 * @throws A {@link CliError} with code `IGX-1405` when it cannot be read, or `IGX-1407` when it is
 * not JSON.
 */
async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not read "${path}".`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(CliErrorCode.invalidDocument, `"${path}" is not JSON.`, { cause: error });
  }
}

/**
 * Writes a JSON text file with a final newline, creating its folder.
 *
 * @param path - The file.
 * @param text - Its text, without the final newline.
 * @throws A {@link CliError} with code `IGX-1405` when it cannot be written.
 */
async function writeText(path: string, text: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${text}\n`, "utf8");
  } catch (error) {
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not write "${path}".`, { cause: error });
  }
}
