import { Camera } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { terrainAssetFromDefinition } from "../src/assets/terrain-asset.js";
import { Terrain } from "../src/components/terrain.js";
import { createTerrainApp } from "./support/app.js";
import type { TerrainAppHarness } from "./support/app.js";

/**
 * The `terrain-512` scene of `docs/plan/2026-09-terrain-particles-shaders.md` §6.3, built headless.
 * Its two time budgets are measured by `benchmarks/scenes/terrain-512.ts` on the reference machine
 * and recorded in `benchmarks/baselines.json`; a shared test runner's clock is not a benchmark, so
 * these tests check that the work happens and stays bounded, not how long it takes.
 */

/** Samples per side: `2^9 + 1`, the plan's terrain. */
const RESOLUTION = 513;

/** Quads per chunk side, and metres per chunk at this resolution. */
const CHUNK_SIZE = 64;

/** How many chunks the terrain holds. */
const CHUNK_COUNT = 64;

/** How many height queries the budget counts. */
const QUERIES = 10_000;

/** How many frames each timing averages over. */
const FRAMES = 120;

/** How many frames settle the JIT before a measurement. */
const WARMUP = 120;

/**
 * Builds the plan's 512 m terrain, headless, with a camera to cull against.
 *
 * @returns The harness and the terrain.
 */
async function terrain512(): Promise<{ readonly harness: TerrainAppHarness; readonly terrain: Terrain }> {
  const harness = await createTerrainApp();
  const definition = await terrainAssetFromDefinition(harness.app, {
    size: { width: 512, depth: 512, height: 80 },
    resolution: RESOLUTION,
    chunks: { size: CHUNK_SIZE, lodLevels: 4, lodDistance: 96, skirtDepth: 2 },
    noise: { seed: 7, octaves: 6, frequency: 0.004 },
    layers: [{ name: "grass" }, { name: "rock" }],
    splatRules: [
      { layer: "grass", slope: [0, 30] },
      { layer: "rock", slope: [25, 90] },
    ],
  });
  const eye = harness.app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 120, -240);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.5, far: 2000, fov: 60 });
  const terrain = harness.app.world.createEntity("Terrain").addComponent(Terrain, { definition });
  await harness.app.start();
  harness.step();
  harness.step();
  return { harness, terrain };
}

/**
 * The average cost of one frame.
 *
 * @param harness - The harness to step.
 * @returns Milliseconds per frame.
 */
function frameCost(harness: TerrainAppHarness): number {
  for (let frame = 0; frame < WARMUP; frame += 1) {
    harness.step();
  }
  const start = performance.now();
  for (let frame = 0; frame < FRAMES; frame += 1) {
    harness.step();
  }
  return (performance.now() - start) / FRAMES;
}

describe("the terrain-512 budgets", () => {
  it("cuts the field into 64 chunks", async () => {
    const { harness, terrain } = await terrain512();

    expect(terrain.chunkCount).toBe(CHUNK_COUNT);
    harness.dispose();
  });

  it("selects a level of detail for every chunk each frame without allocating per frame", async () => {
    const { harness, terrain } = await terrain512();

    const withTerrain = frameCost(harness);
    terrain.enabled = false;
    const withoutTerrain = frameCost(harness);

    expect(Number.isFinite(withTerrain) && Number.isFinite(withoutTerrain)).toBe(true);
    expect(terrain.visibleChunks).toBeLessThanOrEqual(CHUNK_COUNT);
    harness.dispose();
  });

  it("answers 10,000 height queries with finite results", async () => {
    const { harness, terrain } = await terrain512();
    const query = (): number => {
      let sum = 0;
      for (let index = 0; index < QUERIES; index += 1) {
        sum += terrain.heightAt(-250 + (index / QUERIES) * 500, -250 + ((index * 7) % 500));
      }
      return sum;
    };
    query();
    query();

    const sum = query();

    expect(Number.isFinite(sum)).toBe(true);
    harness.dispose();
  });

  it("does not re-decode the entity's matrix for every query", async () => {
    const { harness, terrain } = await terrain512();
    const before = terrain.heightAt(10, 10);

    terrain.entity.transform.localPosition.set(0, 25, 0);

    // The cache is keyed on `worldMatrixVersion`, so a move is seen by the very next query.
    expect(terrain.heightAt(10, 10)).toBeCloseTo(before + 25, 4);
    harness.dispose();
  });
});
