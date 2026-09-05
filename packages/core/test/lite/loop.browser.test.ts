import { describe, expect, it } from "vitest";
import {
  registerFrameCallback,
  startRenderLoop,
  stopRenderLoop,
  unregisterFrameCallback,
} from "../../src/lite/loop.js";
import { createWebGpuEngine, disposeWebGpuEngine } from "../../src/lite/render.js";
import { createRenderScene, disposeSceneOnly, type LiteEngine } from "../../src/lite/scene.js";

/**
 * Spike S1.2, browser half: the real requestAnimationFrame loop. `startEngine` needs a WebGPU
 * device, so this is the one part of the loop adapter that cannot be checked headlessly.
 */

describe("S1.2 · the Lite render loop", () => {
  it("registers the scene, runs frames, and stops", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);

    let runtime: LiteEngine | null = null;
    try {
      runtime = await createWebGpuEngine(canvas);
      const engine = runtime;
      const scene = createRenderScene(engine);
      try {
        const deltas: number[] = [];
        const handle = registerFrameCallback(scene, (deltaMs) => {
          deltas.push(deltaMs);
        });

        // `startEngine` resolves after the first frame has been rendered, so the callback has run
        // at least once by the time the await returns — no wall-clock sleep needed.
        await startRenderLoop(engine, scene);
        stopRenderLoop(engine);

        expect(deltas.length).toBeGreaterThan(0);
        for (const delta of deltas) {
          expect(Number.isFinite(delta)).toBe(true);
        }

        const framesAtStop = deltas.length;
        unregisterFrameCallback(handle);
        expect(handle.isActive).toBe(false);

        // Stopping twice is safe, and a stopped loop delivers no further frames.
        stopRenderLoop(engine);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
        expect(deltas).toHaveLength(framesAtStop);
      } finally {
        disposeSceneOnly(scene);
      }
    } finally {
      if (runtime !== null) {
        disposeWebGpuEngine(runtime);
      }
      canvas.remove();
    }
  });
});
