import { Camera, isIgnifxError, Light, MeshAsset, TextureAsset } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { terrainAssetFromDefinition } from "../src/assets/terrain-asset.js";
import { TerrainScatter } from "../src/components/terrain-scatter.js";
import { Terrain } from "../src/components/terrain.js";
import { createFoliageMaterial } from "../src/material/foliage.js";
import { createTerrainBrowserApp, SETTLE_FRAMES } from "./support/browser-harness.js";
import { solidLayerPng } from "./support/png-fixture.js";
import type { TerrainBrowserApp } from "./support/browser-harness.js";
import type { TerrainAsset } from "../src/assets/terrain-asset.js";
import type { TerrainDefinitionInput } from "../src/definition/types.js";
import type { AssetHandle, Entity, ErrorReport } from "@ignifx/core";

/** Samples per side of the fixture terrains; four chunks of eight quads. */
const RESOLUTION = 17;

/** The fixture's extent in metres. */
const WIDTH = 32;

/** How many chunks a fixture terrain holds. */
const CHUNKS = 4;

/**
 * Heights that rise along X, so a LOD switch is visible and the slope rules have something to paint.
 *
 * @returns The heights, in metres.
 */
function rampHeights(): Float32Array {
  const heights = new Float32Array(RESOLUTION * RESOLUTION);
  for (let iz = 0; iz < RESOLUTION; iz += 1) {
    for (let ix = 0; ix < RESOLUTION; ix += 1) {
      heights[iz * RESOLUTION + ix] = ix * 0.4;
    }
  }
  return heights;
}

/**
 * The `IGX-####` codes an app reported, for a "this did not fail" assertion.
 *
 * @param reports - What `app.onError` emitted.
 * @returns One code per report, or `"unknown"` for a failure that carries none.
 */
function codesOf(reports: readonly ErrorReport[]): readonly string[] {
  return reports.map((report) => (isIgnifxError(report.error) ? report.error.code : "unknown"));
}

/** A terrain drawing on a device. */
interface Scene {
  /** The harness. */
  readonly harness: TerrainBrowserApp;
  /** The terrain. */
  readonly terrain: Terrain;
  /** The camera's entity. */
  readonly eye: Entity;
  /** The terrain's entity. */
  readonly ground: Entity;
}

/**
 * Builds a started app drawing one terrain, lit by one directional light.
 *
 * @param input - Overrides for the terrain definition.
 * @param files - Fixture files the definition names.
 * @returns The scene.
 */
async function scene(input?: TerrainDefinitionInput, files?: Record<string, Uint8Array>): Promise<Scene> {
  const harness = await createTerrainBrowserApp(files === undefined ? {} : { files });
  const handle: AssetHandle<TerrainAsset> = await terrainAssetFromDefinition(
    harness.app,
    {
      size: { width: WIDTH, depth: WIDTH, height: 16 },
      resolution: RESOLUTION,
      chunks: { size: 8, lodLevels: 3, lodDistance: 24, skirtDepth: 1 },
      layers: [{ name: "ground", color: [0.2, 0.7, 0.3] }],
      ...input,
    },
    { heights: rampHeights() },
  );
  const eye = harness.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 18, -24);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 400, fov: 60, clearColor: { r: 0, g: 0, b: 0, a: 1 } });
  const sun = harness.world.createEntity("Sun");
  sun.transform.localPosition.set(-20, 30, -20);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  sun.addComponent(Light, { type: "directional", intensity: 3 });
  const ground = harness.world.createEntity("Terrain");
  const terrain = ground.addComponent(Terrain, { definition: handle });
  await harness.start();
  await harness.advance(SETTLE_FRAMES);
  return { harness, terrain, eye, ground };
}

describe("a terrain on a real device", () => {
  it("draws its chunks and reports no shader failure", async () => {
    const { harness, terrain } = await scene();

    expect(terrain.material).not.toBeNull();
    expect(codesOf(harness.errors)).not.toContain("IGX-0715");
    const pixel = await harness.centrePixel();
    expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(0);
    harness.dispose();
  });

  it("draws at most one call per chunk", async () => {
    const { harness, terrain } = await scene();

    expect(terrain.chunkCount).toBe(CHUNKS);
    expect(terrain.drawCalls).toBeLessThanOrEqual(CHUNKS);
    expect(terrain.drawCalls).toBeGreaterThan(0);
    harness.dispose();
  });

  it("drops draw calls when the terrain leaves the frustum", async () => {
    const { harness, terrain, eye } = await scene();
    const before = terrain.drawCalls;

    eye.transform.lookAt({ x: 0, y: 400, z: -400 });
    await harness.advance(SETTLE_FRAMES);

    expect(before).toBeGreaterThan(0);
    expect(terrain.drawCalls).toBeLessThan(before);
    harness.dispose();
  });

  it("draws fewer chunks with half the terrain behind the camera", async () => {
    const { harness, terrain, eye } = await scene();
    const all = terrain.drawCalls;

    eye.transform.localPosition.set(0, 2, 0);
    eye.transform.lookAt({ x: 0, y: 2, z: 40 });
    await harness.advance(SETTLE_FRAMES);

    expect(terrain.drawCalls).toBeLessThan(all);
    harness.dispose();
  });

  it("switches a chunk's level of detail with the camera distance", async () => {
    const { harness, terrain, eye } = await scene();

    expect(terrain.lodOf(0, 0)).toBe(0);

    eye.transform.localPosition.set(0, 200, -200);
    eye.transform.lookAt({ x: 0, y: 0, z: 0 });
    await harness.advance(SETTLE_FRAMES);

    expect(terrain.lodOf(0, 0)).toBeGreaterThan(0);
    harness.dispose();
  });

  it("keeps drawing after a sculpt", async () => {
    const { harness, terrain } = await scene();

    terrain.setHeights(0, 0, 4, 4, Float32Array.from(Array.from<number>({ length: 16 }).fill(9)));
    await harness.advance(SETTLE_FRAMES);

    expect(harness.errors).toEqual([]);
    const pixel = await harness.centrePixel();
    expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(0);
    harness.dispose();
  });
});

