import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { fakeHandle } from "../serialization/fixtures.js";
import { createTestApp } from "../support/app-harness.js";
import {
  BagV1,
  BagV2,
  BareV1,
  BareV2,
  Clip,
  Holder,
  linesContaining,
  MoverReshaped,
  MoverV1,
  Note,
  reload,
  RichTrimmed,
  RichV1,
  RichV2,
} from "./fixtures.js";
import type { TestAppHarness } from "../support/app-harness.js";

/**
 * The `"recreate"` policy (`docs/architecture/15-devtools-and-diagnostics.md` §5): the lifecycle
 * runs again, the uid and the component position survive, props are restored through the schema,
 * and tracked references find the replacement.
 */

let harness: TestAppHarness;

beforeEach(async () => {
  harness = await createTestApp();
  harness.app.registerComponents([BagV1, Holder, MoverV1, RichV1, BareV1, Note]);
});

afterEach(() => {
  harness.dispose();
});

/**
 * Attaches a bag and runs one frame so it is awake, enabled, and started.
 *
 * @returns The live instance.
 */
function liveBag(): BagV1 {
  const entity = harness.world.createEntity("Chest");
  const bag = entity.addComponent(BagV1, { slots: 4, label: "chest" });
  harness.step(1 / 60);
  return bag;
}

describe("recreate policy", () => {
  it("runs onDisable and onDestroy, then awake, onEnable and start again", () => {
    liveBag();
    harness.log.length = 0;

    const report = reload(harness.app, BagV2);

    expect(report.kind).toBe("recreate");
    expect(report.instances).toBe(1);
    expect(harness.log).toEqual(["onDisable:chest", "onDestroy:chest"]);

    harness.step(1 / 60);
    expect(harness.log).toEqual(["onDisable:chest", "onDestroy:chest", "awake:chest", "onEnable:chest", "start:chest"]);
  });

  it("rebuilds a fresh instance with the same uid, position, and props", () => {
    const entity = harness.world.createEntity("Chest");
    const first = entity.addComponent(MoverV1);
    const bag = entity.addComponent(BagV1, { slots: 4, label: "chest" });
    entity.addComponent(MoverV1);
    harness.step(1 / 60);
    const uid = bag.uid;
    const index = entity.components.indexOf(bag);
    bag.slots = 9;

    reload(harness.app, BagV2);

    const rebuilt = entity.getComponent(BagV2);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt).not.toBe(bag);
    expect(rebuilt?.uid).toBe(uid);
    expect(rebuilt?.slots).toBe(9);
    expect(rebuilt?.label).toBe("chest");
    expect(rebuilt?.version()).toBe("v2");
    expect(entity.components.indexOf(rebuilt as BagV2)).toBe(index);
    expect(entity.components[0]).toBe(entity.transform);
    expect(entity.components).toContain(first);
    expect(bag.isDestroyed).toBe(true);
  });

  it("re-points a tracked componentRef at the replacement", () => {
    const bag = liveBag();
    const holder = harness.world.createEntity("Holder").addComponent(Holder);
    holder.target = bag;
    harness.step(1 / 60);

    reload(harness.app, BagV2);

    const rebuilt = bag.entity.getComponent(BagV2);
    expect(holder.target).toBe(rebuilt);
    expect(holder.target).not.toBeNull();
  });

  it("cancels the old instance's coroutines", () => {
    const bag = liveBag();
    const ticks: number[] = [];
    const handle = bag.startCoroutine(
      (function* forever(): Generator<null, void, unknown> {
        for (let index = 0; index < 100; index += 1) {
          ticks.push(index);
          yield null;
        }
      })(),
    );
    harness.step(1 / 60);
    const before = ticks.length;

    reload(harness.app, BagV2);
    harness.step(1 / 60);

    expect(handle.isRunning).toBe(false);
    expect(ticks.length).toBe(before);
  });

  it("keeps a disabled instance disabled and gives it no callbacks", () => {
    const bag = liveBag();
    bag.enabled = false;
    harness.step(1 / 60);
    harness.log.length = 0;

    reload(harness.app, BagV2);
    harness.step(1 / 60);

    const rebuilt = bag.entity.getComponent(BagV2);
    expect(rebuilt?.enabled).toBe(false);
    expect(harness.log).toEqual(["onDestroy:chest"]);
  });

  it("carries references, assets, and schema fields across, and resets transient ones", () => {
    const world = harness.world;
    const friend = world.createEntity("Friend");
    const note = world.createEntity("Note").addComponent(Note, { text: "hello" });
    const clip = fakeHandle("audio/beep.wav", new Clip(), "audio");
    const entity = world.createEntity("Rich");
    const rich = entity.addComponent(RichV1);
    rich.speed = 12;
    rich.friend = friend;
    rich.buddy = note;
    rich.clip = clip;
    rich.scratch = 99;
    harness.step(1 / 60);

    const report = reload(harness.app, RichV2);

    expect(report.kind).toBe("recreate");
    const rebuilt = entity.getComponent(RichV2);
    expect(rebuilt?.version()).toBe("v2");
    expect(rebuilt?.speed).toBe(12);
    expect(rebuilt?.friend).toBe(friend);
    expect(rebuilt?.buddy).toBe(note);
    expect(rebuilt?.clip).toBe(clip);
    // `transient` fields are excluded from the round trip, so they take their default again.
    expect(rebuilt?.scratch).toBe(0);
  });

  it("re-creates a class that declares no schema at all", () => {
    const entity = harness.world.createEntity("Bare");
    const bare = entity.addComponent(BareV1);
    bare.touched = 5;
    harness.step(1 / 60);

    const report = reload(harness.app, BareV2);

    expect(report.instances).toBe(1);
    const rebuilt = entity.getComponent(BareV2);
    expect(rebuilt).not.toBe(bare);
    expect(rebuilt?.touched).toBe(1);
    expect(rebuilt?.uid).toBe(bare.uid);
  });

  it("warns about every field the replacement no longer declares", () => {
    const entity = harness.world.createEntity("Rich");
    const rich = entity.addComponent(RichV1);
    rich.speed = 4;
    rich.friend = entity;
    harness.step(1 / 60);

    reload(harness.app, RichTrimmed);

    expect(entity.getComponent(RichTrimmed)?.speed).toBe(4);
    expect(linesContaining(harness.sink, CoreErrorCode.schemaUnknownField).length).toBeGreaterThan(0);
  });

  it("skips an instance whose entity was destroyed in the same flush", () => {
    const bag = liveBag();
    bag.entity.destroy();

    const report = reload(harness.app, BagV2);

    expect(report.instances).toBe(0);
    expect(harness.world.components(BagV2)).toEqual([]);
  });

  it("falls back to recreate with IGX-0207 when a patched class changed its schema shape", () => {
    const entity = harness.world.createEntity("Player");
    const mover = entity.addComponent(MoverV1, { speed: 3 });
    harness.step(1 / 60);

    const report = reload(harness.app, MoverReshaped);

    expect(report.kind).toBe("recreate");
    expect(linesContaining(harness.sink, CoreErrorCode.hotReloadSchemaChanged)).toHaveLength(1);
    const rebuilt = entity.getComponent(MoverReshaped);
    expect(rebuilt).not.toBe(mover);
    expect(rebuilt?.speed).toBe(3);
    expect(rebuilt?.turbo).toBe(2);
    expect(rebuilt?.version()).toBe("reshaped");
  });
});
