import { describe, expect, it } from "vitest";
import { terrainAssetFromDefinition } from "../../src/assets/terrain-asset.js";
import { TerrainErrorCode } from "../../src/errors.js";
import { encodeR16 } from "../../src/heightfield/r16.js";
import { createTerrainApp } from "../support/app.js";
import { rampHeightmapPng, solidControlPng, solidLayerPng } from "../support/png-fixture.js";
import type { TerrainAsset } from "../../src/assets/terrain-asset.js";

/** Samples per side of the fixture terrains. */
const RESOLUTION = 17;

/**
 * Asserts that a load failed for a terrain reason. The asset service wraps a loader's failure in an
 * `AssetLoadError`, so the code under test is the cause's.
 *
 * @param load - The load in flight.
 * @param code - The `IGX-16##` code expected underneath.
 */
async function expectLoadFailure(load: Promise<unknown>, code: string): Promise<void> {
  await expect(load).rejects.toThrow(expect.objectContaining({ cause: expect.objectContaining({ code }) as unknown }));
}

/**
 * A `.r16` whose samples ramp across the field.
 *
 * @param resolution - Samples per side.
 * @returns The file's bytes.
 */
function rampR16(resolution: number): ArrayBuffer {
  const count = resolution * resolution;
  const samples = new Uint16Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = Math.round((index / (count - 1)) * 65_535);
  }
  return encodeR16(samples);
}

/**
 * The shortest `.terrain.json` that names a heightmap.
 *
 * @param source - The heightmap's address, relative to the document.
 * @returns The document, as text.
 */
function heightmapDocument(source: string): string {
  return JSON.stringify({
    format: "ignifx.terrain",
    formatVersion: 1,
    size: { width: 16, depth: 16, height: 10 },
    resolution: RESOLUTION,
    chunks: { size: 8, lodLevels: 2, lodDistance: 20, skirtDepth: 1 },
    heightmap: { source },
    layers: [{ name: "grass" }],
  });
}

describe("the .terrain.json loader", () => {
  it("loads a document whose heights come from a .r16", async () => {
    const harness = await createTerrainApp({
      files: { "t/island.terrain.json": heightmapDocument("island.r16"), "t/island.r16": rampR16(RESOLUTION) },
    });

    const handle = await harness.load<TerrainAsset>("t/island.terrain.json");

    expect(handle.value.definition.name).toBe("island");
    expect(handle.value.field.resolution).toBe(RESOLUTION);
    expect(handle.value.field.heights[0]).toBeCloseTo(0, 5);
    expect(handle.value.field.heights.at(-1)).toBeCloseTo(10, 4);
    harness.dispose();
  });

  it("loads a 16-bit PNG heightmap without warning about terracing", async () => {
    const harness = await createTerrainApp({
      files: {
        "t/island.terrain.json": heightmapDocument("island.png"),
        "t/island.png": await rampHeightmapPng(RESOLUTION, 16),
      },
    });

    await harness.load<TerrainAsset>("t/island.terrain.json");

    expect(harness.log.toArray().some((record) => record.message.includes(TerrainErrorCode.eightBitHeightmap))).toBe(
      false,
    );
    harness.dispose();
  });

  it("warns that an 8-bit PNG heightmap terraces", async () => {
    const harness = await createTerrainApp({
      files: {
        "t/island.terrain.json": heightmapDocument("island.png"),
        "t/island.png": await rampHeightmapPng(RESOLUTION, 8),
      },
    });

    await harness.load<TerrainAsset>("t/island.terrain.json");

    expect(harness.log.toArray().some((record) => record.message.includes(TerrainErrorCode.eightBitHeightmap))).toBe(
      true,
    );
    harness.dispose();
  });

  it("generates the field from noise when the document names no heightmap", async () => {
    const harness = await createTerrainApp({
      files: {
        "t/hills.terrain.json": JSON.stringify({
          format: "ignifx.terrain",
          size: { width: 16, depth: 16, height: 8 },
          resolution: RESOLUTION,
          chunks: { size: 8, lodLevels: 2 },
          noise: { seed: 3, octaves: 3, frequency: 0.1 },
        }),
      },
    });

    const handle = await harness.load<TerrainAsset>("t/hills.terrain.json");

    expect(Math.max(...handle.value.field.heights)).toBeGreaterThan(0);
    harness.dispose();
  });

  it("refuses a heightmap whose sample count does not match the resolution", async () => {
    const harness = await createTerrainApp({
      files: { "t/island.terrain.json": heightmapDocument("island.r16"), "t/island.r16": rampR16(9) },
    });

    await expectLoadFailure(
      harness.load<TerrainAsset>("t/island.terrain.json"),
      TerrainErrorCode.heightmapSizeMismatch,
    );
    harness.dispose();
  });

  it("refuses a document that is not a JSON object", async () => {
    const harness = await createTerrainApp({ files: { "t/bad.terrain.json": "[1, 2, 3]" } });

    await expectLoadFailure(harness.load<TerrainAsset>("t/bad.terrain.json"), TerrainErrorCode.invalidTerrainFile);
    harness.dispose();
  });

  it("builds layer texture arrays from the images the layers name", async () => {
    const harness = await createTerrainApp({
      files: {
        "t/two.terrain.json": JSON.stringify({
          format: "ignifx.terrain",
          size: { width: 16, depth: 16, height: 8 },
          resolution: RESOLUTION,
          chunks: { size: 8, lodLevels: 2 },
          layers: [
            { name: "grass", albedo: "grass.png", normal: "grass_n.png" },
            { name: "rock", albedo: "rock.png", triplanar: true },
          ],
          splatRules: [{ layer: "grass" }, { layer: "rock", slope: [30, 90] }],
        }),
        "t/grass.png": await solidLayerPng(4, [0, 200, 0, 255]),
        "t/grass_n.png": await solidLayerPng(4, [128, 128, 255, 255]),
        "t/rock.png": await solidLayerPng(4, [120, 120, 120, 255]),
      },
    });

    const handle = await harness.load<TerrainAsset>("t/two.terrain.json");

    expect(handle.value.layers.albedo).not.toBeNull();
    expect(handle.value.layers.normals).not.toBeNull();
    expect(handle.value.layers.hasNormal).toEqual([true, false]);
    expect(handle.value.splat.textured).toBe(true);
    harness.dispose();
  });

  it("refuses layer textures of different sizes", async () => {
    const harness = await createTerrainApp({
      files: {
        "t/two.terrain.json": JSON.stringify({
          format: "ignifx.terrain",
          size: { width: 16, depth: 16, height: 8 },
          resolution: RESOLUTION,
          chunks: { size: 8, lodLevels: 2 },
          layers: [
            { name: "grass", albedo: "grass.png" },
            { name: "rock", albedo: "rock.png" },
          ],
        }),
        "t/grass.png": await solidLayerPng(4, [0, 200, 0, 255]),
        "t/rock.png": await solidLayerPng(8, [120, 120, 120, 255]),
      },
    });

    await expectLoadFailure(harness.load<TerrainAsset>("t/two.terrain.json"), TerrainErrorCode.layerSizeMismatch);
    harness.dispose();
  });

  it("reads a painted control map instead of generating one", async () => {
    const harness = await createTerrainApp({
      files: {
        "t/painted.terrain.json": JSON.stringify({
          format: "ignifx.terrain",
          size: { width: 16, depth: 16, height: 8 },
          resolution: RESOLUTION,
          chunks: { size: 8, lodLevels: 2 },
          layers: [{ name: "grass" }, { name: "rock" }],
          splat: { control: ["splat.png"] },
        }),
        "t/splat.png": await solidControlPng(8, 1),
      },
    });

    const handle = await harness.load<TerrainAsset>("t/painted.terrain.json");

    expect(handle.value.control.size).toBe(8);
    expect(handle.value.control.maps[0]?.[1]).toBe(255);
    harness.dispose();
  });

  it("refuses a control map that is not square", async () => {
    const harness = await createTerrainApp({
      files: {
        "t/painted.terrain.json": JSON.stringify({
          format: "ignifx.terrain",
          size: { width: 16, depth: 16, height: 8 },
          resolution: RESOLUTION,
          chunks: { size: 8, lodLevels: 2 },
          layers: [{ name: "grass" }],
          splat: { control: ["splat.png"] },
        }),
        "t/splat.png": await (async (): Promise<Uint8Array> => {
          const { encodeTestPng } = await import("../support/png-fixture.js");
          return encodeTestPng({ width: 4, height: 2, bitDepth: 8, channels: 4, samples: new Uint8Array(32) });
        })(),
      },
    });

    await expectLoadFailure(harness.load<TerrainAsset>("t/painted.terrain.json"), TerrainErrorCode.unsupportedImage);
    harness.dispose();
  });

  it("registers the .r16 heightmap under its own asset type", async () => {
    const harness = await createTerrainApp({
      files: { "t/island.terrain.json": heightmapDocument("island.r16"), "t/island.r16": rampR16(RESOLUTION) },
    });

    await harness.load<TerrainAsset>("t/island.terrain.json");

    expect(harness.app.assets.get("t/island.r16")?.type).toBe("heightmap");
    harness.dispose();
  });
});

