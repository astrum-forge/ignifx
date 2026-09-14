import { describe, expect, it } from "vitest";
import { TerrainErrorCode } from "../../src/errors.js";
import { decodePng, pngToRgba8, pngToSamples16 } from "../../src/heightfield/png.js";
import { encodeTestPng } from "../support/png-fixture.js";

/** A 4x4 pattern with enough variation that every filter predicts something different. */
const PATTERN: readonly number[] = Object.freeze([
  0, 32, 64, 96, 128, 160, 192, 224, 255, 200, 150, 100, 50, 25, 12, 6,
]);

describe("PNG scanline filters", () => {
  for (const filter of [0, 1, 2, 3, 4] as const) {
    it(`reverses filter ${String(filter)}`, async () => {
      const png = await decodePng(
        await encodeTestPng({ width: 4, height: 4, bitDepth: 8, channels: 1, samples: PATTERN, filter }),
      );

      expect([...png.data]).toEqual([...PATTERN]);
    });
  }

  it("reverses a filter on a multi-channel image", async () => {
    const samples = Array.from({ length: 16 }, (_value, index) => (index * 17) % 256);
    const png = await decodePng(
      await encodeTestPng({ width: 2, height: 2, bitDepth: 8, channels: 4, samples, filter: 4 }),
    );

    expect([...png.data]).toEqual(samples);
  });

  it("reverses a filter on a 16-bit image", async () => {
    const samples = [0, 1000, 40_000, 65_535];
    const png = await decodePng(
      await encodeTestPng({ width: 2, height: 2, bitDepth: 16, channels: 1, samples, filter: 1 }),
    );

    expect([...pngToSamples16(png)]).toEqual(samples);
  });
});

describe("indexed PNGs", () => {
  it("expands palette indices to RGB", async () => {
    const png = await decodePng(
      await encodeTestPng({
        width: 2,
        height: 1,
        bitDepth: 8,
        channels: 1,
        samples: [0, 1],
        palette: Uint8Array.from([10, 20, 30, 40, 50, 60]),
      }),
    );

    expect(png.channels).toBe(3);
    expect([...pngToRgba8(png)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("reads the alpha of a tRNS chunk", async () => {
    const png = await decodePng(
      await encodeTestPng({
        width: 2,
        height: 1,
        bitDepth: 8,
        channels: 1,
        samples: [0, 1],
        palette: Uint8Array.from([10, 20, 30, 40, 50, 60]),
        transparency: Uint8Array.from([0, 128]),
      }),
    );

    expect(png.channels).toBe(4);
    expect([...pngToRgba8(png)]).toEqual([10, 20, 30, 0, 40, 50, 60, 128]);
  });

  it("refuses an indexed image with no palette", async () => {
    const bytes = await encodeTestPng({
      width: 1,
      height: 1,
      bitDepth: 8,
      channels: 1,
      samples: [0],
      palette: Uint8Array.from([1, 2, 3]),
    });
    // Blank the PLTE type so the decoder never sees it, and fix the chunk's checksum is not
    // needed: the walk reads the type, not the CRC.
    const broken = Uint8Array.from(bytes);
    const at = indexOfChunk(broken, "PLTE");
    broken[at] = "X".charCodeAt(0);

    await expect(decodePng(broken, "indexed.png")).rejects.toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }),
    );
  });
});

describe("PNGs the decoder refuses", () => {
  it("refuses an Adam7 interlaced image", async () => {
    const bytes = await encodeTestPng({ width: 2, height: 2, bitDepth: 8, channels: 1, samples: [1, 2, 3, 4] });
    const broken = Uint8Array.from(bytes);
    broken[indexOfChunk(broken, "IHDR") + 4 + 12] = 1;

    await expect(decodePng(broken, "interlaced.png")).rejects.toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }),
    );
  });

  it("refuses an unknown colour type", async () => {
    const bytes = await encodeTestPng({ width: 2, height: 2, bitDepth: 8, channels: 1, samples: [1, 2, 3, 4] });
    const broken = Uint8Array.from(bytes);
    broken[indexOfChunk(broken, "IHDR") + 4 + 9] = 7;

    await expect(decodePng(broken, "odd.png")).rejects.toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }),
    );
  });

  it("refuses a bit depth below 8", async () => {
    const bytes = await encodeTestPng({ width: 2, height: 2, bitDepth: 8, channels: 1, samples: [1, 2, 3, 4] });
    const broken = Uint8Array.from(bytes);
    broken[indexOfChunk(broken, "IHDR") + 4 + 8] = 4;

    await expect(decodePng(broken, "low.png")).rejects.toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }),
    );
  });

  it("refuses a file with no IHDR", async () => {
    const bytes = await encodeTestPng({ width: 2, height: 2, bitDepth: 8, channels: 1, samples: [1, 2, 3, 4] });
    const broken = Uint8Array.from(bytes);
    broken[indexOfChunk(broken, "IHDR")] = "X".charCodeAt(0);

    await expect(decodePng(broken, "headless.png")).rejects.toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }),
    );
  });

  it("refuses a chunk that runs past the end of the file", async () => {
    const bytes = await encodeTestPng({ width: 2, height: 2, bitDepth: 8, channels: 1, samples: [1, 2, 3, 4] });
    const broken = Uint8Array.from(bytes);
    new DataView(broken.buffer).setUint32(indexOfChunk(broken, "IDAT") - 4, 1_000_000);

    await expect(decodePng(broken, "long.png")).rejects.toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }),
    );
  });
});

describe("pngToSamples16 and pngToRgba8", () => {
  it("reads a greyscale-plus-alpha image as grey with its alpha", () => {
    const png = { width: 1, height: 1, bitDepth: 8 as const, channels: 2 as const, data: Uint8Array.from([80, 40]) };

    expect([...pngToRgba8(png)]).toEqual([80, 80, 80, 40]);
    expect([...pngToSamples16(png)]).toEqual([80 * 257]);
  });

  it("drops the low byte of a 16-bit image when packing RGBA", () => {
    const png = {
      width: 1,
      height: 1,
      bitDepth: 16 as const,
      channels: 3 as const,
      data: Uint16Array.from([0x1234, 0x5678, 0x9abc]),
    };

    expect([...pngToRgba8(png)]).toEqual([0x12, 0x56, 0x9a, 255]);
  });
});

/**
 * Where a chunk's four type bytes start.
 *
 * @param bytes - The PNG.
 * @param type - The chunk type.
 * @returns The index of the first type byte.
 */
function indexOfChunk(bytes: Uint8Array, type: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const found = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    if (found === type) {
      return offset + 4;
    }
    offset += length + 12;
  }
  throw new Error(`no ${type} chunk`);
}
