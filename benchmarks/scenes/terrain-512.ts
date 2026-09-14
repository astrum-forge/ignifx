import { Camera, createApp, createManualClock, Light } from "@ignifx/core";
import { buildChunkGeometry, Terrain, terrain, terrainAssetFromDefinition } from "@ignifx/terrain";
import type { BenchScene } from "./types.ts";
import type { App, AssetHandle } from "@ignifx/core";
import type { TerrainAsset } from "@ignifx/terrain";

/**
 * A 512 m terrain of 64 chunks, each carrying four levels of detail — the plan's §6.3 `terrain-512`
 * row.
 *
 * ## What it is measuring
 *
 * A terrain's per-frame cost is its LOD pass: 64 distance tests, 64 frustum tests, and one
 * visibility write per chunk. Nothing else moves, so a frame must not allocate and must not scale
 * with the 13 million samples behind it. Headless there are no chunk meshes
 * (`docs/architecture/07-rendering.md` §6), which is exactly the CPU half this gate is about; the
 * draw is asserted in `packages/terrain/test/terrain.browser.test.ts`.
 *
 * {@link measureTerrain512} reports the three numbers the plan asks for; `baselines.json` records
 * them.
 */

/** Samples per side: `2^9 + 1`. */
export const TERRAIN_RESOLUTION = 513;

/** Quads per chunk side, which is also metres per chunk at this resolution. */
export const TERRAIN_CHUNK_SIZE = 64;

/** How many levels of detail each chunk carries. */
export const TERRAIN_LOD_LEVELS = 4;

/** The terrain's extent in metres. */
const TERRAIN_WIDTH = 512;

/** How far the skirts hang down, in metres. */
const SKIRT_DEPTH = 2;

/**
 * Builds the terrain asset every measurement here uses.
 *
 * @param app - The app that publishes it.
 * @returns The asset.
 */
function buildAsset(app: App): Promise<AssetHandle<TerrainAsset>> {
  return terrainAssetFromDefinition(app, {
    size: { width: TERRAIN_WIDTH, depth: TERRAIN_WIDTH, height: 80 },
    resolution: TERRAIN_RESOLUTION,
    chunks: {
      size: TERRAIN_CHUNK_SIZE,
      lodLevels: TERRAIN_LOD_LEVELS,
      lodDistance: 96,
      skirtDepth: SKIRT_DEPTH,
    },
    noise: { seed: 7, octaves: 6, frequency: 0.004 },
    layers: [{ name: "grass" }, { name: "rock" }],
    splatRules: [
      { layer: "grass", slope: [0, 30] },
      { layer: "rock", slope: [25, 90] },
    ],
  });
}

/**
 * A headless scene holding one 512 m terrain under a static camera.
 *
 * @returns The running scene.
 */
export async function createTerrain512Scene(): Promise<BenchScene> {
  const running = await createApp({
    headless: true,
    clock: createManualClock(),
    logLevel: "silent",
    extensions: [terrain()],
  });

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 120, -240);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.5, far: 2000, fov: 60 });

  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(-100, 200, -100);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  sun.addComponent(Light, { type: "directional", intensity: 3 });

  const definition = await buildAsset(running);
  running.world.createEntity("Terrain").addComponent(Terrain, { definition });

  await running.start();
  return {
    name: "terrain-512",
    app: running,
    dispose: () => {
      running.dispose();
    },
  };
}

/** What {@link measureTerrain512} reports, in milliseconds. */
export interface Terrain512Measurement {
  /** How long one LOD pass over 64 chunks takes. */
  readonly lodPassMs: number;
  /** How long 10,000 `heightAt` calls take. */
  readonly heightQueriesMs: number;
  /** How long building 64 chunks at four levels of detail takes, skirts included. */
  readonly chunkBuildMs: number;
}

/** How many height queries the plan's budget counts. */
const HEIGHT_QUERY_COUNT = 10_000;

/** How many frames each timing averages over, so one slow frame does not decide it. */
const TIMED_FRAMES = 240;

/** How many frames are stepped before a measurement, so the JIT has settled. */
const WARMUP_FRAMES = 120;

/**
 * Steps a scene and reports the average frame cost.
 *
 * @param scene - The scene to step.
 * @returns Milliseconds per frame.
 */
function frameCost(scene: BenchScene): number {
  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
    scene.app.step(1 / 60);
  }
  const start = performance.now();
  for (let frame = 0; frame < TIMED_FRAMES; frame += 1) {
    scene.app.step(1 / 60);
  }
  return (performance.now() - start) / TIMED_FRAMES;
}

/**
 * Measures the three numbers `docs/plan/2026-09-terrain-particles-shaders.md` §6.3 asks for.
 *
 * @remarks
 * The LOD pass is the difference between a frame with the terrain enabled and one without it, so
 * the app's own per-frame cost is not counted against the terrain.
 *
 * @returns The measurement, in milliseconds.
 */
export async function measureTerrain512(): Promise<Terrain512Measurement> {
  const scene = await createTerrain512Scene();
  // The LOD system builds the terrain on the first frame, so the asset is reachable after it.
  scene.app.step(1 / 60);
  const ground = scene.app.world.components(Terrain)[0];
  const field = ground?.asset?.field ?? null;
  if (ground === undefined || field === null) {
    throw new Error("terrain-512 built no terrain");
  }

  const withTerrain = frameCost(scene);
  ground.enabled = false;
  const withoutTerrain = frameCost(scene);
  ground.enabled = true;

  let sum = 0;
  const query = (): void => {
    for (let index = 0; index < HEIGHT_QUERY_COUNT; index += 1) {
      const t = index / HEIGHT_QUERY_COUNT;
      sum += ground.heightAt(-250 + t * 500, -250 + ((index * 7) % 500));
    }
  };
  query();
  query();
  const queryStart = performance.now();
  query();
  const heightQueriesMs = performance.now() - queryStart;
  if (!Number.isFinite(sum)) {
    throw new Error("terrain-512 produced a non-finite height");
  }

  const chunksPerSide = TERRAIN_WIDTH / TERRAIN_CHUNK_SIZE;
  const buildStart = performance.now();
  for (let chunkZ = 0; chunkZ < chunksPerSide; chunkZ += 1) {
    for (let chunkX = 0; chunkX < chunksPerSide; chunkX += 1) {
      for (let lod = 0; lod < TERRAIN_LOD_LEVELS; lod += 1) {
        buildChunkGeometry(field, chunkX, chunkZ, lod, TERRAIN_CHUNK_SIZE, SKIRT_DEPTH);
      }
    }
  }
  const chunkBuildMs = performance.now() - buildStart;

  scene.dispose();
  return { lodPassMs: withTerrain - withoutTerrain, heightQueriesMs, chunkBuildMs };
}
