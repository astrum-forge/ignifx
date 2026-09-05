import { describe, expect, it } from "vitest";
import { isWebGpuAvailable } from "../../src/index.js";
import { createRenderEngine, disposeEngineHandles } from "../../src/lite/engine.js";
import type { EngineHandles } from "../../src/lite/engine.js";

/**
 * The GPU half of the engine adapter. This file only passes if Chromium really handed out a WebGPU
 * adapter and Babylon Lite could build a device against it (spike S0.1, kept as the adapter's
 * compatibility check).
 */
describe("the WebGPU engine (real browser)", () => {
  it("exposes navigator.gpu and hands out an adapter", async () => {
    expect(isWebGpuAvailable()).toBe(true);
    await expect(navigator.gpu.requestAdapter()).resolves.not.toBeNull();
  });

  it("creates an engine and a render scene bound to a canvas, and releases both", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);

    let handles: EngineHandles | null = null;
    try {
      handles = await createRenderEngine(canvas);
      expect(handles.engine).toBeDefined();
      expect(handles.scene).toBeDefined();
      expect(handles.isHeadless).toBe(false);
    } finally {
      if (handles !== null) {
        disposeEngineHandles(handles);
      }
      canvas.remove();
    }
  });

  it("creates two independent engines in one page", async () => {
    // CONSTITUTION.md §3.6: no ambient singletons.
    const first = document.createElement("canvas");
    const second = document.createElement("canvas");
    document.body.append(first, second);
    const handles = await Promise.all([createRenderEngine(first), createRenderEngine(second)]);
    try {
      expect(handles[0].engine).not.toBe(handles[1].engine);
      expect(handles[0].scene).not.toBe(handles[1].scene);
    } finally {
      for (const entry of handles) {
        disposeEngineHandles(entry);
      }
      first.remove();
      second.remove();
    }
  });
});
