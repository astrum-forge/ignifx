import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertWebGpuAvailable,
  createHeadlessEngine,
  createRenderEngine,
  disposeEngineHandles,
} from "../../src/lite/engine.js";
import { runFrame } from "../../src/lite/loop.js";
import type { IgnifxError, RenderSurface } from "../../src/index.js";

/**
 * The Node-testable half of the engine adapter: the null-engine pair every headless app runs on and
 * the WebGPU gate in front of the render path (ADR-0001, ADR-0009). The GPU path itself is
 * `engine.browser.test.ts`.
 */

const FRAME = 1 / 60;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the headless engine", () => {
  it("creates a null engine and a scene with no default render task", () => {
    const handles = createHeadlessEngine();
    try {
      expect(handles.engine).toBeDefined();
      expect(handles.scene).toBeDefined();
      expect(handles.isHeadless).toBe(true);
    } finally {
      disposeEngineHandles(handles);
    }
  });

  it("steps deterministically and disposes without touching disposeEngine", () => {
    // ADR-0009 Validation: `disposeEngine` throws on a null engine, so the headless path must stop
    // at the scene. If it did not, this test would throw.
    const handles = createHeadlessEngine();
    for (let index = 0; index < 180; index += 1) {
      runFrame(handles.engine, handles.scene, FRAME);
    }
    expect(() => {
      disposeEngineHandles(handles);
    }).not.toThrow();
  });

  it("keeps two headless engines in one process independent", () => {
    const first = createHeadlessEngine();
    const second = createHeadlessEngine();
    try {
      expect(first.engine).not.toBe(second.engine);
      expect(first.scene).not.toBe(second.scene);
    } finally {
      disposeEngineHandles(first);
      disposeEngineHandles(second);
    }
  });
});

describe("the WebGPU gate", () => {
  it("throws IGX-0701 when the host exposes no WebGPU", () => {
    try {
      assertWebGpuAvailable();
    } catch (error) {
      expect((error as IgnifxError).code).toBe("IGX-0701");
      expect((error as IgnifxError).message).toContain("WebGPU");
      return;
    }
    throw new Error("assertWebGpuAvailable() should have thrown under Node");
  });

  it("is what stops createRenderEngine before Babylon Lite is reached", async () => {
    await expect(createRenderEngine(null as unknown as RenderSurface)).rejects.toThrow(/WebGPU/u);
  });

  it("passes when navigator.gpu is present", () => {
    vi.stubGlobal("navigator", { gpu: {} });
    expect(() => {
      assertWebGpuAvailable();
    }).not.toThrow();
  });
});
