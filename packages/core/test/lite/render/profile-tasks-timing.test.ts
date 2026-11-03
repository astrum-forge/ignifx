import { setGpuTimingEnabled, setRenderTaskGpuTimingEnabled } from "@babylonjs/lite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startGpuTiming, stopTaskTiming } from "../../../src/render/gpu/renderer-gpu.js";
import type { LiteEngine } from "../../../src/lite/scene.js";

/**
 * `renderer.profileTasks` switches both of Lite's GPU timers. Lite keeps per-task timing
 * (`setRenderTaskGpuTimingEnabled`) apart from whole-frame timing (`setGpuTimingEnabled`); turning
 * on only the second left `taskTimings()` reading `"disabled"` forever.
 *
 * Lite is mocked because both calls probe a real device's `timestamp-query`, which the null engine
 * does not have; the browser project and `pnpm test:gpu-budget` read the numbers themselves.
 */

vi.mock("@babylonjs/lite", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    setGpuTimingEnabled: vi.fn(),
    setRenderTaskGpuTimingEnabled: vi.fn(() => Promise.resolve({ status: "pending" })),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("profileTasks' GPU timers", () => {
  it("turns whole-frame and per-task timing on", async () => {
    const engine = {} as LiteEngine;
    await startGpuTiming(engine);
    expect(setGpuTimingEnabled).toHaveBeenCalledWith(engine, true);
    expect(setRenderTaskGpuTimingEnabled).toHaveBeenCalledWith(engine, true);
  });

  it("turns per-task timing off", async () => {
    const engine = {} as LiteEngine;
    await stopTaskTiming(engine);
    expect(setRenderTaskGpuTimingEnabled).toHaveBeenCalledWith(engine, false);
  });
});
