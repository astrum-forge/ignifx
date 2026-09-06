import { buildFrameGraphTask, getFrameGraph } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import {
  disableGpuTiming,
  enableLiteErrorDecoding,
  readDrawCallCount,
  readGpuFrameTimeMs,
  resolveMaxDevicePixelRatio,
  toLiteEngineOptions,
} from "../../../src/lite/render-diagnostics.js";
import { createHeadlessScene } from "../../../src/lite/scene.js";

/**
 * The engine option mapping and the counters that are plain engine properties. The GPU-timing
 * probe, the surface resize, and the per-task snapshot all dereference `engine._device`, so they
 * are checked in `render-diagnostics.browser.test.ts`.
 */

describe("mapping ignifx renderer options onto Lite's", () => {
  it("omits everything the caller left out", () => {
    expect(toLiteEngineOptions({}, 2)).toEqual({});
  });

  it("passes the surface options through unchanged", () => {
    expect(
      toLiteEngineOptions(
        {
          msaaSamples: 1,
          alphaMode: "premultiplied",
          srgb: true,
          useHighPrecisionMatrix: true,
          useFloatingOrigin: true,
        },
        1,
      ),
    ).toEqual({
      msaaSamples: 1,
      alphaMode: "premultiplied",
      srgb: true,
      useHighPrecisionMatrix: true,
      useFloatingOrigin: true,
    });
  });

  it("passes required limits through", () => {
    const limits = { maxColorAttachmentBytesPerSample: 64 };
    expect(toLiteEngineOptions({ requiredLimits: limits }, 1).requiredLimits).toBe(limits);
  });

  it("passes an explicit pixel ratio through as Lite's clamp", () => {
    expect(toLiteEngineOptions({ pixelRatio: 2 }, 1)).toEqual({ maxDevicePixelRatio: 2 });
  });

  it("exposes no powerPreference, because Lite 1.27.0 has none", () => {
    // `docs/architecture/07-rendering.md` §1 lists it; `lib/engine/engine.js` line 47 hard-codes
    // `requestAdapter({ powerPreference: "high-performance" })` and neither `EngineOptions` nor
    // `SurfaceOptions` declares the field.
    expect(Object.keys(toLiteEngineOptions({ msaaSamples: 4 }, 1))).toEqual(["msaaSamples"]);
  });
});

describe("folding pixel ratio and resolution scale into one clamp", () => {
  it("passes an explicit pixel ratio through when no scale is asked for", () => {
    expect(resolveMaxDevicePixelRatio({ pixelRatio: 1.5 }, 3)).toBe(1.5);
  });

  it("leaves the clamp unset when neither is asked for", () => {
    expect(resolveMaxDevicePixelRatio({}, 3)).toBeNull();
  });

  it("scales the host's own ratio when no clamp was given", () => {
    expect(resolveMaxDevicePixelRatio({ resolutionScale: 0.5 }, 2)).toBe(1);
  });

  it("scales an explicit clamp", () => {
    expect(resolveMaxDevicePixelRatio({ pixelRatio: 2, resolutionScale: 0.5 }, 4)).toBe(1);
  });

  it("scales the host ratio when the clamp is infinite, which is Lite's default", () => {
    expect(resolveMaxDevicePixelRatio({ pixelRatio: Number.POSITIVE_INFINITY, resolutionScale: 0.5 }, 3)).toBe(1.5);
  });

  it("clamps the scale to the documented 0.25 to 1 range", () => {
    expect(resolveMaxDevicePixelRatio({ pixelRatio: 4, resolutionScale: 0 }, 1)).toBe(1);
    expect(resolveMaxDevicePixelRatio({ pixelRatio: 4, resolutionScale: 8 }, 1)).toBe(4);
  });
});

describe("counters on the null engine", () => {
  it("reports no draw calls and no GPU time", () => {
    const { engine } = createHeadlessScene();
    expect(readDrawCallCount(engine)).toBe(0);
    expect(readGpuFrameTimeMs(engine)).toBe(0);
  });

  it("turns GPU timing off without touching a device", () => {
    const { engine } = createHeadlessScene();
    expect(() => {
      disableGpuTiming(engine);
    }).not.toThrow();
    expect(readGpuFrameTimeMs(engine)).toBe(0);
  });
});

describe("Lite's error-message decoder", () => {
  /**
   * The decoder is installed through a **dynamic** import of `src/lite/error-decoding.ts`
   * (`07-rendering.md` §5). Its 43 KB message table would otherwise sit in the entry chunk of every
   * build, because `createApp`'s `mode` defaults to `"development"` and no bundler can prove the
   * call away — measured on `examples/hello-cube`, whose entry chunk carried the table and dropped
   * 10,790 gzipped bytes when it stopped.
   *
   * `enableErrorDecoding` is process-global and idempotent, so these decode rather than count.
   * `buildFrameGraphTask` on a task the graph does not hold is Lite error 94, and it needs no
   * device.
   */
  it("decodes a numeric Lite code to prose once it has been awaited", async () => {
    await enableLiteErrorDecoding();
    const { scene } = createHeadlessScene();
    expect(() => {
      buildFrameGraphTask(getFrameGraph(scene), { name: "ignifx:not-in-this-graph" } as never);
    }).toThrow(/task is not registered in this graph/u);
  });

  it("is idempotent, and the decoded message carries the failing task's name", async () => {
    await enableLiteErrorDecoding();
    await enableLiteErrorDecoding();
    const { scene } = createHeadlessScene();
    expect(() => {
      buildFrameGraphTask(getFrameGraph(scene), { name: "ignifx:probe" } as never);
    }).toThrow(/ignifx:probe/u);
  });
});
