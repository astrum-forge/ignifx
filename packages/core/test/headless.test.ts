import { describe, expect, it } from "vitest";
import {
  createHeadlessRuntime,
  disposeHeadlessRuntime,
  ErrorCode,
  IgnifxError,
  isWebGpuAvailable,
  stepHeadless,
} from "../src/index.js";

const FIXED_STEP_SECONDS = 1 / 60;

describe("headless runtime", () => {
  it("creates a null engine and a scene without a default render task", () => {
    const runtime = createHeadlessRuntime();
    try {
      expect(runtime.lite.engine).toBeDefined();
      expect(runtime.lite.scene).toBeDefined();
      expect(runtime.isDisposed).toBe(false);
    } finally {
      disposeHeadlessRuntime(runtime);
    }
  });

  it("steps a fixed number of times without throwing", () => {
    const runtime = createHeadlessRuntime();
    try {
      expect(() => {
        for (let index = 0; index < 180; index += 1) {
          stepHeadless(runtime, FIXED_STEP_SECONDS);
        }
      }).not.toThrow();
    } finally {
      disposeHeadlessRuntime(runtime);
    }
  });

  it("runs two independent runtimes in one process", () => {
    // CONSTITUTION.md §3.6: no ambient singletons — two apps must coexist.
    const first = createHeadlessRuntime();
    const second = createHeadlessRuntime();
    try {
      expect(first.lite.engine).not.toBe(second.lite.engine);
      expect(first.lite.scene).not.toBe(second.lite.scene);
      for (let index = 0; index < 10; index += 1) {
        stepHeadless(first, FIXED_STEP_SECONDS);
        stepHeadless(second, FIXED_STEP_SECONDS);
      }
      disposeHeadlessRuntime(first);
      expect(first.isDisposed).toBe(true);
      expect(second.isDisposed).toBe(false);
      expect(() => stepHeadless(second, FIXED_STEP_SECONDS)).not.toThrow();
    } finally {
      disposeHeadlessRuntime(first);
      disposeHeadlessRuntime(second);
    }
  });

  it("reports disposal and refuses to step afterwards", () => {
    const runtime = createHeadlessRuntime();
    disposeHeadlessRuntime(runtime);
    expect(runtime.isDisposed).toBe(true);
    // Disposing twice is a documented no-op.
    disposeHeadlessRuntime(runtime);
    expect(() => stepHeadless(runtime, FIXED_STEP_SECONDS)).toThrow(IgnifxError);
    try {
      stepHeadless(runtime, FIXED_STEP_SECONDS);
    } catch (error) {
      expect(error).toBeInstanceOf(IgnifxError);
      expect((error as IgnifxError).code).toBe("IGX-0002");
    }
  });

  it("rejects objects it did not create", () => {
    const foreign = { lite: { engine: undefined, scene: undefined }, isDisposed: false };
    // The shape matches structurally, so the guard has to be nominal.
    expect(() => stepHeadless(foreign as never, FIXED_STEP_SECONDS)).toThrow(/createHeadlessRuntime/u);
    expect(() => disposeHeadlessRuntime(foreign as never)).toThrow(IgnifxError);
  });
});

describe("WebGPU capability probe", () => {
  it("reports WebGPU as unavailable under Node", () => {
    expect(isWebGpuAvailable()).toBe(false);
  });
});

describe("IgnifxError", () => {
  it("carries a stable code and keeps the cause", () => {
    const cause = new Error("underlying");
    const error = new IgnifxError(ErrorCode.webGpuUnavailable, "no gpu", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("IgnifxError");
    expect(error.code).toBe("IGX-0001");
    expect(error.cause).toBe(cause);
  });
});
