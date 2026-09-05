import { describe, expect, it } from "vitest";
import { createApp, createManualClock, createMemorySink } from "../../src/index.js";
import { buildDeterminismScene, FIXED_STEP_SECONDS, hashWorldMatrices, STEP_COUNT } from "./fixtures/app-scene.js";
import { EXPECTED_APP_HASH } from "./fixtures/expected.js";

/**
 * Spike S1.3, Chromium half, at the kernel level: the same headless app, the same 600 calls to
 * `app.step(1 / 60)`, the same hash — this time inside a real browser. What is compared is the
 * whole ignifx frame (scheduler, dispatch order, accumulator, `Transform`) plus Babylon Lite's
 * transform math under V8-in-Node versus V8-in-Chromium.
 */
describe("S1.3 · kernel determinism across Node and Chromium", () => {
  it("reproduces the committed baseline hash inside Chromium", async () => {
    const app = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink() });
    try {
      const entities = buildDeterminismScene(app);
      for (let index = 0; index < STEP_COUNT; index += 1) {
        app.step(FIXED_STEP_SECONDS);
      }
      expect(hashWorldMatrices(entities)).toBe(EXPECTED_APP_HASH);
    } finally {
      app.dispose();
    }
  });
});
