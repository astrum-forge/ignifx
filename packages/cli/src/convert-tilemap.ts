import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { CliError, CliErrorCode } from "./errors.js";
import { convertTilemapSource } from "./tilemap-source/convert.js";
import type { ImportIo } from "./import-heightmap.js";
import type { TilemapSourceKind } from "./tilemap-source/convert.js";

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

/**
 * A parsed `ignifx import tilemap` invocation for a Tiled or LDtk file.
 *
 * @public
 */
export interface ConvertTilemapCommand {
  /** The `.tmj` or `.ldtk` file, exactly as the user typed it. */
  readonly source: string;
  /** Which editor wrote it. */
  readonly kind: TilemapSourceKind;
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
 * unless `--drop-flips` is passed, and maps past `DEFAULT_TILEMAP_SOURCE_LIMITS`. Output is
 * deterministic: the same input writes the same bytes. This is a file wrapper over the pure
 * `convertTilemapSource` of `@ignifx/cli/tilemap`.
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
  const output = command.output === null ? null : resolve(command.output);
  // Paths are relative to the deepest folder holding both the map and its output.
  const folder = commonFolder(
    dirname(source),
    output === null ? dirname(source) : command.kind === "tiled" ? dirname(output) : output,
  );
  const text = await readText(source);
  if (text === null) {
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not read "${source}".`);
  }
  const converted = await convertTilemapSource(text, command.kind, async (path) => readText(resolve(folder, path)), {
    path: toPosix(relative(folder, source)),
    ...(output === null ? {} : { output: toPosix(relative(folder, output)) || "." }),
    pixelsPerUnit: command.pixelsPerUnit,
    dropFlips: command.dropFlips,
    // A map on disk may use tilesets in any folder, and its atlases go beside them.
    allowOutsideBase: true,
    exists: async (path) => exists(resolve(folder, path)),
  });
  const tilemaps: string[] = [];
  const atlases: string[] = [];
  for (const document of converted.documents) {
    const target = resolve(folder, document.path);
    // oxlint-disable-next-line no-await-in-loop -- written in order, so a failure leaves a predictable prefix.
    await writeText(target, document.text);
    (document.kind === "tilemap" ? tilemaps : atlases).push(target);
  }
  for (const path of [...tilemaps, ...atlases]) {
    io.stdout(`Wrote ${shown(path)}`);
  }
  for (const line of converted.warnings) {
    io.stderr(`warning: ${line}`);
  }
  return { source: command.source, tilemaps, atlases, warnings: converted.warnings };
}

/**
 * The deepest folder holding two folders.
 *
 * @param a - One absolute folder.
 * @param b - The other.
 * @returns Their common ancestor.
 */
function commonFolder(a: string, b: string): string {
  let folder = a;
  while (relative(folder, b).startsWith("..") && dirname(folder) !== folder) {
    folder = dirname(folder);
  }
  return folder;
}

/**
 * A native relative path in POSIX form.
 *
 * @param path - The path.
 * @returns The path with `/` separators.
 */
function toPosix(path: string): string {
  return path.split(sep).join("/");
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
 * Reads a UTF-8 text file.
 *
 * @param path - The file.
 * @returns The text, or `null` when there is no such file.
 * @throws A {@link CliError} with code `IGX-1405` when it exists but cannot be read.
 */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not read "${path}".`, { cause: error });
  }
}

/**
 * Whether a file-system error says the file is not there.
 *
 * @param error - The error.
 * @returns `true` for `ENOENT` and `ENOTDIR`.
 */
function isMissing(error: unknown): boolean {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Writes a text file, creating its folder.
 *
 * @param path - The file.
 * @param text - Its text.
 * @throws A {@link CliError} with code `IGX-1405` when it cannot be written.
 */
async function writeText(path: string, text: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
  } catch (error) {
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not write "${path}".`, { cause: error });
  }
}
