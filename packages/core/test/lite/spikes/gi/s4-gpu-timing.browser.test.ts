// Spike S4 (throwaway): does GPU timing read non-zero under Lite 1.34? Run under the default browser
// project (SwiftShader) and under vitest.spike-gpu.config.ts (host GPU, Metal on macOS).
import {
  addTask,
  createRenderTask,
  createSurfaceRenderTargetTexture,
  getRenderTaskGpuTimings,
  isGpuTimingSupported,
  registerScene,
  setGpuTimingEnabled,
  setRenderTaskGpuTimingEnabled,
} from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { createSpikeScene, device, frames } from "./harness.js";

describe("spike S4: GPU timing", () => {
  it("reports adapter, timestamp-query support, gpuFrameTimeMs and per-task timings", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const info = adapter?.info;
    const spike = await createSpikeScene(512, 1);
    try {
      const { engine, scene } = spike;
      const target = createSurfaceRenderTargetTexture(engine, {
        lbl: "spike:colour",
        format: "rgba16float",
        dFormat: "depth24plus-stencil8",
        samples: 1,
        size: engine,
      });
      addTask(scene, createRenderTask({ name: "scene", rt: target.rt }, engine, scene));
      await registerScene(scene);
      const supported = isGpuTimingSupported(engine);
      setGpuTimingEnabled(engine, true);
      await setRenderTaskGpuTimingEnabled(engine, true);
      const samples: number[] = [];
      for (let index = 0; index < 60; index += 1) {
        await frames(engine, 1);
        samples.push(engine.gpuFrameTimeMs);
      }
      const t0 = performance.now();
      await frames(engine, 1);
      const submitWall = performance.now() - t0;
      const tasks = getRenderTaskGpuTimings(engine);
      console.log(
        `[S4] adapter=${JSON.stringify({ vendor: info?.vendor, architecture: info?.architecture, description: info?.description })} ` +
          `features.timestamp-query=${String(device(engine).features.has("timestamp-query"))} isGpuTimingSupported=${String(supported)} ` +
          `gpuFrameTimeMs(last 5)=${JSON.stringify(samples.slice(-5))} nonZero=${String(samples.filter((v) => v > 0).length)}/60 ` +
          `tasks.status=${tasks.status} tasks=${JSON.stringify(tasks.tasks.map((t) => [t.name, t.durationMs]))} frame+onSubmittedWorkDone wall=${submitWall.toFixed(2)}ms`,
      );
      expect(samples.length).toBe(60);
    } finally {
      spike.dispose();
    }
  }, 120_000);
});