describe("terrainAssetFromDefinition", () => {
  it("builds a noise terrain with no file at all", async () => {
    const harness = await createTerrainApp();

    const handle = await terrainAssetFromDefinition(harness.app, {
      size: { width: 32, depth: 32, height: 12 },
      resolution: RESOLUTION,
      chunks: { size: 8, lodLevels: 2 },
      noise: { seed: 5, octaves: 3, frequency: 0.1 },
      layers: [{ name: "ground" }],
    });

    expect(handle.value.field.resolution).toBe(RESOLUTION);
    expect(handle.value.splat.textured).toBe(false);
    expect(Math.max(...handle.value.field.heights)).toBeGreaterThan(0);
    harness.dispose();
  });

  it("takes explicit heights", async () => {
    const harness = await createTerrainApp();
    const heights = new Float32Array(RESOLUTION * RESOLUTION).fill(3);

    const handle = await terrainAssetFromDefinition(
      harness.app,
      { size: { width: 16, depth: 16, height: 8 }, resolution: RESOLUTION, chunks: { size: 8, lodLevels: 2 } },
      { heights },
    );

    expect(handle.value.field.heightAt(0, 0)).toBeCloseTo(3, 5);
    harness.dispose();
  });

  it("refuses a definition that names a heightmap file", async () => {
    const harness = await createTerrainApp();

    await expect(
      terrainAssetFromDefinition(harness.app, {
        resolution: RESOLUTION,
        chunks: { size: 8, lodLevels: 2 },
        heightmap: { source: "island.r16" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: TerrainErrorCode.invalidTerrainFile }));
    harness.dispose();
  });

  it("shares one generated shader between two terrains of the same shape", async () => {
    const harness = await createTerrainApp();
    const input = { resolution: RESOLUTION, chunks: { size: 8, lodLevels: 2 }, layers: [{ name: "ground" }] };

    const first = await terrainAssetFromDefinition(harness.app, input);
    const second = await terrainAssetFromDefinition(harness.app, input);

    expect(second.value.shader.address).toBe(first.value.shader.address);
    harness.dispose();
  });
});
