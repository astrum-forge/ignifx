import { performance } from "node:perf_hooks";
import {
  Camera,
  createApp,
  createManualClock,
  createMaterialAsset,
  Light,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
} from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { devtools } from "../packages/devtools/src/index.js";
import baselines from "./baselines.json" with { type: "json" };
import { Rotator } from "./scenes/rotator.ts";
import type { App } from "@ignifx/core";

/**
 * The Phase 10 **zero-cost-when-closed** gate (`docs/plan/engineering-plan.md` Phase 10 exit
 * criteria, `docs/architecture/15-devtools-and-diagnostics.md` §4: *"zero cost when closed"*).
 *
 * ## What is measured
 *
 * The same 1,002-entity headless scene the frame-time table uses, stepped 600 times, in four
 * blocks: two apps with no extensions and two with `devtools()` registered and never opened, one
 * alive at a time. The statistic is the median per-frame time of each variant over its 1,200
 * samples — the median rather than the mean because one 8 ms GC pause in 1,200 frames should not
 * decide the outcome.
 *
 * Four blocks rather than two, with one app alive at a time, because construction order biases the
 * result. Measured on 2026-09-06 with two concurrent apps: with the plain app built first the
 * difference read +0.007, +0.000 and +0.016 ms, and with the devtools app built first it read
 * -0.007, -0.004 and -0.008 ms — the same magnitude, the opposite sign. Whatever is built second is
 * slightly cheaper to step. Running one variant at a time in the order plain, devtools, devtools,
 * plain gives each variant one cold position and one warm one.
 *
 * ## Why it can be asserted rather than merely reported
 *
 * A registered-but-closed devtools is supposed to be *structurally* absent, not merely cheap: it
 * registers no system, holds no subscription, and owns no DOM until `open()` is called
 * (`packages/devtools/src/service.ts`). The only thing left running is a `keydown` listener on the
 * document, which a headless app does not even install. So the expected difference is not "small",
 * it is "nothing but measurement noise" — and 0.02 ms is a hundredth of the 1.6 ms this scene
 * spends per frame.
 *
 * The recorded numbers live in `baselines.json` under `devtools`; they are one machine's, and the
 * assertion below is on the live measurement, not on them.
 */

/** How many mover entities the scene builds; with the camera and the sun that is 1,002. */
const MOVERS = 1000;

/** How many frames each app is stepped before anything is recorded. */
const WARMUP_FRAMES = 120;

/** How many frames each app is measured over. */
const MEASURED_FRAMES = 600;

/** The frame delta each step is given, in seconds. */
const STEP_SECONDS = 1 / 60;

/** How far apart the two medians may be on a quiet machine, in milliseconds. */
const BUDGET_MS = 0.02;

/**
 * How far apart they may be as a fraction of the plain median. Under `pnpm check` this file shares
 * the CPU with the rest of the suite, and contention stretches both variants' frames while the
 * difference between them grows with the noise; a fixed 0.02 ms then flags nothing but load. The
 * bound is therefore the larger of the absolute floor and this fraction of the plain median — on a
 * quiet run the floor applies, under load the fraction does — and the exact zero-cost claims
 * (no systems, no subscriptions) are asserted structurally rather than by timing.
 */
const RELATIVE_BUDGET = 0.15;

/** How long the whole measurement is given. */
const TIMEOUT_MS = 180_000;

/**
 * Builds the 1,002-entity headless scene, optionally with `devtools()` registered.
 *
 * @param withDevtools - Whether to register the extension.
 * @returns The running app.
 */
async function createScene(withDevtools: boolean): Promise<App> {
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logLevel: "silent",
    extensions: withDevtools ? [devtools()] : [],
  });
  app.registerComponents([Rotator]);

  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 30, -60);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 500, fov: 60 });

  const sun = app.world.createEntity("Sun");
  sun.transform.localPosition.set(-30, 60, -30);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  sun.addComponent(Light, { type: "directional", intensity: 3 });

  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "bench", baseColor: { r: 0.8, g: 0.5, b: 0.2, a: 1 }, roughness: 0.6 }),
    [],
  );
  const mesh = MeshAsset.box(app, { size: 0.8 });
  const side = 32;
  const spacing = 1.6;
  for (let index = 0; index < MOVERS; index += 1) {
    const entity = app.world.createEntity(`Cube ${String(index)}`);
    const column = index % side;
    const row = Math.floor(index / side);
    entity.transform.localPosition.set((column - side / 2) * spacing, 0, (row - side / 2) * spacing);
    entity.addComponent(MeshRenderer, { mesh, materials: [material] });
    entity.addComponent(Rotator, { speed: 30 + (index % 60) });
  }

  await app.start();
  return app;
}

