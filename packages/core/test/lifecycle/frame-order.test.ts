import { afterEach, describe, expect, it } from "vitest";
import { Phase, Script, defineExtension } from "../../src/index.js";
import { FrameRecorder, PausedRecorder, RecordingSystem, createLogRef, createTestApp } from "../support/app-harness.js";
import type { Extension, ExtensionContext } from "../../src/index.js";
import type { LogRef, TestAppHarness } from "../support/app-harness.js";

/**
 * The frame, top to bottom (`docs/architecture/01-lifecycle-and-time.md` §3). Every assertion here
 * is a line of that listing: the suite drives `app.step()` on a headless app whose systems and
 * scripts append to one shared log, and compares the log against the documented order.
 */

const FRAME = 1 / 60;

/** Registers one recording system in every phase, plus the `order < 0` / `order >= 0` splits. */
function recorders(log: LogRef): Extension {
  return defineExtension(() => ({
    name: "game/recorders",
    version: "1.0.0",
    register(ctx: ExtensionContext): void {
      ctx.registerSystem(new RecordingSystem(log, Phase.EndOfFrame, 0), { phase: Phase.EndOfFrame });
      ctx.registerSystem(new RecordingSystem(log, Phase.PreUpdate, 0), { phase: Phase.PreUpdate });
      ctx.registerSystem(new RecordingSystem(log, Phase.FixedUpdate, -10), {
        phase: Phase.FixedUpdate,
        order: -10,
      });
      ctx.registerSystem(new RecordingSystem(log, Phase.FixedUpdate, 10), { phase: Phase.FixedUpdate, order: 10 });
      ctx.registerSystem(new RecordingSystem(log, Phase.Update, -10), { phase: Phase.Update, order: -10 });
      ctx.registerSystem(new RecordingSystem(log, Phase.Update, 10), { phase: Phase.Update, order: 10 });
      ctx.registerSystem(new RecordingSystem(log, Phase.PostUpdate, 0), { phase: Phase.PostUpdate });
      ctx.registerSystem(new RecordingSystem(log, Phase.PreRender, 0), { phase: Phase.PreRender });
    },
  }))();
}

let harness: TestAppHarness | null = null;

/**
 * Builds a headless app whose every phase records into one log.
 *
 * @returns The harness.
 */
