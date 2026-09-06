import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import baselines from "./baselines.json" with { type: "json" };

/**
 * The allocation-free-frame gate (coding standards §7): each hot-path scene runs 600 headless steps
 * under `node --expose-gc`, the heap is settled before and after, and the growth has to stay inside
 * the ceiling `baselines.json` records.
 *
 * ## Why a child process
 *
 * The measurement needs `--expose-gc`, and Vitest 5 has no per-file way to add a V8 flag: it would
 * have to go on the whole pool, where it applies to every unit test in the run. The other option
 * the standards leave open — `test.skipIf(globalThis.gc === undefined)` — turns the gate into a
 * no-op the day someone drops the flag, which is worse than not having one. A child process either
 * measures or fails.
 *
 * ## What the numbers mean
 *
 * `growthBytes` is the process's whole `heapUsed` delta, not an allocation count, so it also carries
 * V8's own bookkeeping. What makes it a signal rather than noise is that it does **not** scale with
 * the number of entities or with the number of steps: measured 2026-09-06, the 1,000-entity scene
 * grew 9,072 bytes over 600 steps — identical across runs — while the four-entity scene grew more,
 * and quadrupling the step count did not quadruple either. One small object allocated per entity
 * per frame would show up here as tens of megabytes.
 */

/** Where the measurement script lives. */
const MEASURE_SCRIPT = fileURLToPath(new URL("./scripts/measure-heap.ts", import.meta.url));

/** How many frames each scene is stepped between the two heap readings. */
const STEPS = 600;

/** How long one scene's measurement is given. */
const MEASURE_TIMEOUT_MS = 180_000;

/** The shape `measure-heap.ts` prints. */
interface HeapMeasurement {
  /** The scene measured. */
  readonly scene: string;
  /** How many frames were stepped. */
  readonly steps: number;
  /** `heapUsed` before, in bytes. */
  readonly beforeBytes: number;
  /** `heapUsed` after, in bytes. */
  readonly afterBytes: number;
  /** The difference, in bytes. */
  readonly growthBytes: number;
}

/**
 * How many independent measurements a scene may get. A settled `heapUsed` still moves with V8's
 * GC scheduling: under a parallel `pnpm check` one reading of hello-cube came out at 734 KB
 * against a 104 KB baseline, and a rerun on an idle machine read 104 KB again. Noise only ever
 * inflates a reading, while a leak reproduces on every run, so the smallest reading is the one
 * asserted and a reading inside the ceiling ends the attempts early.
 */
const ATTEMPTS = 3;

/**
 * Runs the measurement script for one scene under `--expose-gc`, up to `ATTEMPTS` times.
 *
 * @param scene - The scene name.
 * @param ceilingBytes - The committed ceiling; a reading inside it stops the attempts.
 * @returns The measurement with the smallest growth.
 */
function measureHeap(scene: string, ceilingBytes: number): HeapMeasurement {
  let best: HeapMeasurement | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const measurement = measureHeapOnce(scene);
    if (best === null || measurement.growthBytes < best.growthBytes) {
      best = measurement;
    }
    if (best.growthBytes <= ceilingBytes) {
      break;
    }
  }
  if (best === null) {
    throw new Error(`no heap measurement was taken for ${scene}`);
  }
  return best;
}

/**
 * Runs the measurement script for one scene under `--expose-gc`, once.
 *
 * @param scene - The scene name.
 * @returns Its measurement.
 */
function measureHeapOnce(scene: string): HeapMeasurement {
  const stdout = execFileSync(process.execPath, ["--expose-gc", MEASURE_SCRIPT, scene, String(STEPS)], {
    encoding: "utf8",
    timeout: MEASURE_TIMEOUT_MS,
  });
  const line = stdout.trim().split("\n").at(-1) ?? "";
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null || !("growthBytes" in parsed)) {
    throw new TypeError(`measure-heap.ts printed something that is not a measurement: ${stdout}`);
  }
  // Boundary assertion (coding standards §5.2): a child process's stdout is untyped by definition,
  // and the shape check above is what makes reading it safe.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
  return parsed as HeapMeasurement;
}

/**
 * Asserts one scene's heap growth against its committed ceiling.
 *
 * @param scene - The scene name, as `baselines.json` keys it.
 * @param measuredBytes - What the baseline recorded.
 * @param ceilingBytes - The ceiling the baseline set.
 */
function expectBoundedGrowth(scene: string, measuredBytes: number, ceilingBytes: number): void {
  const measurement = measureHeap(scene, ceilingBytes);
  expect(measurement.scene).toBe(scene);
  expect(measurement.steps).toBe(STEPS);
  expect(
    measurement.growthBytes,
    `${scene} grew ${String(measurement.growthBytes)} bytes over ${String(STEPS)} steps. The ceiling in ` +
      `baselines.json is ${String(ceilingBytes)}; it was set from a measurement of ${String(measuredBytes)}. ` +
      "Do not raise the ceiling to make this pass — find what allocates per frame.",
  ).toBeLessThanOrEqual(ceilingBytes);
}

describe("bounded heap growth over 600 headless steps", () => {
  it("hello-cube", { timeout: MEASURE_TIMEOUT_MS }, () => {
    const baseline = baselines.heap["hello-cube"];
    expectBoundedGrowth("hello-cube", baseline.measuredBytes, baseline.ceilingBytes);
  });

  it("thousand-entities", { timeout: MEASURE_TIMEOUT_MS }, () => {
    const baseline = baselines.heap["thousand-entities"];
    expectBoundedGrowth("thousand-entities", baseline.measuredBytes, baseline.ceilingBytes);
  });
});