describe("the generated splat shader", () => {
  it("compiles with four layers", async () => {
    const { harness } = await scene({
      layers: [
        { name: "a", color: [0.8, 0.2, 0.2] },
        { name: "b", color: [0.2, 0.8, 0.2] },
        { name: "c", color: [0.2, 0.2, 0.8] },
        { name: "d", color: [0.8, 0.8, 0.2] },
      ],
      splatRules: [
        { layer: "a" },
        { layer: "b", slope: [10, 90] },
        { layer: "c", height: [4, 8] },
        { layer: "d", height: [8, 16] },
      ],
    });

    expect(codesOf(harness.errors)).not.toContain("IGX-0715");
    const pixel = await harness.centrePixel();
    expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(0);
    harness.dispose();
  });

  it("compiles with eight layers over two control maps", async () => {
    const layers = Array.from({ length: 8 }, (_value, index) => ({
      name: `l${String(index)}`,
      color: [index / 8, 1 - index / 8, 0.5] as readonly number[],
    }));
    const { harness } = await scene({ layers, splatRules: layers.map((layer) => ({ layer: layer.name })) });

    expect(codesOf(harness.errors)).not.toContain("IGX-0715");
    const pixel = await harness.centrePixel();
    expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(0);
    harness.dispose();
  });

  it("compiles with triplanar layers and real texture arrays", async () => {
    const files = {
      "t/grass.png": await solidLayerPng(4, [40, 200, 60, 255]),
      "t/grass_n.png": await solidLayerPng(4, [128, 128, 255, 255]),
      "t/rock.png": await solidLayerPng(4, [150, 150, 150, 255]),
    };
    const harness = await createTerrainBrowserApp({
      files: {
        ...files,
        "t/island.terrain.json": JSON.stringify({
          format: "ignifx.terrain",
          size: { width: WIDTH, depth: WIDTH, height: 16 },
          resolution: RESOLUTION,
          chunks: { size: 8, lodLevels: 2 },
          layers: [
            { name: "grass", albedo: "grass.png", normal: "grass_n.png", tiling: 6 },
            { name: "rock", albedo: "rock.png", tiling: 4, triplanar: true },
          ],
          splatRules: [
            { layer: "grass", slope: [0, 20] },
            { layer: "rock", slope: [15, 90] },
          ],
        }),
      },
    });
    const handle = await harness.load<TerrainAsset>("t/island.terrain.json");
    const eye = harness.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 18, -24);
    eye.transform.lookAt({ x: 0, y: 0, z: 0 });
    eye.addComponent(Camera, { near: 0.1, far: 400, fov: 60, clearColor: { r: 0, g: 0, b: 0, a: 1 } });
    const sun = harness.world.createEntity("Sun");
    sun.transform.localPosition.set(-20, 30, -20);
    sun.transform.lookAt({ x: 0, y: 0, z: 0 });
    sun.addComponent(Light, { type: "directional", intensity: 3 });
    harness.world.createEntity("Terrain").addComponent(Terrain, { definition: handle });
    await harness.start();
    await harness.advance(SETTLE_FRAMES);

    expect(handle.value.layers.albedo).not.toBeNull();
    expect(codesOf(harness.errors)).not.toContain("IGX-0715");
    const pixel = await harness.centrePixel();
    expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(0);
    harness.dispose();
  });
});

describe("a TerrainScatter on a real device", () => {
  it("draws its instances through the foliage material", async () => {
    const { harness, ground } = await scene();
    const albedo = TextureAsset.fromPixels(harness.app, "card", Uint8Array.from([255, 255, 255, 255]), 1, 1);
    const material = await createFoliageMaterial(harness.app, { albedo, wind: { strength: 0.3 } });
    const scatter = ground.addComponent(TerrainScatter, {
      mesh: MeshAsset.plane(harness.app, { width: 1, height: 1 }),
      material,
      density: 0.1,
      slope: { x: 0, y: 90 },
      maxInstances: 512,
    });
    await harness.advance(SETTLE_FRAMES);

    expect(scatter.count).toBeGreaterThan(0);
    expect(codesOf(harness.errors)).not.toContain("IGX-0715");
    harness.dispose();
  });
});
