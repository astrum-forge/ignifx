import { describe, expect, it, vi } from "vitest";
import { Diagnostics, FRAME_HISTORY_LENGTH } from "../../src/diagnostics/diagnostics.js";
import { createFrameSample, PHASE_COUNT } from "../../src/diagnostics/frame-sample.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";

/** A clock that advances by a fixed amount on every reading. */
function createStepClock(stepMs: number): () => number {
  let value = 0;
  return () => {
    const current = value;
    value += stepMs;
    return current;
  };
}

describe("frame capture", () => {
  it("numbers frames from one and records the raw delta", () => {
    const diagnostics = new Diagnostics();
    diagnostics.beginFrame(16.7);
    expect(diagnostics.frame.frame).toBe(1);
    expect(diagnostics.frame.rawDeltaMs).toBe(16.7);
    diagnostics.endFrame();
    diagnostics.beginFrame(16.6);
    expect(diagnostics.frame.frame).toBe(2);
  });

  it("zeroes the live counters at the start of each frame", () => {
    const diagnostics = new Diagnostics();
    diagnostics.beginFrame(16);
    diagnostics.frame.fixedSteps = 3;
    diagnostics.frame.cpuMs[0] = 1.25;
    diagnostics.endFrame();
    diagnostics.beginFrame(16);
    expect(diagnostics.frame.fixedSteps).toBe(0);
    expect(diagnostics.frame.cpuMs[0]).toBe(0);
  });

  it("reads back every counter of the frame that just ended", () => {
    const diagnostics = new Diagnostics();
    diagnostics.beginFrame(20);
    diagnostics.frame.droppedMs = 4;
    diagnostics.frame.fixedSteps = 2;
    diagnostics.frame.scriptsUpdated = 120;
    diagnostics.frame.coroutinesResumed = 7;
    diagnostics.frame.destroyed = 3;
    diagnostics.frame.cpuMs[2] = 1.5;
    diagnostics.endFrame();

    const sample = createFrameSample();
    diagnostics.readFrame(0, sample);
    expect(sample.frame).toBe(1);
    expect(sample.rawDeltaMs).toBe(20);
    expect(sample.droppedMs).toBe(4);
    expect(sample.fixedSteps).toBe(2);
    expect(sample.scriptsUpdated).toBe(120);
    expect(sample.coroutinesResumed).toBe(7);
    expect(sample.destroyed).toBe(3);
    expect(sample.cpuMs[2]).toBe(1.5);
  });

  it("orders history newest first", () => {
    const diagnostics = new Diagnostics();
    for (let index = 1; index <= 3; index += 1) {
      diagnostics.beginFrame(index);
      diagnostics.endFrame();
    }
    const sample = createFrameSample();
    expect(diagnostics.readFrame(0, sample).rawDeltaMs).toBe(3);
    expect(diagnostics.readFrame(1, sample).rawDeltaMs).toBe(2);
    expect(diagnostics.readFrame(2, sample).rawDeltaMs).toBe(1);
  });

  it("returns a zeroed sample for an offset outside the history", () => {
    const diagnostics = new Diagnostics();
    diagnostics.beginFrame(16);
    diagnostics.endFrame();
    const sample = createFrameSample();
    sample.frame = 99;
    expect(diagnostics.readFrame(1, sample).frame).toBe(0);
    expect(diagnostics.readFrame(-1, sample).frame).toBe(0);
  });

  it("holds three hundred frames by default", () => {
    expect(FRAME_HISTORY_LENGTH).toBe(300);
    expect(new Diagnostics().historyCapacity).toBe(300);
  });

  it("keeps the newest three hundred of a thousand frames without allocating per frame", () => {
    const diagnostics = new Diagnostics();
    const sample = createFrameSample();
    const timings = diagnostics.frame.cpuMs;
    for (let index = 1; index <= 1000; index += 1) {
      diagnostics.beginFrame(index);
      diagnostics.frame.fixedSteps = index % 3;
      diagnostics.frame.cpuMs[1] = index * 0.5;
      diagnostics.endFrame();
      // The live sample and its timing array are the same objects every frame.
      expect(diagnostics.frame.cpuMs).toBe(timings);
    }
    expect(diagnostics.historyLength).toBe(FRAME_HISTORY_LENGTH);
    diagnostics.readFrame(0, sample);
    expect(sample.frame).toBe(1000);
    expect(sample.rawDeltaMs).toBe(1000);
    expect(sample.cpuMs[1]).toBe(500);
    diagnostics.readFrame(FRAME_HISTORY_LENGTH - 1, sample);
    expect(sample.frame).toBe(701);
    expect(sample.rawDeltaMs).toBe(701);
    expect(sample.fixedSteps).toBe(701 % 3);
    diagnostics.readFrame(FRAME_HISTORY_LENGTH, sample);
    expect(sample.frame).toBe(0);
  });

  it("honours a custom history length", () => {
    const diagnostics = new Diagnostics({ historyLength: 2 });
    for (let index = 1; index <= 5; index += 1) {
      diagnostics.beginFrame(index);
      diagnostics.endFrame();
    }
    expect(diagnostics.historyLength).toBe(2);
    const sample = createFrameSample();
    expect(diagnostics.readFrame(0, sample).rawDeltaMs).toBe(5);
    expect(diagnostics.readFrame(1, sample).rawDeltaMs).toBe(4);
  });

  it("clamps a history length below one", () => {
    expect(new Diagnostics({ historyLength: 0 }).historyCapacity).toBe(1);
  });

  it("forgets the history and restarts numbering on clearHistory", () => {
    const diagnostics = new Diagnostics();
    diagnostics.beginFrame(16);
    diagnostics.endFrame();
    diagnostics.clearHistory();
    expect(diagnostics.historyLength).toBe(0);
    diagnostics.beginFrame(16);
    expect(diagnostics.frame.frame).toBe(1);
  });

  it("writes one CPU slot per phase into the history", () => {
    const diagnostics = new Diagnostics();
    diagnostics.beginFrame(16);
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      diagnostics.frame.cpuMs[phase] = phase + 1;
    }
    diagnostics.endFrame();
    const sample = createFrameSample();
    diagnostics.readFrame(0, sample);
    expect(Array.from(sample.cpuMs)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("clocks", () => {
  it("falls back to Date.now on a host without a performance clock", () => {
    vi.stubGlobal("performance", undefined);
    try {
      const diagnostics = new Diagnostics({ development: true });
      const scope = diagnostics.profile("no-clock");
      scope.end();
      expect(scope.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips user timing on a host without performance.mark", () => {
    vi.stubGlobal("performance", { now: () => 1 });
    try {
      const diagnostics = new Diagnostics({ development: true });
      expect(() => diagnostics.profile("no-marks").end()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("counter groups", () => {
  it("registers a group and finds it again by name", () => {
    const diagnostics = new Diagnostics();
    const group = diagnostics.registerGroup("render", ["drawCalls"]);
    expect(diagnostics.group("render")).toBe(group);
    expect(diagnostics.groups).toEqual([group]);
  });

  it("returns null for a group nobody registered", () => {
    expect(new Diagnostics().group("physics")).toBeNull();
  });

  it("throws IGX-1503 when a group name is registered twice", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerGroup("render", []);
    try {
      diagnostics.registerGroup("render", []);
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.duplicateDiagnosticsGroup);
    }
  });

  it("registers on the first groupOrRegister and returns the same group on the next", () => {
    const diagnostics = new Diagnostics();
    const first = diagnostics.groupOrRegister("game", ["enemiesAlive"]);
    const second = diagnostics.groupOrRegister("game", ["enemiesAlive"]);
    expect(second).toBe(first);
    expect(diagnostics.groups).toEqual([first]);
  });

  it("hands groupOrRegister the group registerGroup already made", () => {
    const diagnostics = new Diagnostics();
    const group = diagnostics.registerGroup("render", ["drawCalls"]);
    expect(diagnostics.groupOrRegister("render", ["drawCalls"])).toBe(group);
  });

  it("ignores the counter names of a groupOrRegister that finds an existing group", () => {
    // Counters are indexed, so growing a group under a subsystem that already holds indices into it
    // would renumber them. The later names are dropped, and asking for one raises IGX-1504.
    const diagnostics = new Diagnostics();
    diagnostics.registerGroup("game", ["enemiesAlive"]);
    const group = diagnostics.groupOrRegister("game", ["wavesCleared"]);
    expect(group.counterNames).toEqual(["enemiesAlive"]);
    try {
      group.index("wavesCleared");
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.unknownDiagnosticsCounter);
    }
  });

  it("keeps two apps' counters apart", () => {
    const first = new Diagnostics();
    const second = new Diagnostics();
    first.registerGroup("render", ["drawCalls"]);
    expect(second.group("render")).toBeNull();
  });
});

describe("profile scopes", () => {
  it("is inert outside development builds", () => {
    const diagnostics = new Diagnostics({ now: createStepClock(5) });
    const scope = diagnostics.profile("physics.step");
    scope.end();
    expect(scope.durationMs).toBe(0);
    expect(diagnostics.isDevelopment).toBe(false);
  });

  it("measures the scope with the injected clock in development", () => {
    const diagnostics = new Diagnostics({ development: true, now: createStepClock(5) });
    const scope = diagnostics.profile("physics.step");
    scope.end();
    expect(scope.durationMs).toBe(5);
  });

  it("ignores a second end", () => {
    const diagnostics = new Diagnostics({ development: true, now: createStepClock(5) });
    const scope = diagnostics.profile("physics.step");
    scope.end();
    const first = scope.durationMs;
    scope.end();
    expect(scope.durationMs).toBe(first);
  });

  it("reuses one scope object per nesting depth", () => {
    const diagnostics = new Diagnostics({ development: true, now: createStepClock(1) });
    const first = diagnostics.profile("a");
    first.end();
    const second = diagnostics.profile("b");
    second.end();
    expect(second).toBe(first);
  });

  it("hands nested scopes distinct objects", () => {
    const diagnostics = new Diagnostics({ development: true, now: createStepClock(1) });
    const outer = diagnostics.profile("outer");
    const inner = diagnostics.profile("inner");
    expect(inner).not.toBe(outer);
    inner.end();
    outer.end();
  });

  it("records user timing entries in development", () => {
    performance.clearMeasures();
    const diagnostics = new Diagnostics({ development: true });
    diagnostics.profile("render.sync").end();
    const measures = performance.getEntriesByName("ignifx:render.sync");
    expect(measures.length).toBeGreaterThan(0);
    expect(performance.getEntriesByName("ignifx:render.sync:0", "mark")).toHaveLength(0);
    performance.clearMeasures();
  });

  it("records no user timing entries outside development", () => {
    performance.clearMeasures();
    new Diagnostics().profile("render.quiet").end();
    expect(performance.getEntriesByName("ignifx:render.quiet")).toHaveLength(0);
  });
});
