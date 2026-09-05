import { describe, expect, it } from "vitest";
import { ComponentStore } from "../../src/component/component-store.js";
import { Component } from "../../src/component/component.js";
import { componentInternals } from "../../src/component/internals.js";
import { ReferenceTracker } from "../../src/component/reference-tracker.js";
import { entityRef } from "../../src/schema/field-kinds.js";
import { Script } from "../../src/script/script.js";
import { Transform } from "../../src/transform/transform.js";
import { createTestWorld } from "../support/create-test-world.js";
import { RecordingScript } from "../support/recording-script.js";
import type { Entity } from "../../src/entity/entity.js";

/** `docs/architecture/03-scripting-and-components.md` §1. */

/** A component that records its attach and detach hooks. */
class Hooked extends Component {
  static typeId = "test/Hooked";
  attached = 0;
  detached = 0;

  onAttach(): void {
    this.attached += 1;
  }

  onDetach(): void {
    this.detached += 1;
  }
}

/** A component whose `onDetach` throws. */
class BadDetach extends Component {
  static typeId = "test/BadDetach";

  onDetach(): void {
    throw new Error("detach boom");
  }
}

describe("identity and access", () => {
  it("gives every component a uid, a handle, and its entity's context", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    expect(script.entity).toBe(entity);
    expect(script.transform).toBe(entity.transform);
    expect(script.world).toBe(harness.world);
    expect(script.app).toBe(harness.app);
    expect(script.uid).not.toBe("");
    expect(script.handle).toBeGreaterThan(0);
    harness.dispose();
  });

  it("offers getComponent and requireComponent as sugar for the entity's", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    expect(script.getComponent(Transform)).toBe(entity.transform);
    expect(script.requireComponent(Transform)).toBe(entity.transform);
    expect(script.getComponent(Hooked)).toBeNull();
    expect(() => script.requireComponent(Hooked)).toThrow(/IGX-0201/u);
    harness.dispose();
  });
});

describe("hooks", () => {
  it("runs onAttach once, while the entity may still be inactive", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.active = false;
    const hooked = entity.addComponent(Hooked);
    expect(hooked.attached).toBe(1);
    expect(hooked.detached).toBe(0);
    harness.dispose();
  });

  it("runs onDetach once, in the destroy flush", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const hooked = entity.addComponent(Hooked);
    hooked.destroy();
    expect(hooked.detached).toBe(0);
    harness.flushDestroy();
    expect(hooked.detached).toBe(1);
    harness.dispose();
  });

  it("reports a throwing onDetach instead of aborting the flush", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(BadDetach);
    entity.addComponent(RecordingScript, { label: "a" });
    entity.destroy();
    expect(() => {
      harness.flushDestroy();
    }).not.toThrow();
    expect(harness.errors).toHaveLength(1);
    expect(harness.log).toContain("onDestroy:a");
    harness.dispose();
  });
});

describe("enabled", () => {
  it("defaults to true and reports the hierarchy-effective value", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    const script = child.addComponent(RecordingScript, { label: "a" });
    expect(script.enabled).toBe(true);
    expect(script.isEnabledInHierarchy).toBe(true);
    parent.active = false;
    expect(script.enabled).toBe(true);
    expect(script.isEnabledInHierarchy).toBe(false);
    parent.active = true;
    script.enabled = false;
    expect(script.isEnabledInHierarchy).toBe(false);
    harness.dispose();
  });

  it("ignores a redundant write", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.log.length = 0;
    script.enabled = true;
    expect(harness.log).toEqual([]);
    harness.dispose();
  });

  it("throws IGX-0101 when set after destroy", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    script.destroy();
    expect(() => {
      script.enabled = false;
    }).toThrow(/IGX-0101/u);
    expect(script.isEnabledInHierarchy).toBe(false);
    harness.dispose();
  });
});

