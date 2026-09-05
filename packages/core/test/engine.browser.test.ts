import { describe, expect, it } from "vitest";
import { createRenderEngine, disposeRenderEngine, isWebGpuAvailable, type RenderRuntime } from "../src/index.js";

/**
 * S0.1's WebGPU proof: this file only passes if the Chromium instance really handed out a WebGPU
 * adapter and Babylon Lite could build a device against it.
 */
describe("WebGPU engine (real browser)", () => {
  it("exposes navigator.gpu", () => {
    expect(isWebGpuAvailable()).toBe(true);
  });

  it("hands out a WebGPU adapter and device", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    expect(adapter).not.toBeNull();
  });

  it("creates and disposes a WebGPU engine bound to a canvas", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);

    let runtime: RenderRuntime | null = null;
    try {
      runtime = await createRenderEngine(canvas);
      expect(runtime.lite.engine).toBeDefined();
      expect(runtime.isDisposed).toBe(false);
    } finally {
      if (runtime !== null) {
        disposeRenderEngine(runtime);
        expect(runtime.isDisposed).toBe(true);
        // Disposing twice is a documented no-op.
        disposeRenderEngine(runtime);
      }
      canvas.remove();
    }
  });

  it("creates two independent engines in one page", async () => {
    // CONSTITUTION.md §3.6: no ambient singletons.
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    document.body.append(first, second);
    const runtimes = await Promise.all([createRenderEngine(first), createRenderEngine(second)]);
    try {
      expect(runtimes[0].lite.engine).not.toBe(runtimes[1].lite.engine);
    } finally {
      for (const runtime of runtimes) {
        disposeRenderEngine(runtime);
      }
      first.remove();
      second.remove();
    }
  });
});
