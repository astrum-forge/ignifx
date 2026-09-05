import { describe, expect, it } from "vitest";
import { createManualClock, IgnifxError } from "../../src/index.js";
import { TimeImpl } from "../../src/time/time.js";

/**
 * Every property of `docs/architecture/01-lifecycle-and-time.md` §2, driven directly rather than
 * through a frame so that step 1 can be checked on its own.
 */

const FRAME = 1 / 60;

/**
 * Builds a clock on a manual timer.
 *
 * @returns The clock and the timer behind it.
 */
function createTime(): { time: TimeImpl; clock: ReturnType<typeof createManualClock> } {
  const clock = createManualClock();
  return { time: new TimeImpl(clock), clock };
}

describe("Time", () => {
  it("starts at the documented defaults", () => {
    const { time } = createTime();
    expect(time.deltaTime).toBe(0);
    expect(time.unscaledDeltaTime).toBe(0);
    expect(time.fixedDeltaTime).toBeCloseTo(1 / 60, 12);
    expect(time.timeScale).toBe(1);
    expect(time.maximumDeltaTime).toBe(0.1);
    expect(time.time).toBe(0);
    expect(time.unscaledTime).toBe(0);
    expect(time.fixedTime).toBe(0);
    expect(time.frameCount).toBe(0);
    expect(time.inFixedStep).toBe(false);
    expect(time.fixedStepAlpha).toBe(0);
    expect(time.paused).toBe(false);
  });

  it("advances the counters at the start of a frame", () => {
    const { time } = createTime();
    time.beginFrame(FRAME);
    expect(time.unscaledDeltaTime).toBeCloseTo(FRAME, 12);
    expect(time.deltaTime).toBeCloseTo(FRAME, 12);
    expect(time.time).toBeCloseTo(FRAME, 12);
    expect(time.unscaledTime).toBeCloseTo(FRAME, 12);
    expect(time.frameCount).toBe(1);
    expect(time.droppedSeconds).toBe(0);
  });

  it("clamps a long frame to maximumDeltaTime and reports what it dropped", () => {
    const { time } = createTime();
    time.beginFrame(2.5);
    expect(time.unscaledDeltaTime).toBe(0.1);
    expect(time.droppedSeconds).toBeCloseTo(2.4, 12);
  });

  it("scales deltaTime but not unscaledDeltaTime", () => {
    const { time } = createTime();
    time.timeScale = 0.5;
    time.beginFrame(FRAME);
    expect(time.deltaTime).toBeCloseTo(FRAME / 2, 12);
    expect(time.unscaledDeltaTime).toBeCloseTo(FRAME, 12);
    expect(time.time).toBeCloseTo(FRAME / 2, 12);
    expect(time.unscaledTime).toBeCloseTo(FRAME, 12);
  });

  it("treats a non-finite or negative raw delta as zero", () => {
    const { time } = createTime();
    time.beginFrame(Number.NaN);
    expect(time.deltaTime).toBe(0);
    time.beginFrame(-1);
    expect(time.deltaTime).toBe(0);
    expect(time.frameCount).toBe(2);
  });

  it("reads realtimeSinceStartup from the injected clock", () => {
    const clock = createManualClock(1000);
    const time = new TimeImpl(clock);
    expect(time.realtimeSinceStartup).toBe(0);
    clock.advance(2500);
    expect(time.realtimeSinceStartup).toBeCloseTo(2.5, 12);
  });

  it("advances fixedTime one step at a time and publishes the alpha", () => {
    const { time } = createTime();
    time.beginFrame(FRAME);
    time.beginFixedStep();
    expect(time.inFixedStep).toBe(true);
    expect(time.fixedTime).toBeCloseTo(FRAME, 12);
    time.endFixedLoop(FRAME / 2);
    expect(time.inFixedStep).toBe(false);
    expect(time.fixedStepAlpha).toBeCloseTo(0.5, 12);
  });

  it("keeps fixedStepAlpha inside [0, 1)", () => {
    const { time } = createTime();
    time.endFixedLoop(-1);
    expect(time.fixedStepAlpha).toBe(0);
    time.endFixedLoop(1);
    expect(time.fixedStepAlpha).toBeLessThan(1);
    expect(time.fixedStepAlpha).toBeGreaterThan(0.999);
  });

  it("applies a fixedDeltaTime write immediately between frames", () => {
    const { time } = createTime();
    time.fixedDeltaTime = 1 / 30;
    expect(time.fixedDeltaTime).toBeCloseTo(1 / 30, 12);
  });

  it("defers a fixedDeltaTime write made during a frame to the next frame start", () => {
    const { time } = createTime();
    time.beginFrame(FRAME);
    time.fixedDeltaTime = 1 / 30;
    // §4's guarantee that `fixedUpdate` receives `dt === time.fixedDeltaTime` has to keep holding
    // for the rest of this frame.
    expect(time.fixedDeltaTime).toBeCloseTo(1 / 60, 12);
    time.endFrame();
    time.beginFrame(FRAME);
    expect(time.fixedDeltaTime).toBeCloseTo(1 / 30, 12);
  });

  it("applies the resolved time settings section", () => {
    const { time } = createTime();
    time.applySettings(1 / 120, 0.25, 2);
    expect(time.fixedDeltaTime).toBeCloseTo(1 / 120, 12);
    expect(time.maximumDeltaTime).toBe(0.25);
    expect(time.timeScale).toBe(2);
    time.applySettings();
    expect(time.timeScale).toBe(2);
  });

  it("rejects a fixed step that would make the fixed loop unbounded", () => {
    const { time } = createTime();
    expect(() => {
      time.fixedDeltaTime = 0;
    }).toThrow(IgnifxError);
    try {
      time.fixedDeltaTime = Number.NaN;
    } catch (error) {
      expect(error).toBeInstanceOf(IgnifxError);
      expect((error as IgnifxError).code).toBe("IGX-0108");
    }
  });

  it("rejects a negative time scale and a non-positive delta clamp", () => {
    const { time } = createTime();
    expect(() => {
      time.timeScale = -1;
    }).toThrow(/timeScale/u);
    expect(() => {
      time.maximumDeltaTime = 0;
    }).toThrow(/maximumDeltaTime/u);
  });
});