describe("onDestroyed", () => {
  it("is created on first access and emitted in the destroy flush", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    const seen: unknown[] = [];
    script.onDestroyed.connect((value) => seen.push(value));
    expect(script.onDestroyed).toBe(script.onDestroyed);
    script.destroy();
    harness.flushDestroy();
    expect(seen).toEqual([script]);
    harness.dispose();
  });

  it("auto-disconnects a signal handler owned by a destroyed component", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const owner = entity.addComponent(RecordingScript, { label: "owner" });
    const seen: number[] = [];
    harness.world.onEntityCreated.connect(() => seen.push(1), { owner });
    harness.world.createEntity("first");
    owner.destroy();
    harness.flushDestroy();
    harness.world.createEntity("second");
    expect(seen).toEqual([1]);
    harness.dispose();
  });

  it("makes connecting on behalf of an already destroyed owner a no-op", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const owner = entity.addComponent(RecordingScript, { label: "owner" });
    owner.destroy();
    harness.flushDestroy();
    const seen: number[] = [];
    harness.world.onEntityCreated.connect(() => seen.push(1), { owner });
    harness.world.createEntity("later");
    expect(seen).toEqual([]);
    harness.dispose();
  });
});

describe("the per-type store, in isolation", () => {
  it("ignores a component whose class info was never recorded", () => {
    const harness = createTestWorld();
    const store = new ComponentStore();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    const info = harness.world.registry.describe(RecordingScript);
    store.add(script, info);
    expect(store.components(Script)).toEqual([script]);
    store.remove(script, info);
    expect(store.components(Script)).toEqual([]);
    store.clear();
    expect(store.components(Component)).toEqual([]);
    harness.dispose();
  });

  it("survives a removal of a component that was never added", () => {
    const harness = createTestWorld();
    const store = new ComponentStore();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    const info = harness.world.registry.describe(RecordingScript);
    expect(() => {
      store.remove(script, info);
    }).not.toThrow();
    harness.dispose();
  });
});

describe("the reference tracker, in isolation", () => {
  it("only watches components whose class declares tracked fields", () => {
    const harness = createTestWorld();
    class Holder extends Script.define({ target: entityRef<Entity>() }) {
      static typeId = "test/TrackerHolder";
    }
    const tracker = new ReferenceTracker();
    const entity = harness.world.createEntity("entity");
    const plain = entity.addComponent(RecordingScript, { label: "a" });
    const holder = entity.addComponent(Holder);
    tracker.watch(plain);
    expect(tracker.size).toBe(0);
    tracker.watch(holder);
    tracker.watch(holder);
    expect(tracker.size).toBe(1);
    tracker.unwatch(holder);
    tracker.unwatch(holder);
    expect(tracker.size).toBe(0);
    harness.dispose();
  });

  it("swap-removes the middle holder without losing the others", () => {
    const harness = createTestWorld();
    class Holder extends Script.define({ target: entityRef<Entity>() }) {
      static typeId = "test/SwapHolder";
    }
    const tracker = new ReferenceTracker();
    const entity = harness.world.createEntity("entity");
    const first = entity.addComponent(Holder);
    const second = entity.addComponent(Holder);
    const third = entity.addComponent(Holder);
    const target = harness.world.createEntity("target");
    for (const holder of [first, second, third]) {
      tracker.watch(holder);
      holder.target = target;
    }
    tracker.unwatch(second);
    expect(tracker.size).toBe(2);
    tracker.nullReferencesTo(new Set([target]));
    expect(first.target).toBeNull();
    expect(third.target).toBeNull();
    expect(second.target).toBe(target);
    harness.dispose();
  });

  it("does nothing for an empty doomed set or an empty holder list", () => {
    const tracker = new ReferenceTracker();
    expect(() => {
      tracker.nullReferencesTo(new Set());
    }).not.toThrow();
    tracker.clear();
    expect(tracker.size).toBe(0);
  });
});

describe("internal state", () => {
  it("starts a component unattached, with no identity and no queue membership", () => {
    const detached = new Hooked();
    const state = componentInternals(detached);
    expect(state.entity).toBeNull();
    expect(state.info).toBeNull();
    expect(state.handle).toBe(0);
    expect(state.hasAwoken).toBe(false);
    expect(state.hasStarted).toBe(false);
    expect(state.storeSlots).toEqual([]);
  });
});
