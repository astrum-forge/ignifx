import { Camera, createRay, Vec3 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { terrainAssetFromDefinition } from "../../src/assets/terrain-asset.js";
import { Terrain } from "../../src/components/terrain.js";
import { TerrainErrorCode } from "../../src/errors.js";
import { createTerrainHit } from "../../src/heightfield/height-field.js";
import { createTerrainApp } from "../support/app.js";
import type { TerrainRegion } from "../../src/heightfield/height-field.js";
import type { TerrainAppHarness } from "../support/app.js";
import type { Entity } from "@ignifx/core";

/** Samples per side of the fixture terrain. */
const RESOLUTION = 17;

/** Quads per chunk side, which makes a 2x2 chunk grid. */
const CHUNK_SIZE = 8;

/** The fixture's extent in metres. */
const WIDTH = 16;

/** A terrain and the harness it lives in. */
interface Fixture {
  /** The harness. */
  readonly harness: TerrainAppHarness;
  /** The terrain component. */
  readonly terrain: Terrain;
  /** The entity it sits on. */
  readonly entity: Entity;
}

/**
 * Builds a headless app holding one terrain of flat heights, with a camera so the LOD pass runs.
 *
 * @param heights - The heights in metres, or `null` for a flat field.
 * @returns The fixture.
 */
async function fixture(heights?: Float32Array): Promise<Fixture> {
  const harness = await createTerrainApp();
  const handle = await terrainAssetFromDefinition(
    harness.app,
    {
      size: { width: WIDTH, depth: WIDTH, height: 10 },
      resolution: RESOLUTION,
      chunks: { size: CHUNK_SIZE, lodLevels: 2, lodDistance: 20, skirtDepth: 1 },
      layers: [{ name: "ground" }],
    },
    { heights: heights ?? new Float32Array(RESOLUTION * RESOLUTION).fill(2) },
  );
  const eye = harness.app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 20, -20);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 500, fov: 60 });
  const entity = harness.app.world.createEntity("Terrain");
  const terrain = entity.addComponent(Terrain, { definition: handle });
  await harness.app.start();
  // Two frames: a camera joins the world during the first, so the first LOD pass has none to cull
  // against.
  harness.step();
  harness.step();
  return { harness, terrain, entity };
}

