import { afterAll, beforeAll, test } from "vitest";
import { createHelloCubeScene } from "./scenes/hello-cube.ts";
import { createThousandEntitiesScene } from "./scenes/thousand-entities.ts";
import type { BenchScene } from "./scenes/types.ts";

/**
 * Report headless frame throughput for comparison with recorded baselines; do not enforce device
 * budgets on shared-runner wall time. The browser suite checks engine CPU budgets.
 * Run with `pnpm bench`; each step includes the full headless frame.
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
