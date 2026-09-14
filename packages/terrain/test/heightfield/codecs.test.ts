import { Vec3 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { TerrainErrorCode } from "../../src/errors.js";
import { HeightField } from "../../src/heightfield/height-field.js";
import { decodeRgbaImage } from "../../src/heightfield/image.js";
import { generateNoiseField, hashFloats } from "../../src/heightfield/noise.js";
import { decodePng, isPng, pngToRgba8, pngToSamples16 } from "../../src/heightfield/png.js";
import { decodeR16, encodeR16 } from "../../src/heightfield/r16.js";
import { encodeTestPng, rampHeightmapPng } from "../support/png-fixture.js";
import type { TerrainNoiseDefinition } from "../../src/definition/types.js";

/** The noise the determinism test pins. */
function fixedNoise(): TerrainNoiseDefinition {
  return { seed: 7, octaves: 4, frequency: 0.05, lacunarity: 2, persistence: 0.5, ridged: false, terraces: 0 };
}

describe(".r16 codec", () => {
  it("round-trips every sample", () => {
    const samples = Uint16Array.from([0, 1, 32_768, 65_535, 7, 9, 11, 13, 17]);

    expect([...decodeR16(encodeR16(samples), 3)]).toEqual([...samples]);
  });

  it("writes little-endian bytes", () => {
    expect([...new Uint8Array(encodeR16(Uint16Array.from([0x0102])))]).toEqual([0x02, 0x01]);
  });

  it("refuses a buffer whose length does not match the resolution", () => {
    expect(() => decodeR16(new ArrayBuffer(10), 3, "island.r16")).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.heightmapSizeMismatch }),
    );
  });
});

describe("PNG decoder", () => {
  it("recognises the signature", async () => {
    expect(isPng(await rampHeightmapPng(2, 8))).toBe(true);
    expect(isPng(Uint8Array.from([1, 2, 3]))).toBe(false);
  });

  it("decodes a 16-bit greyscale heightmap without losing a sample", async () => {
    const png = await decodePng(await rampHeightmapPng(3, 16));

    expect(png.bitDepth).toBe(16);
    expect(png.channels).toBe(1);
    expect([...pngToSamples16(png)]).toEqual([0, 8192, 16_384, 24_576, 32_768, 40_959, 49_151, 57_343, 65_535]);
  });

  it("scales an 8-bit greyscale heightmap so full white stays full height", async () => {
    const png = await decodePng(
      await encodeTestPng({ width: 2, height: 1, bitDepth: 8, channels: 1, samples: [0, 255] }),
    );

    expect(png.bitDepth).toBe(8);
    expect([...pngToSamples16(png)]).toEqual([0, 65_535]);
  });

  it("decodes RGBA to tightly packed bytes", async () => {
    const png = await decodePng(
      await encodeTestPng({ width: 1, height: 1, bitDepth: 8, channels: 4, samples: [10, 20, 30, 40] }),
    );

    expect([...pngToRgba8(png)]).toEqual([10, 20, 30, 40]);
  });

  it("refuses bytes that are not a PNG", async () => {
    await expect(decodePng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), "notes.txt")).rejects.toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }),
    );
  });

  it("refuses a PNG whose image data is truncated", async () => {
    const bytes = await rampHeightmapPng(4, 8);
    const truncated = bytes.slice(0, bytes.length - 20);

    await expect(decodePng(truncated, "short.png")).rejects.toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }),
    );
  });
});

describe("decodeRgbaImage", () => {
  it("decodes a PNG through the built-in decoder", async () => {
    const bytes = await encodeTestPng({ width: 1, height: 1, bitDepth: 8, channels: 4, samples: [1, 2, 3, 4] });
    const image = await decodeRgbaImage(bytes.slice().buffer);

    expect(image.width).toBe(1);
    expect([...image.data]).toEqual([1, 2, 3, 4]);
  });

  it("reports that Node cannot decode anything but PNG", async () => {
    await expect(
      decodeRgbaImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]).slice().buffer, "photo.jpg"),
    ).rejects.toThrow(expect.objectContaining({ code: TerrainErrorCode.unsupportedImage }));
  });
});

describe("noise", () => {
  it("produces the same field for the same seed", () => {
    const first = generateNoiseField(33, 64, 64, fixedNoise());
    const second = generateNoiseField(33, 64, 64, fixedNoise());

    expect(hashFloats(second)).toBe(hashFloats(first));
  });

  it("pins the hash of a fixed seed, so a change to the generator is visible", () => {
    // Recorded on 2026-09-14. A change here means a saved seed no longer rebuilds the same level.
    expect(hashFloats(generateNoiseField(33, 64, 64, fixedNoise()))).toBe(264_694_883);
  });

  it("produces a different field for a different seed", () => {
    const first = generateNoiseField(33, 64, 64, fixedNoise());
    const second = generateNoiseField(33, 64, 64, { ...fixedNoise(), seed: 8 });

    expect(hashFloats(second)).not.toBe(hashFloats(first));
  });

  it("normalises the field to reach both ends of 0..1", () => {
    const values = generateNoiseField(33, 64, 64, fixedNoise());

    expect(Math.min(...values)).toBeCloseTo(0, 5);
    expect(Math.max(...values)).toBeCloseTo(1, 5);
  });

  it("quantises the height into flat steps when terraces are asked for", () => {
    const values = generateNoiseField(17, 32, 32, { ...fixedNoise(), terraces: 4 });
    const levels = new Set([...values].map((value) => value.toFixed(4)));

    expect(levels.size).toBeLessThanOrEqual(4);
  });

  it("makes ridged noise differ from plain fBm", () => {
    const plain = generateNoiseField(17, 32, 32, fixedNoise());
    const ridged = generateNoiseField(17, 32, 32, { ...fixedNoise(), ridged: true });

    expect(hashFloats(ridged)).not.toBe(hashFloats(plain));
  });
});

describe("HeightField construction", () => {
  it("maps 16-bit samples onto the declared height", () => {
    const field = HeightField.fromSamples16(2, { width: 1, depth: 1, height: 10 }, Uint16Array.from([0, 65_535, 0, 0]));

    expect(field.heights[1]).toBeCloseTo(10, 5);
  });

  it("refuses a sample count that does not match the resolution", () => {
    expect(() => HeightField.fromSamples16(3, { width: 1, depth: 1, height: 1 }, new Uint16Array(4))).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.heightmapSizeMismatch }),
    );
  });

  it("refuses a normalised value count that does not match the resolution", () => {
    expect(() => HeightField.fromNormalised(3, { width: 1, depth: 1, height: 1 }, new Float32Array(4))).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.heightmapSizeMismatch }),
    );
  });

  it("refuses a height array of the wrong length", () => {
    expect(() => new HeightField(3, { width: 1, depth: 1, height: 1 }, new Float32Array(4))).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.heightmapSizeMismatch }),
    );
  });

  it("starts flat when no heights are given", () => {
    const field = new HeightField(3, { width: 2, depth: 2, height: 5 });

    expect(field.heightAt(0, 0)).toBe(0);
    expect(field.normalAt(0, 0, new Vec3()).y).toBeCloseTo(1, 6);
  });
});
