import { readFile, writeFile } from "node:fs/promises";
import { parseArgs as parseNodeArgs } from "node:util";
import { decode } from "fast-png";
import { CliError, CliErrorCode } from "./errors.js";
import type { DecodedPng } from "fast-png";

/**
 * `ignifx import heightmap <in.png> <out.r16>`: the batch conversion path for terrain heightmaps
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.1).
 *
 * `.r16` is `@ignifx/terrain`'s canonical heightmap because it is exact in Node and in the browser
 * alike, and because no browser image API decodes a 16-bit PNG losslessly. An 8-bit source converts,
 * but the height steps it terraces into are already in the file, so the command says so.
 */

/**
 * The one-line usage string printed with every argument error.
 *
 * @public
 */
export const IMPORT_HEIGHTMAP_USAGE = "Usage: ignifx import heightmap <in.png> <out.r16>";

/** The largest value a 16-bit sample holds. */
const MAX_SAMPLE_16 = 65_535;

/** Scales an 8-bit sample to 16 bits so full white stays full height: `255 * 257 = 65535`. */
const SCALE_8_TO_16 = 257;

/** The luminance weights of Rec. 709, used when a heightmap arrives as RGB. */
const LUMA_R = 0.2126;

/** The green luminance weight. */
const LUMA_G = 0.7152;

/** The blue luminance weight. */
const LUMA_B = 0.0722;

/** Bytes per `.r16` sample. */
const BYTES_PER_SAMPLE = 2;

/**
 * A parsed `ignifx import heightmap` invocation.
 *
 * @public
 */
export interface ImportHeightmapCommand {
  /** The PNG to read, exactly as the user typed it. */
  readonly input: string;
  /** The `.r16` to write. */
  readonly output: string;
}

/**
 * The side-effecting surface {@link runImportHeightmap} is allowed to touch, injected so unit tests
 * never spawn a process (`CONSTITUTION.md` §3.6).
 *
 * @public
 */
export interface ImportIo {
  /**
   * Writes one line of progress output.
   *
   * @param line - The line, without a trailing newline.
   */
  readonly stdout: (line: string) => void;
  /**
   * Writes one line of diagnostic output.
   *
   * @param line - The line, without a trailing newline.
   */
  readonly stderr: (line: string) => void;
}

/**
 * What {@link runImportHeightmap} wrote.
 *
 * @public
 */
export interface ImportHeightmapResult {
  /** The file written. */
  readonly output: string;
  /** The heightmap's width in samples. */
  readonly width: number;
  /** The heightmap's height in samples. */
  readonly height: number;
  /** The source PNG's bit depth; `8` means the heights are already terraced. */
  readonly bitDepth: number;
}

/**
 * Parses the arguments of `ignifx import heightmap`.
 *
 * @param argv - The arguments after `import heightmap`.
 * @returns The parsed command.
 * @throws A {@link CliError} with code `IGX-1403` when the command line is unparseable or does not
 * name exactly one input and one output.
 *
 * @example
 * ```ts
 * const command = parseImportHeightmapArgs(["island.png", "island.r16"]);
 * ```
 *
 * @public
 */
export function parseImportHeightmapArgs(argv: readonly string[]): ImportHeightmapCommand {
  let positionals: readonly string[];
  try {
    positionals = parseNodeArgs({ args: [...argv], options: {}, allowPositionals: true, strict: true }).positionals;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse the command line.";
    throw new CliError(CliErrorCode.invalidArguments, `${message}\n${IMPORT_HEIGHTMAP_USAGE}`, { cause: error });
  }
  const [input, output, ...extra] = positionals;
  if (input === undefined || input === "" || output === undefined || output === "") {
    throw new CliError(CliErrorCode.invalidArguments, `Missing <in.png> or <out.r16>.\n${IMPORT_HEIGHTMAP_USAGE}`);
  }
  if (extra.length > 0) {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `Expected two paths but got ${String(positionals.length)}.\n${IMPORT_HEIGHTMAP_USAGE}`,
    );
  }
  return { input, output };
}