describe("Terrain queries", () => {
  it("refuses a query before the asset is delivered", async () => {
    const harness = await createTerrainApp();
    const terrain = harness.app.world.createEntity("Terrain").addComponent(Terrain);

    expect(() => terrain.heightAt(0, 0)).toThrow(expect.objectContaining({ code: TerrainErrorCode.terrainNotLoaded }));
    harness.dispose();
  });

  it("reads the height under a world point", async () => {
    const { harness, terrain } = await fixture();

    expect(terrain.heightAt(0, 0)).toBeCloseTo(2, 5);
    expect(terrain.isLoaded).toBe(true);
    harness.dispose();
  });

  it("moves the surface with the entity", async () => {
    const { harness, terrain, entity } = await fixture();
    entity.transform.localPosition.set(100, 5, -50);

    expect(terrain.heightAt(100, -50)).toBeCloseTo(7, 5);
    harness.dispose();
  });

  it("scales the surface with the entity", async () => {
    const { harness, terrain, entity } = await fixture();
    entity.transform.localScale.set(2, 3, 2);

    expect(terrain.heightAt(0, 0)).toBeCloseTo(6, 5);
    harness.dispose();
  });

  it("answers a flat terrain with an upward normal", async () => {
    const { harness, terrain } = await fixture();

    expect(terrain.normalAt(0, 0, new Vec3()).y).toBeCloseTo(1, 5);
    expect(terrain.slopeAt(0, 0)).toBeCloseTo(0, 4);
    harness.dispose();
  });

  it("reports its size and resolution", async () => {
    const { harness, terrain } = await fixture();

    expect(terrain.size).toEqual({ width: WIDTH, depth: WIDTH, height: 10 });
    expect(terrain.resolution).toBe(RESOLUTION);
    expect(terrain.heights.length).toBe(RESOLUTION * RESOLUTION);
    harness.dispose();
  });

  it("maps a world point to a sample and back", async () => {
    const { harness, terrain } = await fixture();
    const sample = terrain.worldToSample(0, 0, new Float32Array(2));

    expect(sample[0]).toBeCloseTo((RESOLUTION - 1) / 2, 5);
    const world = terrain.sampleToWorld(0, 0, new Vec3());
    expect(world.x).toBeCloseTo(-WIDTH / 2, 5);
    expect(world.y).toBeCloseTo(2, 5);
    harness.dispose();
  });

  it("reports a world bounding box that covers the field", async () => {
    const { harness, terrain, entity } = await fixture();
    entity.transform.localPosition.set(10, 1, 10);
    const bounds = terrain.bounds(new Float32Array(6));

    expect(bounds[0]).toBeCloseTo(10 - WIDTH / 2, 5);
    expect(bounds[1]).toBeCloseTo(3, 5);
    expect(bounds[4]).toBeCloseTo(3, 5);
    expect(bounds[3]).toBeCloseTo(10 + WIDTH / 2, 5);
    harness.dispose();
  });

  it("raycasts against the surface in world space", async () => {
    const { harness, terrain, entity } = await fixture();
    entity.transform.localPosition.set(0, 5, 0);
    const ray = createRay();
    ray.origin.x = 0;
    ray.origin.y = 30;
    ray.origin.z = 0;
    ray.direction.x = 0;
    ray.direction.y = -1;
    ray.direction.z = 0;
    ray.length = 100;
    const hit = createTerrainHit();

    expect(terrain.raycast(ray, hit)).toBe(true);
    expect(hit.point.y).toBeCloseTo(7, 1);
    expect(hit.distance).toBeCloseTo(23, 1);
    harness.dispose();
  });

  it("misses a ray that never reaches the terrain", async () => {
    const { harness, terrain } = await fixture();
    const ray = createRay();
    ray.origin.x = 500;
    ray.origin.y = 30;
    ray.origin.z = 500;
    ray.direction.x = 0;
    ray.direction.y = -1;
    ray.direction.z = 0;
    ray.length = 100;

    expect(terrain.raycast(ray, createTerrainHit())).toBe(false);
    harness.dispose();
  });

  it("warns once that a rotated terrain is read as if it were not", async () => {
    const { harness, entity } = await fixture();
    entity.transform.localEulerAngles = { x: 0, y: 30, z: 0 };

    harness.step();
    harness.step();

    const warnings = harness.log
      .toArray()
      .filter((record) => record.message.includes(TerrainErrorCode.rotationUnsupported));
    expect(warnings).toHaveLength(1);
    harness.dispose();
  });
});

describe("Terrain chunking", () => {
  it("cuts the field into chunks", async () => {
    const { harness, terrain } = await fixture();

    expect(terrain.chunkCount).toBe(4);
    harness.dispose();
  });

  it("counts every chunk as visible when there is nothing to cull against", async () => {
    const { harness, terrain } = await fixture();

    expect(terrain.visibleChunks).toBe(4);
    expect(terrain.drawCalls).toBe(4);
    harness.dispose();
  });

  it("keeps the finest level under a close camera and coarsens for a far one", async () => {
    const { harness, terrain } = await fixture();

    expect(terrain.lodOf(0, 0)).toBe(0);

    const camera = harness.app.world.mainCamera;
    camera?.entity.transform.localPosition.set(0, 400, -400);
    harness.step();

    expect(terrain.lodOf(0, 0)).toBe(1);
    harness.dispose();
  });

  it("hides every chunk once the camera turns away from the terrain", async () => {
    const { harness, terrain } = await fixture();
    const camera = harness.app.world.mainCamera;

    expect(terrain.visibleChunks).toBe(4);

    camera?.entity.transform.lookAt({ x: 0, y: 200, z: -400 });
    harness.step();

    expect(terrain.visibleChunks).toBe(0);
    harness.dispose();
  });

  it("draws every chunk when frustum culling is off", async () => {
    const { harness, terrain } = await fixture();
    const camera = harness.app.world.mainCamera;
    terrain.frustumCulling = false;

    camera?.entity.transform.lookAt({ x: 0, y: 200, z: -400 });
    harness.step();

    expect(terrain.visibleChunks).toBe(4);
    harness.dispose();
  });

  it("answers a level for a chunk outside the grid with zero", async () => {
    const { harness, terrain } = await fixture();

    expect(terrain.lodOf(-1, 0)).toBe(0);
    expect(terrain.lodOf(99, 99)).toBe(0);
    harness.dispose();
  });

  it("publishes its counters through app.diagnostics", async () => {
    const { harness, terrain } = await fixture();
    const group = harness.app.diagnostics.group("terrain");

    expect(group?.get(group.index("chunks"))).toBe(terrain.chunkCount);
    expect(group?.get(group.index("drawCalls"))).toBe(terrain.visibleChunks);
    harness.dispose();
  });

  it("forgets its chunks when the component is removed", async () => {
    const { harness, terrain, entity } = await fixture();

    entity.removeComponent(terrain);
    harness.step();

    expect(terrain.chunkCount).toBe(0);
    harness.dispose();
  });
});