/**
 * The median of a sample.
 *
 * @param values - The sample; it is sorted in place.
 * @returns The median.
 */
function median(values: number[]): number {
  values.sort((left: number, right: number): number => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2 : (values[middle] ?? 0);
}

/**
 * Steps one app and returns how long the step took.
 *
 * @param app - The app to step.
 * @returns The elapsed milliseconds.
 */
function stepOnce(app: App): number {
  const start = performance.now();
  app.step(STEP_SECONDS);
  return performance.now() - start;
}

describe("devtools costs nothing while it is closed", () => {
  it(
    "keeps the per-frame median within noise of an app that never registered it",
    { timeout: TIMEOUT_MS },
    async () => {
      // Four blocks, one app alive at a time — plain, devtools, devtools, plain — so neither
      // variant is always the cold first block or the warm last one, and no two 1,002-entity
      // worlds compete for cache while either is being timed.
      const order = [false, true, true, false];
      const plainSamples: number[] = [];
      const devtoolsSamples: number[] = [];
      let closedSystems = -1;
      for (let block = 0; block < order.length; block += 1) {
        const carriesDevtools = order[block] === true;
        // Sequential on purpose: the whole point of a block is that it is the only app alive
        // while it is being timed.
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above
        const app = await createScene(carriesDevtools);
        try {
          if (carriesDevtools) {
            expect(app.devtools.isOpen).toBe(false);
            closedSystems = 0;
          } else {
            expect(app.world.scenes[0]?.roots.length).toBe(MOVERS + 2);
          }
          for (let index = 0; index < WARMUP_FRAMES; index += 1) {
            app.step(STEP_SECONDS);
          }
          const into = carriesDevtools ? devtoolsSamples : plainSamples;
          for (let index = 0; index < MEASURED_FRAMES; index += 1) {
            into.push(stepOnce(app));
          }
        } finally {
          app.dispose();
        }
      }

      const plainMedian = median(plainSamples);
      const devtoolsMedian = median(devtoolsSamples);
      const difference = devtoolsMedian - plainMedian;
      // Printed, not merely asserted: the number is the deliverable, and a run that passes the
      // budget by shrinking the scene should still be visible. `no-console` bans `console.log`
      // outside `src/log/**`; writing to the stream directly is what the other benchmark scripts do.
      process.stdout.write(
        `devtools-closed: plain ${plainMedian.toFixed(4)} ms, devtools ${devtoolsMedian.toFixed(4)} ms, ` +
          `difference ${difference.toFixed(4)} ms over ${String(MEASURED_FRAMES * 2)} samples each\n`,
      );
      expect(closedSystems).toBe(0);

      const bound = Math.max(BUDGET_MS, RELATIVE_BUDGET * plainMedian);
      expect(
        Math.abs(difference),
        `A closed devtools moved the per-frame median by ${difference.toFixed(4)} ms ` +
          `(${plainMedian.toFixed(4)} ms without, ${devtoolsMedian.toFixed(4)} ms with). ` +
          `The bound is ${bound.toFixed(4)} ms (the larger of ${String(BUDGET_MS)} ms and ` +
          `${String(RELATIVE_BUDGET * 100)}% of the plain median). A closed overlay must register no ` +
          "system, hold no subscription and own no DOM — check what open() moved back into register().",
      ).toBeLessThanOrEqual(bound);
    },
  );

  it("keeps a recorded baseline that is itself inside the budget", () => {
    const recorded = baselines.devtools.closedOverlay;

    expect(recorded.entities).toBe(MOVERS + 2);
    expect(recorded.steps).toBe(MEASURED_FRAMES);
    expect(recorded.budgetMs).toBe(BUDGET_MS);
    expect(Math.abs(recorded.differenceMs)).toBeLessThanOrEqual(BUDGET_MS);
    expect(recorded.registeredSystemsWhileClosed).toBe(0);
    expect(recorded.subscriptionsWhileClosed).toBe(0);
  });
});
