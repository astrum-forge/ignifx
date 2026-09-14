import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "fast-png";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliError,
  CliErrorCode,
  encodeHeightmapR16,
  heightmapSamples,
  IMPORT_HEIGHTMAP_USAGE,
  parseImportHeightmapArgs,
  runImportHeightmap,
  type ImportIo,
} from "../src/index.js";

let workspace = "";

/**
 * Collects the lines a command writes so assertions can read them back.
 *
 * @returns The sinks and the arrays behind them.
 */
function recordingIo(): ImportIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => {
      out.push(line);
    },
    stderr: (line: string) => {
      err.push(line);
    },
  };
}

/**
 * Writes a greyscale PNG of a known ramp.
 *
 * @param path - Where to write it.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param depth - 8 or 16 bits per sample.
 * @returns The samples that were encoded, row-major.
 */
async function writeRamp(path: string, width: number, height: number, depth: 8 | 16): Promise<number[]> {
  const count = width * height;
  const maximum = depth === 16 ? 65_535 : 255;
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(Math.round((index / Math.max(1, count - 1)) * maximum));
  }
  const data = depth === 16 ? Uint16Array.from(values) : Uint8Array.from(values);
  await writeFile(path, encode({ width, height, data, depth, channels: 1 }));
  return values;
}

/**
 * Reads a `.r16` back into samples.
 *
 * @param path - The file.
 * @returns The samples, row-major.
 */
async function readR16(path: string): Promise<number[]> {
  const bytes = await readFile(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  for (let index = 0; index * 2 < bytes.byteLength; index += 1) {
    out.push(view.getUint16(index * 2, true));
  }
  return out;
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ignifx-heightmap-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("parseImportHeightmapArgs", () => {
  it("reads the input and the output", () => {
    expect(parseImportHeightmapArgs(["a.png", "b.r16"])).toEqual({ input: "a.png", output: "b.r16" });
  });

  it("refuses a command line that names only one path", () => {
    expect(() => parseImportHeightmapArgs(["a.png"])).toThrow(
      expect.objectContaining({ code: CliErrorCode.invalidArguments }),
    );
  });

  it("refuses extra positionals and prints the usage", () => {
    try {
      parseImportHeightmapArgs(["a.png", "b.r16", "c"]);
      expect.unreachable("three paths should be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain(IMPORT_HEIGHTMAP_USAGE);
    }
  });

  it("refuses an unknown flag", () => {
    expect(() => parseImportHeightmapArgs(["--depth", "8"])).toThrow(
      expect.objectContaining({ code: CliErrorCode.invalidArguments }),
    );
  });
});

describe("heightmapSamples", () => {
  it("keeps every 16-bit sample exactly", () => {
    const samples = heightmapSamples({
      width: 2,
      height: 1,
      depth: 16,
      channels: 1,
      data: Uint16Array.from([0, 65_535]),
      text: {},
    });
    expect([...samples]).toEqual([0, 65_535]);
  });

  it("scales an 8-bit sample so full white stays full height", () => {
    const samples = heightmapSamples({
      width: 2,
      height: 1,
      depth: 8,
      channels: 1,
      data: Uint8Array.from([0, 255]),
      text: {},
    });
    expect([...samples]).toEqual([0, 65_535]);
  });

  it("reads an RGB heightmap by luminance", () => {
    const samples = heightmapSamples({
      width: 1,
      height: 1,
      depth: 8,
      channels: 3,
      data: Uint8Array.from([255, 255, 255]),
      text: {},
    });
    expect(samples[0]).toBe(65_535);
  });

  it("refuses a bit depth below 8", () => {
    expect(() =>
      heightmapSamples({ width: 1, height: 1, depth: 4, channels: 1, data: Uint8Array.from([1]), text: {} }),
    ).toThrow(expect.objectContaining({ code: CliErrorCode.unsupportedHeightmap }));
  });

  it("refuses an indexed PNG, whose indices are not heights", () => {
    expect(() =>
      heightmapSamples({
        width: 1,
        height: 1,
        depth: 8,
        channels: 1,
        data: Uint8Array.from([1]),
        text: {},
        palette: [[0, 0, 0]],
      }),
    ).toThrow(expect.objectContaining({ code: CliErrorCode.unsupportedHeightmap }));
  });
});

describe("encodeHeightmapR16", () => {
  it("writes samples little-endian", () => {
    const bytes = encodeHeightmapR16(Uint16Array.from([0x0102]));
    expect([...bytes]).toEqual([0x02, 0x01]);
  });
});

describe("ignifx import heightmap", () => {
  it("converts a 16-bit PNG without changing a sample", async () => {
    const input = join(workspace, "island.png");
    const output = join(workspace, "island.r16");
    const expected = await writeRamp(input, 4, 4, 16);
    const io = recordingIo();

    const result = await runImportHeightmap([input, output], io);

    expect(result).toMatchObject({ width: 4, height: 4, bitDepth: 16 });
    expect(await readR16(output)).toEqual(expected);
    expect(io.err).toEqual([]);
  });

  it("warns that an 8-bit source is already terraced", async () => {
    const input = join(workspace, "flat.png");
    const output = join(workspace, "flat.r16");
    await writeRamp(input, 4, 4, 8);
    const io = recordingIo();

    await runImportHeightmap([input, output], io);

    expect(io.err.join("\n")).toContain(CliErrorCode.eightBitHeightmapSource);
  });

  it("reports a missing input file", async () => {
    const io = recordingIo();
    await expect(runImportHeightmap([join(workspace, "nope.png"), join(workspace, "out.r16")], io)).rejects.toThrow(
      expect.objectContaining({ code: CliErrorCode.fileNotAccessible }),
    );
  });

  it("reports an input that is not a PNG", async () => {
    const input = join(workspace, "notes.txt");
    await writeFile(input, "not a png", "utf8");
    const io = recordingIo();

    await expect(runImportHeightmap([input, join(workspace, "out.r16")], io)).rejects.toThrow(
      expect.objectContaining({ code: CliErrorCode.unsupportedHeightmap }),
    );
  });

  it("reports an output path that cannot be written", async () => {
    const input = join(workspace, "island.png");
    await writeRamp(input, 2, 2, 16);
    const io = recordingIo();

    await expect(runImportHeightmap([input, join(workspace, "missing", "out.r16")], io)).rejects.toThrow(
      expect.objectContaining({ code: CliErrorCode.fileNotAccessible }),
    );
  });
});
