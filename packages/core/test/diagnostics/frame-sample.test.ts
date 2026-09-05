import { describe, expect, it } from "vitest";
import { createFrameSample, PHASE_COUNT, resetFrameSample } from "../../src/diagnostics/frame-sample.js";

describe("frame sample", () => {
  it("starts with every counter at zero", () => {
    const sample = createFrameSample();
    expect(sample.frame).toBe(0);
    expect(sample.rawDeltaMs).toBe(0);
    expect(sample.droppedMs).toBe(0);
    expect(sample.fixedSteps).toBe(0);
    expect(sample.scriptsUpdated).toBe(0);
    expect(sample.coroutinesResumed).toBe(0);
    expect(sample.destroyed).toBe(0);
  });

  it("preallocates one CPU timing slot per phase", () => {
    expect(PHASE_COUNT).toBe(6);
    expect(createFrameSample().cpuMs).toHaveLength(PHASE_COUNT);
  });

  it("zeroes every counter in place without replacing the timing array", () => {
    const sample = createFrameSample();
    const timings = sample.cpuMs;
    sample.frame = 9;
    sample.rawDeltaMs = 16.7;
    sample.droppedMs = 1;
    sample.fixedSteps = 2;
    sample.scriptsUpdated = 3;
    sample.coroutinesResumed = 4;
    sample.destroyed = 5;
    sample.cpuMs[0] = 1.5;
    expect(resetFrameSample(sample)).toBe(sample);
    expect(sample.frame).toBe(0);
    expect(sample.rawDeltaMs).toBe(0);
    expect(sample.droppedMs).toBe(0);
    expect(sample.fixedSteps).toBe(0);
    expect(sample.scriptsUpdated).toBe(0);
    expect(sample.coroutinesResumed).toBe(0);
    expect(sample.destroyed).toBe(0);
    expect(sample.cpuMs[0]).toBe(0);
    expect(sample.cpuMs).toBe(timings);
  });
});