describe("Terrain.setHeights", () => {
  it("writes the heights and reports the region it changed", async () => {
    const { harness, terrain } = await fixture();
    const regions: TerrainRegion[] = [];
    terrain.onHeightsChanged.connect((region) => regions.push(region), { owner: terrain });

    terrain.setHeights(4, 4, 2, 2, Float32Array.from([5, 5, 5, 5]));

    expect(terrain.heights[4 * RESOLUTION + 4]).toBeCloseTo(5, 5);
    expect(regions).toEqual([{ x: 4, z: 4, width: 2, depth: 2 }]);
    harness.dispose();
  });

  it("changes what a query answers", async () => {
    const { harness, terrain } = await fixture();
    const before = terrain.heightAt(-WIDTH / 2, -WIDTH / 2);

    terrain.setHeights(0, 0, 1, 1, Float32Array.from([9]));

    expect(before).toBeCloseTo(2, 5);
    expect(terrain.heightAt(-WIDTH / 2, -WIDTH / 2)).toBeCloseTo(9, 5);
    harness.dispose();
  });

  it("refuses a region outside the field", async () => {
    const { harness, terrain } = await fixture();

    expect(() => terrain.setHeights(RESOLUTION - 1, 0, 4, 4, new Float32Array(16))).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.regionOutOfRange }),
    );
    harness.dispose();
  });
});

describe("Terrain.setSplat", () => {
  it("writes a layer's weights over a rectangle", async () => {
    const harness = await createTerrainApp();
    const handle = await terrainAssetFromDefinition(harness.app, {
      size: { width: WIDTH, depth: WIDTH, height: 10 },
      resolution: RESOLUTION,
      chunks: { size: CHUNK_SIZE, lodLevels: 2 },
      layers: [{ name: "grass" }, { name: "rock" }],
    });
    const terrain = harness.app.world.createEntity("Terrain").addComponent(Terrain, { definition: handle });
    await harness.app.start();
    harness.step();
    harness.step();

    terrain.setSplat(1, 0, 0, 2, 2, Uint8Array.from([200, 200, 200, 200]));

    const control = handle.value.control;
    expect(control.maps[0]?.[1]).toBe(200);
    harness.dispose();
  });

  it("refuses a layer index the terrain does not declare", async () => {
    const { harness, terrain } = await fixture();

    expect(() => terrain.setSplat(4, 0, 0, 1, 1, Uint8Array.from([255]))).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.unknownLayer }),
    );
    harness.dispose();
  });

  it("refuses a rectangle outside the control map", async () => {
    const { harness, terrain } = await fixture();

    expect(() => terrain.setSplat(0, 1000, 0, 1, 1, Uint8Array.from([255]))).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.regionOutOfRange }),
    );
    harness.dispose();
  });
});
