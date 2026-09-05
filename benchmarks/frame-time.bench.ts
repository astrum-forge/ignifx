import { afterAll, beforeAll, test } from "vitest";
import { createHelloCubeScene } from "./scenes/hello-cube.ts";
import { createThousandEntitiesScene } from "./scenes/thousand-entities.ts";
import type { BenchScene } from "./scenes/types.ts";

/**
 * How long one headless frame costs, per scene (`CONSTITUTION.md` §6.4).
 *
 * These numbers are **reported, not asserted**. `vitest bench` measures wall-clock throughput on
 * whatever machine runs it, and a shared CI runner's ops/sec says more about the runner than about
 * the engine; the budgets standards §7 asserts — 60 fps per template, ≤ 4 ms of engine CPU per
 * frame in a 3D template — are millisecond budgets on a real device, which the browser job owns.
 * What belongs here is the trend: a human reads `benchmarks/baselines.json` next to a fresh run and
 * sees whether a change moved the shape of the curve.
 *
 * `app.step(1 / 60)` is one whole frame: the fixed loop, every script callback, the component sync
 * systems, and the render-sync pass on Lite's null engine.
 *
 * Vitest 5 moved benchmarking behind a **test-context fixture**: `bench` is no longer a top-level
 * export, a benchmark is registered inside a `test` in a file matched by `benchmark.include`, and
 * `bench.compare` runs the registrations and prints the table. Run it with `pnpm bench`.
 */

/** The frame length every step uses, in seconds. */
const STEP_SECONDS = 1 / 60;

let helloCube: BenchScene | null = null;
let thousandEntities: BenchScene | null = null;

beforeAll(async () => {
  helloCube = await createHelloCubeScene();
  thousandEntities = await createThousandEntitiesScene();
});

afterAll(() => {
  helloCube?.dispose();
  thousandEntities?.dispose();
  helloCube = null;
  thousandEntities = null;
});

test("app.step, headless", async ({ bench }) => {
  await bench.compare(
    bench("hello-cube (4 entities)", () => {
      helloCube?.app.step(STEP_SECONDS);
    }),
    bench("thousand-entities (1,002 entities)", () => {
      thousandEntities?.app.step(STEP_SECONDS);
    }),
  );
});