async function createRecordingApp(): Promise<TestAppHarness> {
  const log = createLogRef();
  const created = await createTestApp({ extensions: [recorders(log)] });
  // The systems were built inside `register`, before the world and therefore before its shared log
  // existed; binding the box here is what joins the two halves of the recording.
  log.entries = created.log;
  created.log.length = 0;
  harness = created;
  return created;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the frame", () => {
  it("runs steps 0 to 10 in the documented order", async () => {
    const app = await createRecordingApp();
    const entity = app.world.createEntity("A");
    entity.addComponent(FrameRecorder);

    app.step(FRAME);

    expect(app.log).toEqual([
      "sys:EndOfFrame:0",
      "sys:PreUpdate:0",
      "awake:a",
      "onEnable:a",
      "sys:FixedUpdate:-10",
      "fixedUpdate:a",
      "sys:FixedUpdate:10",
      "start:a",
      "sys:Update:-10",
      "update:a",
      "sys:Update:10",
      "sys:PostUpdate:0",
      "lateUpdate:a",
      "sys:PreRender:0",
    ]);
  });

  it("drains EndOfFrame work at the top of the next frame", async () => {
    const app = await createRecordingApp();
    app.step(FRAME);
    app.log.length = 0;
    app.step(FRAME);

    expect(app.log[0]).toBe("sys:EndOfFrame:0");
    expect(app.log[1]).toBe("sys:PreUpdate:0");
  });

  it("runs two fixed steps for a double-length frame", async () => {
    const app = await createRecordingApp();
    const entity = app.world.createEntity("A");
    entity.addComponent(FrameRecorder);
    app.step(FRAME);
    app.log.length = 0;

    app.step(2 * FRAME);

    expect(app.log).toEqual([
      "sys:EndOfFrame:0",
      "sys:PreUpdate:0",
      "sys:FixedUpdate:-10",
      "fixedUpdate:a",
      "sys:FixedUpdate:10",
      "sys:FixedUpdate:-10",
      "fixedUpdate:a",
      "sys:FixedUpdate:10",
      "sys:Update:-10",
      "update:a",
      "sys:Update:10",
      "sys:PostUpdate:0",
      "lateUpdate:a",
      "sys:PreRender:0",
    ]);
    expect(app.app.diagnostics.frame.fixedSteps).toBe(2);
  });

  it("runs no fixed step for a frame shorter than the step", async () => {
    const app = await createRecordingApp();
    const entity = app.world.createEntity("A");
    entity.addComponent(FrameRecorder);
    app.step(FRAME);
    app.log.length = 0;

    app.step(FRAME / 2);

    expect(app.log).not.toContain("fixedUpdate:a");
    expect(app.log).toContain("update:a");
    expect(app.app.diagnostics.frame.fixedSteps).toBe(0);
    expect(app.app.time.fixedStepAlpha).toBeCloseTo(0.5, 10);
  });

  it("runs start after the fixed loop and before update", async () => {
    const app = await createRecordingApp();
    const entity = app.world.createEntity("A");
    entity.addComponent(FrameRecorder);

    app.step(FRAME);

    const start = app.log.indexOf("start:a");
    expect(start).toBeGreaterThan(app.log.indexOf("fixedUpdate:a"));
    expect(start).toBeLessThan(app.log.indexOf("update:a"));
  });

  it("runs a nested awake synchronously when a callback adds a component", async () => {
    const app = await createRecordingApp();

    class Adder extends Script {
      static typeId = "test/Adder";
      awake(): void {
        app.log.push("awake:adder");
        this.entity.addComponent(FrameRecorder);
        app.log.push("after-add:adder");
      }
    }

    const entity = app.world.createEntity("A");
    entity.addComponent(Adder);
    app.step(FRAME);

    expect(app.log.slice(0, 6)).toEqual([
      "sys:EndOfFrame:0",
      "sys:PreUpdate:0",
      "awake:adder",
      "awake:a",
      "onEnable:a",
      "after-add:adder",
    ]);
  });

  it("runs the destroy flush before PreRender and skips the destroyed script's lateUpdate", async () => {
    // §4: `isDestroyed` becomes `true` the moment `destroy()` is called, and the guarantee that a
    // callback never runs on a component that is no longer live wins over "the object stays valid
    // until the flush" — which is about reading its state, not about receiving further callbacks.
    const app = await createRecordingApp();

    class SelfDestruct extends Script {
      static typeId = "test/SelfDestruct";
      update(): void {
        app.log.push("update:doomed");
        this.entity.destroy();
      }
      lateUpdate(): void {
        app.log.push("lateUpdate:doomed");
      }
      onDisable(): void {
        app.log.push("onDisable:doomed");
      }
      onDestroy(): void {
        app.log.push("onDestroy:doomed");
      }
    }

    const entity = app.world.createEntity("A");
    entity.addComponent(SelfDestruct);
    app.step(FRAME);

    expect(app.log).not.toContain("lateUpdate:doomed");
    const destroyed = app.log.indexOf("onDestroy:doomed");
    expect(destroyed).toBeGreaterThan(app.log.indexOf("sys:PostUpdate:0"));
    expect(destroyed).toBeLessThan(app.log.indexOf("sys:PreRender:0"));
    expect(app.log.indexOf("onDisable:doomed")).toBeLessThan(destroyed);
    expect(app.app.diagnostics.frame.destroyed).toBe(1);
  });

  it("delivers a signal queued during a frame at the next frame's step 0", async () => {
    const app = await createRecordingApp();

    class Spawner extends Script {
      static typeId = "test/Spawner";
      hasSpawned = false;
      update(): void {
        if (!this.hasSpawned) {
          this.hasSpawned = true;
          this.world.createEntity("Spawned");
        }
      }
    }

    app.world.createEntity("A").addComponent(Spawner);
    // Connected only now, so the entity created above does not queue a delivery of its own.
    app.world.onEntityCreated.connect(
      () => {
        app.log.push("deferred:entity-created");
      },
      { deferred: true },
    );
    app.step(FRAME);
    // Queued inside `update`, so it must not have been delivered anywhere in this frame.
    expect(app.log).not.toContain("deferred:entity-created");

    app.log.length = 0;
    app.step(FRAME);
    expect(app.log[0]).toBe("deferred:entity-created");
    expect(app.log[1]).toBe("sys:EndOfFrame:0");
  });

  it("skips scripts while paused unless they set updateWhenPaused", async () => {
    const app = await createRecordingApp();
    const plain = app.world.createEntity("Plain");
    plain.addComponent(FrameRecorder);
    const menu = app.world.createEntity("Menu");
    menu.addComponent(PausedRecorder).label = "menu";
    app.step(FRAME);
    app.log.length = 0;

    app.app.pause();
    app.step(FRAME);

    expect(app.log).toEqual([
      "sys:EndOfFrame:0",
      "sys:PreUpdate:0",
      "sys:Update:-10",
      "update:menu",
      "sys:Update:10",
      "sys:PostUpdate:0",
      "lateUpdate:menu",
      "sys:PreRender:0",
    ]);

    app.log.length = 0;
    app.app.resume();
    app.step(FRAME);
    expect(app.log).toContain("update:a");
    expect(app.log).toContain("fixedUpdate:a");
  });
});
