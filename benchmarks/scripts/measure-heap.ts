import { createHelloCubeScene } from "../scenes/hello-cube.ts";
import { createThousandEntitiesScene } from "../scenes/thousand-entities.ts";
import type { BenchScene } from "../scenes/types.ts";

/**
 * Measures how much heap a scene keeps after N headless frames, and prints one JSON line.
 *
 * This runs as a **child process** under `node --expose-gc`, launched by `alloc.test.ts`. Vitest 5
 * has no supported way to add a V8 flag to the pool it already forked — `poolOptions.forks.execArgv`
 * reaches the pool workers, but the flag then applies to every unit test in the run rather than to
 * this one file — and `test.skipIf(globalThis.gc === undefined)` would let the allocation gate
 * disappear silently on the day someone drops the flag. A child process is the only shape that
 * either measures or fails.
 *
 * Usage: `node --expose-gc benchmarks/scripts/measure-heap.ts <scene> <steps>`.
 */

/** The scenes this script knows how to build. */
const SCENES: Readonly<Record<string, () => Promise<BenchScene>>> = {
  "hello-cube": createHelloCubeScene,
  "thousand-entities": createThousandEntitiesScene,
};

/** How many times the heap is settled before and after the measured run. */
const GC_PASSES = 4;

/** The frame length every step uses, in seconds. */
const STEP_SECONDS = 1 / 60;

/** How many frames are stepped before the "before" reading, so lazy one-off allocation is excluded. */
const WARMUP_STEPS = 600;

/** What the script prints. */
export interface HeapMeasurement {
  /** The scene measured. */
  readonly scene: string;
  /** How many frames were stepped between the two readings. */
  readonly steps: number;
  /** `heapUsed` after settling, before the measured run, in bytes. */
  readonly beforeBytes: number;
  /** `heapUsed` after settling, after the measured run, in bytes. */
  readonly afterBytes: number;
  /** The difference, in bytes. Negative means the run ended with less live data than it started. */
  readonly growthBytes: number;
}

/** Runs the collector until it stops finding anything, as far as one process can. */
function settle(): void {
  const collect = globalThis.gc;
  if (collect === undefined) {
    throw new Error("measure-heap.ts must run under `node --expose-gc`.");
  }
  for (let pass = 0; pass < GC_PASSES; pass += 1) {
    collect();
  }
}

/**
 * Steps a scene and reports the heap it kept.
 *
 * @param sceneName - The scene to build.
 * @param steps - How many frames to step between readings.
 * @returns The measurement.
 */
async function measure(sceneName: string, steps: number): Promise<HeapMeasurement> {
  const build = SCENES[sceneName];
  if (build === undefined) {
    throw new Error(`unknown scene "${sceneName}"; known scenes: ${Object.keys(SCENES).join(", ")}`);
  }
  const scene = await build();
  for (let frame = 0; frame < WARMUP_STEPS; frame += 1) {
    scene.app.step(STEP_SECONDS);
  }
  settle();
  const beforeBytes = process.memoryUsage().heapUsed;
  for (let frame = 0; frame < steps; frame += 1) {
    scene.app.step(STEP_SECONDS);
  }
  settle();
  const afterBytes = process.memoryUsage().heapUsed;
  scene.dispose();
  return { scene: sceneName, steps, beforeBytes, afterBytes, growthBytes: afterBytes - beforeBytes };
}

const sceneArgument = process.argv[2] ?? "thousand-entities";
const stepsArgument = Number.parseInt(process.argv[3] ?? "600", 10);
const measurement = await measure(sceneArgument, stepsArgument);
process.stdout.write(`${JSON.stringify(measurement)}\n`);