/**
 * Turns a decoded PNG into 16-bit height samples: greyscale as is, colour by Rec. 709 luminance,
 * 8-bit scaled so full white stays full height.
 *
 * @param png - The decoded image.
 * @param file - The file's path, for messages.
 * @returns `width * height` samples, row-major.
 * @throws A {@link CliError} with code `IGX-1404` when the bit depth is below 8, or the image is
 * indexed, which carries no meaningful height.
 *
 * @public
 */
export function heightmapSamples(png: DecodedPng, file = "<memory>"): Uint16Array {
  if (png.depth !== 8 && png.depth !== 16) {
    throw new CliError(
      CliErrorCode.unsupportedHeightmap,
      `"${file}" is ${String(png.depth)}-bit; a heightmap needs 8 or 16 bits per sample.`,
    );
  }
  if (png.palette !== undefined) {
    throw new CliError(
      CliErrorCode.unsupportedHeightmap,
      `"${file}" is an indexed PNG, whose palette indices are not heights. Export it as greyscale.`,
    );
  }
  const count = png.width * png.height;
  const out = new Uint16Array(count);
  const scale = png.depth === 16 ? 1 : SCALE_8_TO_16;
  const channels = png.channels;
  const data = png.data;
  for (let index = 0; index < count; index += 1) {
    const base = index * channels;
    const value =
      channels >= 3
        ? LUMA_R * (data[base] ?? 0) + LUMA_G * (data[base + 1] ?? 0) + LUMA_B * (data[base + 2] ?? 0)
        : (data[base] ?? 0);
    out[index] = Math.min(MAX_SAMPLE_16, Math.round(value * scale));
  }
  return out;
}

/**
 * Encodes samples as little-endian `.r16` bytes.
 *
 * @param samples - The samples, row-major.
 * @returns The file's bytes.
 *
 * @public
 */
export function encodeHeightmapR16(samples: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setUint16(index * BYTES_PER_SAMPLE, samples[index] ?? 0, true);
  }
  return bytes;
}

/**
 * Reads a PNG heightmap and writes the `.r16` `@ignifx/terrain` loads.
 *
 * @param argv - The arguments after `import heightmap`.
 * @param io - The injected output sinks.
 * @returns What was written.
 * @throws A {@link CliError} with code `IGX-1403` for bad arguments, `IGX-1404` for a PNG this
 * command cannot read, or `IGX-1405` when a file cannot be read or written.
 *
 * @example
 * ```ts
 * await runImportHeightmap(["island.png", "island.r16"], { stdout: log, stderr: log });
 * ```
 *
 * @public
 */
export async function runImportHeightmap(argv: readonly string[], io: ImportIo): Promise<ImportHeightmapResult> {
  const command = parseImportHeightmapArgs(argv);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(command.input);
  } catch (error) {
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not read "${command.input}".`, { cause: error });
  }
  let png: DecodedPng;
  try {
    png = decode(bytes);
  } catch (error) {
    throw new CliError(CliErrorCode.unsupportedHeightmap, `"${command.input}" is not a PNG this build can read.`, {
      cause: error,
    });
  }
  const samples = heightmapSamples(png, command.input);
  try {
    await writeFile(command.output, encodeHeightmapR16(samples));
  } catch (error) {
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not write "${command.output}".`, { cause: error });
  }
  io.stdout(`Wrote ${command.output}: ${String(png.width)}x${String(png.height)} samples, 16-bit little-endian.`);
  if (png.depth === 8) {
    io.stderr(
      `${CliErrorCode.eightBitHeightmapSource} "${command.input}" is 8-bit, so the heights are already ` +
        "terraced. Re-export the source at 16 bits for a smooth terrain.",
    );
  }
  return { output: command.output, width: png.width, height: png.height, bitDepth: png.depth };
}
