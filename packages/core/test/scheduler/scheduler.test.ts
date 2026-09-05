import { afterEach, describe, expect, it } from "vitest";
import { Phase, defineExtension } from "../../src/index.js";
import { FrameRecorder, RecordingSystem, createLogRef, createTestApp } from "../support/app-harness.js";
import type { Extension, ExtensionContext, System, SystemContext, World } from "../../src/index.js";
import type { TestAppHarness } from "../support/app-harness.js";

/**
 * The scheduler: system ordering inside a phase, the fixed-step accumulator and its snapping rule
 * (`docs/architecture/01-lifecycle-and-time.md` §3 notes), the `EndOfFrame` queue, and the
 * diagnostics the loop publishes (§9).
 */

const FRAME = 1 / 60;

let harness: TestAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Counts fixed steps by counting `fixedUpdate` calls on one script. */
class FixedCounter implements System {
  readonly name = "fixed-counter";
  steps = 0;
  update(): void {
    this.steps += 1;
  }
}

/**
 * Builds an app with one extension.
 *
 * @param register - What the extension registers.
 * @returns The harness.
 */
async function createAppWith(register: (ctx: ExtensionContext) => void): Promise<TestAppHarness> {
  const extension: Extension = defineExtension(() => ({
    name: "game/test",
    version: "1.0.0",
    register,
  }))();
  harness = await createTestApp({ extensions: [extension] });
  return harness;
}

describe("system ordering", () => {
  it("runs systems by ascending order and breaks ties on registration order", async () => {
    const log = createLogRef();
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(new RecordingSystem(log, Phase.PreUpdate, 10), { phase: Phase.PreUpdate, order: 10 });
      ctx.registerSystem(new RecordingSystem(log, Phase.PreUpdate, -5), { phase: Phase.PreUpdate, order: -5 });
      ctx.registerSystem(new RecordingSystem(log, Phase.PreUpdate, 0), { phase: Phase.PreUpdate });
      ctx.registerSystem(new RecordingSystem(log, Phase.PreUpdate, 1), { phase: Phase.PreUpdate, order: 0 });
    });
    log.entries = app.log;

    app.step(FRAME);

    expect(app.log).toEqual(["sys:PreUpdate:-5", "sys:PreUpdate:0", "sys:PreUpdate:1", "sys:PreUpdate:10"]);
  });

  it("hands every system the same context with the phase and delta of its slot", async () => {
    const seen: { phase: Phase; dt: number; world: World | null }[] = [];
    const app = await createAppWith((ctx) => {
      const probe: System = {
        name: "probe",
        update(context: SystemContext): void {
          seen.push({ phase: context.phase, dt: context.dt, world: context.world });
        },
      };
      ctx.registerSystem(probe, { phase: Phase.FixedUpdate });
      ctx.registerSystem(probe, { phase: Phase.PreRender });
    });

    app.step(FRAME);

    expect(seen).toHaveLength(2);
    expect(seen[0]?.phase).toBe(Phase.FixedUpdate);
    expect(seen[0]?.dt).toBeCloseTo(FRAME, 12);
    expect(seen[1]?.phase).toBe(Phase.PreRender);
    expect(seen[0]?.world).toBe(app.world);
  });

  it("reports a throwing system through app.onError and keeps running the phase", async () => {
    const ran: string[] = [];
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(
        {
          name: "bad",
          update(): void {
            throw new Error("boom");
          },
        },
        { phase: Phase.PreUpdate, order: -1 },
      );
      ctx.registerSystem(
        {
          name: "good",
          update(): void {
            ran.push("good");
          },
        },
        { phase: Phase.PreUpdate },
      );
    });
    const reports: string[] = [];
    app.app.onError.connect((report) => {
      reports.push(report.source);
    });

    app.step(FRAME);

    expect(ran).toEqual(["good"]);
    expect(reports).toEqual(["system"]);
    expect(app.sink.toArray().some((record) => record.level === "error")).toBe(true);
  });

  it("tells systems about the world once it exists and again when it goes", async () => {
    const events: string[] = [];
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(
        {
          name: "lifecycle",
          onWorldCreated(): void {
            events.push("created");
          },
          onWorldDisposed(): void {
            events.push("disposed");
          },
          dispose(): void {
            events.push("disposed-self");
          },
        },
        { phase: Phase.PreUpdate },
      );
    });

    expect(events).toEqual(["created"]);
    app.dispose();
    harness = null;
    expect(events).toEqual(["created", "disposed", "disposed-self"]);
  });
});

