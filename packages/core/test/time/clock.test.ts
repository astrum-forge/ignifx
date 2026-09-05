import { describe, expect, it } from "vitest";
import { createManualClock, createPerformanceClock } from "../../src/index.js";

describe("the clock", () => {
  it("starts a manual clock at zero and moves only when told to", () => {
    const clock = createManualClock();
    expect(clock.nowMs()).toBe(0);
    clock.advance(1000 / 60);
    expect(clock.nowMs()).toBeCloseTo(1000 / 60, 12);
  });

  it("starts a manual clock at an offset and accepts absolute settings", () => {
    const clock = createManualClock(5000);
    expect(clock.nowMs()).toBe(5000);
    clock.set(42);
    expect(clock.nowMs()).toBe(42);
  });

  it("refuses to run a manual clock backwards", () => {
    const clock = createManualClock(100);
    clock.advance(-50);
    expect(clock.nowMs()).toBe(100);
  });

  it("reads the host timer and never goes backwards", () => {
    const clock = createPerformanceClock();
    const first = clock.nowMs();
    const second = clock.nowMs();
    expect(Number.isFinite(first)).toBe(true);
    expect(second).toBeGreaterThanOrEqual(first);
  });
});
