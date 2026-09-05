import { describe, expect, it } from "vitest";
import { registerFrameCallback, runFrame } from "../../src/lite/loop.js";
import { createWebGpuEngine, disposeWebGpuEngine } from "../../src/lite/render.js";
import { createRenderScene, disposeSceneOnly, type LiteEngine } from "../../src/lite/scene.js";
import { EXPECTED_HASH } from "./fixtures/determinism-expected.js";
import {
  createDeterminismScene,
  FIXED_STEP_SECONDS,
  hashWorldMatrices,
  NODE_COUNT,
  STEP_COUNT,
} from "./fixtures/determinism-scene.js";

/**
 * Spike S1.3, Chromium half — "identical transforms across Node and Chromium"
 * (`docs/plan/engineering-plan.md` Phase 1).
 *
 * This is the same 50-node scene, the same 600 steps, the same one ignifx frame callback and the
 * same hash function as `determinism.test.ts`, driven this time on a **real WebGPU engine's scene**
 * with Lite's default render task attached. `stepScene` is documented for the null engine, but it is
 * engine-agnostic in 1.27.0 — it writes `engine._currentDelta` and calls `scene._update()`, which
 * fires the before-render callbacks and records no GPU work — so the render scene can be advanced
 * the same way without ever starting the rAF loop. What is compared, therefore, is Lite's transform
 * math (compose, multiply, `Float32Array` storage) under V8-in-Node versus V8-in-Chromium, plus the
 * adapter's own `readWorldMatrix` copy.
 */

/**
 * Creates a canvas attached to the document, which WebGPU needs for a real surface.
 *
 * @returns The canvas.
 */
function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  document.body.append(canvas);
  return canvas;
}

describe("S1.3 · determinism across Node and Chromium", () => {
  it("reproduces the committed baseline hash on a real WebGPU scene", async () => {
    const canvas = createCanvas();
    let runtime: LiteEngine | null = null;
    try {
      runtime = await createWebGpuEngine(canvas);
      const liteScene = createRenderScene(runtime);
      const scene = createDeterminismScene();
      try {
        registerFrameCallback(liteScene, (deltaMs) => {
          scene.advance(deltaMs);
        });
        expect(scene.nodes).toHaveLength(NODE_COUNT);

        for (let index = 0; index < STEP_COUNT; index += 1) {
          runFrame(runtime, liteScene, FIXED_STEP_SECONDS);
        }

        expect(hashWorldMatrices(scene.nodes)).toBe(EXPECTED_HASH);
      } finally {
        scene.dispose();
        disposeSceneOnly(liteScene);
      }
    } finally {
      if (runtime !== null) {
        disposeWebGpuEngine(runtime);
      }
      canvas.remove();
    }
  });

  it("produces identical hashes from two scenes on one engine", async () => {
    // CONSTITUTION.md §3.6, in the browser: two worlds sharing a page do not interfere.
    const canvas = createCanvas();
    let runtime: LiteEngine | null = null;
    try {
      runtime = await createWebGpuEngine(canvas);
      const engine = runtime;
      const firstLite = createRenderScene(engine);
      const secondLite = createRenderScene(engine);
      const first = createDeterminismScene();
      const second = createDeterminismScene();
      try {
        registerFrameCallback(firstLite, (deltaMs) => {
          first.advance(deltaMs);
        });
        registerFrameCallback(secondLite, (deltaMs) => {
          second.advance(deltaMs);
        });

        for (let index = 0; index < STEP_COUNT; index += 1) {
          runFrame(engine, firstLite, FIXED_STEP_SECONDS);
          runFrame(engine, secondLite, FIXED_STEP_SECONDS);
        }

        expect(hashWorldMatrices(first.nodes)).toBe(EXPECTED_HASH);
        expect(hashWorldMatrices(second.nodes)).toBe(EXPECTED_HASH);
      } finally {
        first.dispose();
        second.dispose();
        disposeSceneOnly(firstLite);
        disposeSceneOnly(secondLite);
      }
    } finally {
      if (runtime !== null) {
        disposeWebGpuEngine(runtime);
      }
      canvas.remove();
    }
  });
});