describe("the fixed-step accumulator", () => {
  it("runs exactly one fixed step per frame for 600 frames of 1/60", async () => {
    const counter = new FixedCounter();
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(counter, { phase: Phase.FixedUpdate });
    });

    for (let index = 0; index < 600; index += 1) {
      app.step(FRAME);
    }

    expect(counter.steps).toBe(600);
  });

  it("never drifts into a zero-step or double-step frame over 10000 frames", async () => {
    const counter = new FixedCounter();
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(counter, { phase: Phase.FixedUpdate });
    });

    let worst = 1;
    let best = 1;
    for (let index = 0; index < 10_000; index += 1) {
      const before = counter.steps;
      app.step(FRAME);
      const stepsThisFrame = counter.steps - before;
      worst = Math.max(worst, stepsThisFrame);
      best = Math.min(best, stepsThisFrame);
    }

    expect(counter.steps).toBe(10_000);
    expect(best).toBe(1);
    expect(worst).toBe(1);
  });

  it("runs two fixed steps per frame at 1/30", async () => {
    const counter = new FixedCounter();
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(counter, { phase: Phase.FixedUpdate });
    });

    for (let index = 0; index < 100; index += 1) {
      app.step(1 / 30);
    }

    expect(counter.steps).toBe(200);
  });

  it("bounds the fixed loop with the maximum-delta clamp", async () => {
    const counter = new FixedCounter();
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(counter, { phase: Phase.FixedUpdate });
    });

    // Two seconds of stalled tab: the clamp keeps it to `0.1 / (1 / 60)` steps.
    app.step(2);

    expect(counter.steps).toBe(6);
    expect(app.app.diagnostics.frame.droppedMs).toBeCloseTo(1900, 6);
  });

  it("freezes fixed steps at timeScale zero and while paused", async () => {
    const counter = new FixedCounter();
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(counter, { phase: Phase.FixedUpdate });
    });

    app.app.time.timeScale = 0;
    app.step(FRAME);
    expect(counter.steps).toBe(0);

    app.app.time.timeScale = 1;
    app.app.pause();
    app.step(FRAME);
    expect(counter.steps).toBe(0);

    app.app.resume();
    app.step(FRAME);
    expect(counter.steps).toBe(1);
  });

  it("uses a changed fixed step from the next frame on", async () => {
    const counter = new FixedCounter();
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(counter, { phase: Phase.FixedUpdate });
    });

    app.step(FRAME);
    expect(counter.steps).toBe(1);
    app.app.time.fixedDeltaTime = 1 / 120;
    app.step(FRAME);
    expect(counter.steps).toBe(3);
  });
});

describe("the loop's diagnostics", () => {
  it("publishes the counters of section 9", async () => {
    const app = await createAppWith(() => undefined);
    app.world.createEntity("A").addComponent(FrameRecorder);
    app.world.createEntity("B").addComponent(FrameRecorder);

    app.step(FRAME);

    const frame = app.app.diagnostics.frame;
    expect(frame.frame).toBe(1);
    expect(frame.rawDeltaMs).toBeCloseTo(1000 / 60, 9);
    expect(frame.droppedMs).toBe(0);
    expect(frame.fixedSteps).toBe(1);
    expect(frame.scriptsUpdated).toBe(2);
    expect(frame.coroutinesResumed).toBe(0);
    expect(app.app.diagnostics.historyLength).toBe(1);
  });

  it("records per-phase CPU time in development builds", async () => {
    const app = await createAppWith((ctx) => {
      ctx.registerSystem(new RecordingSystem(createLogRef(), Phase.PreRender, 0), { phase: Phase.PreRender });
    });

    app.step(FRAME);

    // The manual clock never moves inside a frame, so the timings are zero — what is being asserted
    // is that the slots exist and are written, which is the development-only half of §9.
    expect(app.app.diagnostics.isDevelopment).toBe(true);
    expect(app.app.diagnostics.frame.cpuMs).toHaveLength(6);
  });

  it("keeps two apps in one process independent", async () => {
    const first = await createTestApp();
    const second = await createTestApp();
    try {
      first.step(FRAME);
      first.step(FRAME);
      second.step(FRAME);

      expect(first.app.time.frameCount).toBe(2);
      expect(second.app.time.frameCount).toBe(1);
      expect(first.world).not.toBe(second.world);
      expect(first.app.services).not.toBe(second.app.services);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});
