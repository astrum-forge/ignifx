import { describe, expect, it } from "vitest";
import { createApp, createManualClock, createMemorySink } from "../../src/index.js";
import { buildDeterminismScene, FIXED_STEP_SECONDS, hashWorldMatrices, STEP_COUNT } from "./fixtures/app-scene.js";
import { EXPECTED_APP_HASH } from "./fixtures/expected.js";
import type { App } from "../../src/index.js";

/**
 * Spike S1.3 at the kernel level (`docs/plan/engineering-plan.md` Phase 1): the same scene built in
 * two headless apps, stepped the same number of times, hashes identically — and matches a committed
 * constant. The Chromium half asserts the same constant in `determinism.browser.test.ts`.
 */

/**
 * Builds a headless app, runs the scene, and returns the hash.
 *
 * @returns The hash and the app, so the caller can interleave runs before disposing.
 */
async function createRun(): Promise<{ app: App; hash: () => string; step: () => void }> {
  const app = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink() });
  const entities = buildDeterminismScene(app);
  return {
    app,
    hash: (): string => hashWorldMatrices(entities),
    step: (): void => {
      app.step(FIXED_STEP_SECONDS);
    },
  };
}

describe("S1.3 · kernel determinism", () => {
  it("reproduces the committed baseline hash", async () => {
    const run = await createRun();
    try {
      for (let index = 0; index < STEP_COUNT; index += 1) {
        run.step();
      }
      expect(run.hash()).toBe(EXPECTED_APP_HASH);
    } finally {
      run.app.dispose();
    }
  });

  it("produces the same hash from two apps, interleaved or not", async () => {
    const first = await createRun();
    const second = await createRun();
    try {
      for (let index = 0; index < STEP_COUNT; index += 1) {
        first.step();
        second.step();
      }
      expect(first.hash()).toBe(second.hash());
      expect(first.hash()).toBe(EXPECTED_APP_HASH);
    } finally {
      first.app.dispose();
      second.app.dispose();
    }
  });
});
