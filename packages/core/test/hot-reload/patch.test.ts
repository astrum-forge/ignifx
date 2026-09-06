import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScriptCallbackKind } from "../../src/lifecycle/callbacks.js";
import { createTestApp } from "../support/app-harness.js";
import { MoverV1, MoverV2, reload } from "./fixtures.js";
import type { TestAppHarness } from "../support/app-harness.js";

/**
 * The `"patch"` policy (`docs/architecture/15-devtools-and-diagnostics.md` §5): state preserved, no
 * lifecycle callback re-run, statics re-read, and the registry pointing at the replacement.
 */

let harness: TestAppHarness;

beforeEach(async () => {
  harness = await createTestApp();
  harness.app.registerComponents([MoverV1]);
});

afterEach(() => {
  harness.dispose();
});

/**
 * Attaches a mover and runs one frame so it is awake, enabled, and started.
 *
 * @returns The live instance.
 */
function liveMover(): MoverV1 {
  const entity = harness.world.createEntity("Player");
  const mover = entity.addComponent(MoverV1, { speed: 3 });
  harness.step(1 / 60);
  return mover;
}

describe("patch policy", () => {
  it("keeps every field value and the instance's identity", () => {
    const mover = liveMover();
    const uid = mover.uid;
    const handle = mover.handle;
    mover.speed = 42;
    mover.hits = 7;
    harness.log.length = 0;

    const report = reload(harness.app, MoverV2);

    expect(report.kind).toBe("patch");
    expect(report.typeIds).toEqual(["test/Mover"]);
    expect(report.instances).toBe(1);
    expect(report.errors).toEqual([]);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(mover.speed).toBe(42);
    expect(mover.hits).toBe(7);
    expect(mover.uid).toBe(uid);
    expect(mover.handle).toBe(handle);
    expect(harness.world.getComponentByHandle(handle)).toBe(mover);
  });

  it("runs the replacement's code without re-running any lifecycle callback", () => {
    const mover = liveMover();
    expect(mover.version()).toBe("v1");
    harness.log.length = 0;

    reload(harness.app, MoverV2);

    expect(mover.version()).toBe("v2");
    expect(mover).toBeInstanceOf(MoverV2);
    expect(harness.log).toEqual([]);

    // The new `lateUpdate` is dispatched from the next frame; `awake` never runs a second time.
    harness.step(1 / 60);
    expect(harness.log).toEqual(["lateUpdate:mover-v2"]);
  });

  it("re-reads the statics, so a changed executionOrder reorders dispatch", () => {
    const mover = liveMover();
    const other = harness.world.createEntity("Other").addComponent(MoverV1);
    harness.step(1 / 60);
    expect(harness.world.lifecycle.scriptsWith(ScriptCallbackKind.update)).toEqual([mover, other]);

    // Only the first instance's class is replaced, and its new class runs at order 25.
    harness.app.hotReload.apply([{ types: [MoverV2] }]);

    const order = harness.world.lifecycle.scriptsWith(ScriptCallbackKind.update);
    expect(order.map((script) => script.constructor)).toEqual([MoverV2, MoverV2]);
    expect(harness.world.registry.describe(MoverV2).script?.executionOrder).toBe(25);
    expect(harness.world.registry.describe(MoverV1).script?.executionOrder).toBe(0);
  });

  it("re-registers the type, so later addComponent and queries use the replacement", () => {
    const mover = liveMover();

    reload(harness.app, MoverV2);

    expect(harness.world.registry.get("test/Mover")).toBe(MoverV2);
    expect(harness.world.components(MoverV2)).toContain(mover);
    expect(harness.world.components(MoverV1)).toEqual([]);
    const fresh = harness.world.createEntity("Later").addComponent(MoverV2);
    expect(fresh.version()).toBe("v2");
    expect(harness.world.components(MoverV2)).toHaveLength(2);
  });

  it("leaves a running coroutine alone", () => {
    const mover = liveMover();
    const ticks: number[] = [];
    const handle = mover.startCoroutine(
      (function* count(): Generator<null, void, unknown> {
        for (let index = 0; index < 5; index += 1) {
          ticks.push(index);
          yield null;
        }
      })(),
    );
    harness.step(1 / 60);
    const before = ticks.length;
    expect(before).toBeGreaterThan(0);

    reload(harness.app, MoverV2);

    expect(handle.isRunning).toBe(true);
    harness.step(1 / 60);
    expect(ticks.length).toBe(before + 1);
  });

  it("keeps the class's dense index, so per-class bookkeeping survives", () => {
    liveMover();
    const before = harness.world.registry.describe(MoverV1).classIndex;

    reload(harness.app, MoverV2);

    expect(harness.world.registry.describe(MoverV2).classIndex).toBe(before);
  });

  it("does nothing for a class that is already the registered one", () => {
    liveMover();

    const report = reload(harness.app, MoverV1);

    expect(report.typeIds).toEqual([]);
    expect(report.instances).toBe(0);
  });

  it("registers a class the app has never seen instead of swapping anything", async () => {
    const fresh = await createTestApp();
    try {
      const report = fresh.app.hotReload.apply([{ types: [MoverV2] }]);

      expect(report.typeIds).toEqual([]);
      expect(report.instances).toBe(0);
      expect(fresh.world.registry.get("test/Mover")).toBe(MoverV2);
    } finally {
      fresh.dispose();
    }
  });
});
