import { describe, expect, it } from "vitest";
import { Component } from "../../src/component/component.js";
import { componentInternals } from "../../src/component/internals.js";
import { entityInternals } from "../../src/entity/internals.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { isNodeVisible } from "../../src/lite/node.js";
import { entityRef } from "../../src/schema/field-kinds.js";
import { Script } from "../../src/script/script.js";
import { createTestWorld } from "../support/create-test-world.js";
import { EarlyScript, LateScript, RecordingScript, SilentScript } from "../support/recording-script.js";
import type { Entity } from "../../src/entity/entity.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * One test per bullet of `docs/architecture/01-lifecycle-and-time.md` §4 "Guarantees and
 * constraints" and §6, driven by calling the flushes directly. The frame-driven variant lives with
 * the scheduler.
 */

/**
 * Builds `parent > child` with a recorder on each, labelled by name.
 *
 * @param harness - The world under test.
 * @param names - The labels, outermost first.
 * @returns The entities, outermost first.
 */
function chain(harness: TestWorld, ...names: readonly string[]): Entity[] {
  const entities: Entity[] = [];
  let parent: Entity | undefined;
  for (const name of names) {
    const entity = harness.world.createEntity(name, parent === undefined ? undefined : { parent });
    entity.addComponent(RecordingScript, { label: name });
    entities.push(entity);
    parent = entity;
  }
  return entities;
}

describe("lifecycle flush A — awake and onEnable", () => {
  it("runs awake in tree order: parents before children", () => {
    const harness = createTestWorld();
    chain(harness, "parent", "child", "grandchild");
    harness.flushA();
    expect(harness.log.filter((entry) => entry.startsWith("awake"))).toEqual([
      "awake:parent",
      "awake:child",
      "awake:grandchild",
    ]);
    harness.dispose();
  });

  it("runs awake on siblings in creation order", () => {
    const harness = createTestWorld();
    const root = harness.world.createEntity("root");
    for (const name of ["first", "second", "third"]) {
      const child = harness.world.createEntity(name, { parent: root });
      child.addComponent(RecordingScript, { label: name });
    }
    harness.flushA();
    expect(harness.log.filter((entry) => entry.startsWith("awake"))).toEqual([
      "awake:first",
      "awake:second",
      "awake:third",
    ]);
    harness.dispose();
  });

  it("runs awake on an entity's components in attach order", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "one" });
    entity.addComponent(RecordingScript, { label: "two" });
    entity.addComponent(RecordingScript, { label: "three" });
    harness.flushA();
    expect(harness.log.filter((entry) => entry.startsWith("awake"))).toEqual(["awake:one", "awake:two", "awake:three"]);
    harness.dispose();
  });

  it("runs onEnable immediately after awake for each component", () => {
    const harness = createTestWorld();
    chain(harness, "a", "b");
    harness.flushA();
    expect(harness.log).toEqual(["awake:a", "onEnable:a", "awake:b", "onEnable:b"]);
    harness.dispose();
  });

  it("runs awake exactly once across any number of disable and enable cycles", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.flushA();
    script.enabled = false;
    script.enabled = true;
    harness.flushA();
    script.enabled = false;
    script.enabled = true;
    harness.flushA();
    expect(harness.log.filter((entry) => entry === "awake:a")).toHaveLength(1);
    expect(harness.log.filter((entry) => entry === "onEnable:a")).toHaveLength(3);
    harness.dispose();
  });

  it('defers awake until the component is first enabled, because "a callback never runs on a component whose enabled is false"', () => {
    // 01-lifecycle-and-time.md §4, first guarantee. The table above it says awake runs "right after
    // the component is attached to an entity that is active in the hierarchy"; the guarantee is the
    // stricter of the two, so it wins (CONSTITUTION.md §10.1 has no tie-break inside one document,
    // and a stricter reading never breaks the looser one).
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    script.enabled = false;
    harness.flushA();
    expect(harness.log).toEqual([]);
    script.enabled = true;
    harness.flushA();
    expect(harness.log).toEqual(["awake:a", "onEnable:a"]);
    harness.dispose();
  });

  it("runs no callback on a component whose entity is inactive in the hierarchy", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    child.addComponent(RecordingScript, { label: "a" });
    parent.active = false;
    harness.flushA();
    harness.flushB();
    expect(harness.log).toEqual([]);
    harness.dispose();
  });

  it("runs awake synchronously and nested for a component added from inside a callback", () => {
    const harness = createTestWorld();
    class Creator extends RecordingScript {
      static override typeId = "test/Creator";
      override awake(): void {
        super.awake();
        const nested = this.world.createEntity("nested");
        nested.addComponent(RecordingScript, { label: "nested" });
        this.record("after-create");
      }
    }
    const entity = harness.world.createEntity("creator");
    entity.addComponent(Creator, { label: "creator" });
    harness.flushA();
    expect(harness.log).toEqual([
      "awake:creator",
      "awake:nested",
      "onEnable:nested",
      "after-create:creator",
      "onEnable:creator",
    ]);
    harness.dispose();
  });

  it("defers the start of a component created inside a callback to the next flush B", () => {
    const harness = createTestWorld();
    class Creator extends RecordingScript {
      static override typeId = "test/CreatorForStart";
      override start(): void {
        super.start();
        const nested = this.world.createEntity("nested");
        nested.addComponent(RecordingScript, { label: "nested" });
      }
    }
    const entity = harness.world.createEntity("creator");
    entity.addComponent(Creator, { label: "creator" });
    harness.flushA();
    harness.flushB();
    expect(harness.log).toContain("awake:nested");
    expect(harness.log).not.toContain("start:nested");
    harness.flushB();
    expect(harness.log).toContain("start:nested");
    harness.dispose();
  });
});

describe("lifecycle flush B — start", () => {
  it("runs start in executionOrder, then creation order", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "default-1" });
    entity.addComponent(LateScript, { label: "late" });
    entity.addComponent(EarlyScript, { label: "early" });
    entity.addComponent(RecordingScript, { label: "default-2" });
    harness.flushA();
    harness.flushB();
    expect(harness.log.filter((entry) => entry.startsWith("start"))).toEqual([
      "start:early",
      "start:default-1",
      "start:default-2",
      "start:late",
    ]);
    harness.dispose();
  });

  it("runs start once ever, even across disable and enable cycles", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.flushA();
    harness.flushB();
    script.enabled = false;
    script.enabled = true;
    harness.flushA();
    harness.flushB();
    expect(harness.log.filter((entry) => entry === "start:a")).toHaveLength(1);
    harness.dispose();
  });

  it("holds start back until the first flush at which the component is effectively enabled", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.flushA();
    script.enabled = false;
    harness.flushB();
    expect(harness.log).not.toContain("start:a");
    script.enabled = true;
    harness.flushA();
    harness.flushB();
    expect(harness.log.filter((entry) => entry === "start:a")).toHaveLength(1);
    harness.dispose();
  });
});

describe("activation", () => {
  it("disables every descendant's components when a parent is deactivated", () => {
    const harness = createTestWorld();
    const [parent] = chain(harness, "parent", "child", "grandchild");
    harness.frame();
    harness.log.length = 0;
    if (parent === undefined) {
      throw new Error("missing parent");
    }
    parent.active = false;
    expect(harness.log).toEqual(["onDisable:parent", "onDisable:child", "onDisable:grandchild"]);
    harness.dispose();
  });

  it("re-enables descendants on re-activation without running start again", () => {
    const harness = createTestWorld();
    const [parent] = chain(harness, "parent", "child");
    harness.frame();
    if (parent === undefined) {
      throw new Error("missing parent");
    }
    parent.active = false;
    parent.active = true;
    harness.frame();
    expect(harness.log.filter((entry) => entry.startsWith("start"))).toEqual(["start:parent", "start:child"]);
    expect(harness.log.filter((entry) => entry === "onEnable:child")).toHaveLength(2);
    harness.dispose();
  });

  it("keeps activeInHierarchy false on a child of an inactive parent", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    parent.active = false;
    expect(child.active).toBe(true);
    expect(child.activeInHierarchy).toBe(false);
    expect(parent.activeInHierarchy).toBe(false);
    harness.dispose();
  });

  it("follows activeInHierarchy with Babylon Lite node visibility", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    expect(isNodeVisible(child.transform.lite)).toBe(true);
    parent.active = false;
    expect(isNodeVisible(parent.transform.lite)).toBe(false);
    expect(isNodeVisible(child.transform.lite)).toBe(false);
    parent.active = true;
    expect(isNodeVisible(child.transform.lite)).toBe(true);
    harness.dispose();
  });

  it("re-applies visibility when an entity is reparented under a hidden parent", () => {
    // ADR-0003 Validation: Lite materialises the cascade at write time, so a node linked under a
    // hidden parent afterwards does not inherit it.
    const harness = createTestWorld();
    const hidden = harness.world.createEntity("hidden");
    hidden.active = false;
    const orphan = harness.world.createEntity("orphan");
    expect(isNodeVisible(orphan.transform.lite)).toBe(true);
    orphan.setParent(hidden);
    expect(orphan.activeInHierarchy).toBe(false);
    expect(isNodeVisible(orphan.transform.lite)).toBe(false);
    harness.dispose();
  });

  it("emits onActiveChanged for the entity's own flag only", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    const seen: boolean[] = [];
    child.onActiveChanged.connect((value) => seen.push(value));
    parent.active = false;
    expect(seen).toEqual([]);
    child.active = false;
    expect(seen).toEqual([false]);
    harness.dispose();
  });

  it("pauses coroutines on disable and resumes them on enable", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.coroutines.calls.length = 0;
    script.enabled = false;
    script.enabled = true;
    harness.flushA();
    expect(harness.coroutines.ofKind("setPaused").map((call) => call.paused)).toEqual([true, false]);
    harness.dispose();
  });
});

describe("destruction", () => {
  it("reports isDestroyed immediately but keeps the object usable until the flush", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    entity.destroy();
    expect(entity.isDestroyed).toBe(true);
    expect(script.isDestroyed).toBe(true);
    expect(harness.log).not.toContain("onDestroy:a");
    expect(harness.world.getEntity(entity.uid)).toBe(entity);
    harness.flushDestroy();
    expect(harness.log).toContain("onDestroy:a");
    expect(harness.world.getEntity(entity.uid)).toBeNull();
    harness.dispose();
  });

  it("marks the whole subtree destroyed immediately", () => {
    const harness = createTestWorld();
    const [parent, child, grandchild] = chain(harness, "parent", "child", "grandchild");
    parent?.destroy();
    expect(child?.isDestroyed).toBe(true);
    expect(grandchild?.isDestroyed).toBe(true);
    harness.dispose();
  });

  it("throws IGX-0101 on a structural change after destroy", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.destroy();
    for (const mutate of [
      () => entity.addComponent(RecordingScript),
      () => entity.setParent(null),
      () => {
        entity.active = false;
      },
      () => {
        entity.layer = 1;
      },
      () => {
        entity.name = "renamed";
      },
      () => {
        entity.isStatic = true;
      },
    ]) {
      expect(mutate).toThrow(/IGX-0101/u);
    }
    harness.dispose();
  });

  it("leaves transform writes unguarded after destroy, because they are the hot path", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.destroy();
    expect(() => {
      entity.transform.localPosition.x = 5;
    }).not.toThrow();
    expect(entity.transform.localPosition.x).toBe(5);
    harness.dispose();
  });

  it("destroys children before parents", () => {
    const harness = createTestWorld();
    const [parent] = chain(harness, "parent", "child", "grandchild");
    harness.frame();
    harness.log.length = 0;
    parent?.destroy();
    harness.flushDestroy();
    expect(harness.log.filter((entry) => entry.startsWith("onDestroy"))).toEqual([
      "onDestroy:grandchild",
      "onDestroy:child",
      "onDestroy:parent",
    ]);
    harness.dispose();
  });

  it("runs onDisable before onDestroy", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.log.length = 0;
    entity.destroy();
    harness.flushDestroy();
    expect(harness.log).toEqual(["onDisable:a", "onDestroy:a", "onDetach:a"]);
    harness.dispose();
  });

  it("runs onDetach after onDestroy", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    entity.destroy();
    harness.flushDestroy();
    expect(harness.log.indexOf("onDetach:a")).toBeGreaterThan(harness.log.indexOf("onDestroy:a"));
    harness.dispose();
  });

  it("releases an entity's components in attach order", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "one" });
    entity.addComponent(RecordingScript, { label: "two" });
    harness.frame();
    harness.log.length = 0;
    entity.destroy();
    harness.flushDestroy();
    expect(harness.log.filter((entry) => entry.startsWith("onDestroy"))).toEqual(["onDestroy:one", "onDestroy:two"]);
    harness.dispose();
  });

  it("cancels coroutines when a script is destroyed", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    entity.destroy();
    harness.flushDestroy();
    expect(harness.coroutines.ofKind("cancelAll").map((call) => call.owner)).toContain(script);
    harness.dispose();
  });

  it("keeps destroy() safe from inside a callback", () => {
    const harness = createTestWorld();
    class SelfDestruct extends RecordingScript {
      static override typeId = "test/SelfDestruct";
      override start(): void {
        super.start();
        this.entity.destroy();
        this.record(this.entity.isDestroyed ? "flagged" : "not-flagged");
        this.record(this.entity.transform.lite.name);
      }
    }
    const entity = harness.world.createEntity("doomed");
    entity.addComponent(SelfDestruct, { label: "a" });
    harness.flushA();
    harness.flushB();
    expect(harness.log).toContain("flagged:a");
    expect(harness.log).toContain("doomed:a");
    harness.flushDestroy();
    expect(harness.log).toContain("onDestroy:a");
    harness.dispose();
  });

  it("throws IGX-0102 when destroyImmediate runs inside a callback", () => {
    const harness = createTestWorld();
    let caught: unknown = null;
    class Immediate extends RecordingScript {
      static override typeId = "test/Immediate";
      override start(): void {
        try {
          this.entity.destroyImmediate();
        } catch (error) {
          caught = error;
        }
      }
    }
    const entity = harness.world.createEntity("entity");
    entity.addComponent(Immediate, { label: "a" });
    harness.flushA();
    harness.flushB();
    expect(isIgnifxError(caught) && caught.code).toBe("IGX-0102");
    harness.dispose();
  });

  it("runs the destroy flush now for destroyImmediate outside a callback", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.log.length = 0;
    entity.destroyImmediate();
    expect(harness.log).toEqual(["onDisable:a", "onDestroy:a", "onDetach:a"]);
    harness.dispose();
  });

  it("emits onEntityDestroyed after the entity's components have run onDestroy", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.world.onEntityDestroyed.connect(() => harness.log.push("world-notified"));
    entity.destroy();
    harness.flushDestroy();
    expect(harness.log.indexOf("world-notified")).toBeGreaterThan(harness.log.indexOf("onDestroy:a"));
    harness.dispose();
  });

  it("nulls a tracked reference before the holder's own onDestroy runs", () => {
    const harness = createTestWorld();
    class Holder extends Script.define({ target: entityRef<Entity>() }) {
      static typeId = "test/Holder";
      seen: unknown = "unset";
      onDestroy(): void {
        this.seen = this.target;
      }
    }
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b");
    const holder = a.addComponent(Holder);
    holder.target = b;
    harness.frame();
    expect(holder.target).toBe(b);
    b.destroy();
    a.destroy();
    harness.flushDestroy();
    expect(holder.target).toBeNull();
    expect(holder.seen).toBeNull();
    harness.dispose();
  });

  it("nulls a tracked reference held by an entity that survives", () => {
    const harness = createTestWorld();
    class Holder extends Script.define({ target: entityRef<Entity>() }) {
      static typeId = "test/SurvivingHolder";
    }
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b");
    const holder = a.addComponent(Holder);
    holder.target = b;
    harness.frame();
    b.destroy();
    harness.flushDestroy();
    expect(holder.target).toBeNull();
    expect(a.isDestroyed).toBe(false);
    harness.dispose();
  });
});

describe("error reporting", () => {
  it("reports a throwing callback to app.onError and keeps running the other scripts", () => {
    const harness = createTestWorld();
    class Thrower extends RecordingScript {
      static override typeId = "test/Thrower";
      override awake(): void {
        super.awake();
        throw new Error("boom");
      }
    }
    const entity = harness.world.createEntity("entity");
    const bad = entity.addComponent(Thrower, { label: "bad" });
    entity.addComponent(RecordingScript, { label: "good" });
    expect(() => {
      harness.flushA();
    }).not.toThrow();
    expect(harness.log).toContain("awake:good");
    expect(harness.errors).toHaveLength(1);
    const report = harness.errors[0];
    expect(report?.source).toBe("lifecycle");
    expect(report?.entity).toBe(entity);
    expect(report?.component).toBe(bad);
    expect(report?.error).toBeInstanceOf(Error);
    expect(String(report?.error)).toContain("boom");
    harness.dispose();
  });

  it("still runs onEnable after awake threw", () => {
    const harness = createTestWorld();
    class Thrower extends RecordingScript {
      static override typeId = "test/ThrowerEnable";
      override awake(): void {
        super.awake();
        throw new Error("boom");
      }
    }
    const entity = harness.world.createEntity("entity");
    entity.addComponent(Thrower, { label: "bad" });
    harness.flushA();
    expect(harness.log).toEqual(["awake:bad", "onEnable:bad"]);
    harness.dispose();
  });
});

describe("world disposal", () => {
  it("destroys everything children before parents, onDisable before onDestroy", () => {
    const harness = createTestWorld();
    chain(harness, "parent", "child");
    harness.frame();
    harness.log.length = 0;
    harness.world.dispose();
    expect(harness.log).toEqual([
      "onDisable:child",
      "onDestroy:child",
      "onDetach:child",
      "onDisable:parent",
      "onDestroy:parent",
      "onDetach:parent",
    ]);
    expect(harness.world.isDisposed).toBe(true);
    harness.dispose();
  });

  it("cancels every coroutine and empties the component store", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.world.dispose();
    expect(harness.coroutines.ofKind("cancelAll")).toHaveLength(1);
    expect(harness.world.components(Component)).toHaveLength(0);
    harness.dispose();
  });

  it("is idempotent", () => {
    const harness = createTestWorld();
    harness.world.dispose();
    expect(() => {
      harness.world.dispose();
    }).not.toThrow();
    harness.dispose();
  });
});

describe("dispatch lists", () => {
  it("only lists scripts that implement the callback", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const recorder = entity.addComponent(RecordingScript, { label: "a" });
    entity.addComponent(SilentScript);
    harness.flushA();
    expect(harness.lifecycle.scriptsWith(6)).toEqual([recorder]);
    harness.dispose();
  });

  it("sorts the dispatch list by executionOrder then creation serial", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const late = entity.addComponent(LateScript, { label: "late" });
    const first = entity.addComponent(RecordingScript, { label: "first" });
    const early = entity.addComponent(EarlyScript, { label: "early" });
    const second = entity.addComponent(RecordingScript, { label: "second" });
    harness.flushA();
    expect(harness.lifecycle.scriptsWith(6)).toEqual([early, first, second, late]);
    harness.dispose();
  });

  it("skips a script that another script disabled during the walk", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const early = entity.addComponent(EarlyScript, { label: "early" });
    const late = entity.addComponent(LateScript, { label: "late" });
    harness.flushA();
    harness.log.length = 0;
    harness.lifecycle.forEachScript(6, (script) => {
      harness.log.push(`visit:${script === early ? "early" : "late"}`);
      late.enabled = false;
    });
    expect(harness.log.filter((entry) => entry.startsWith("visit"))).toEqual(["visit:early"]);
    harness.dispose();
  });

  it("leaves a script enabled during the walk for the next walk", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const early = entity.addComponent(EarlyScript, { label: "early" });
    const late = entity.addComponent(LateScript, { label: "late" });
    late.enabled = false;
    harness.flushA();
    const visited: string[] = [];
    harness.lifecycle.forEachScript(6, (script) => {
      visited.push(script === early ? "early" : "late");
      late.enabled = true;
    });
    expect(visited).toEqual(["early"]);
    harness.flushA();
    const second: string[] = [];
    harness.lifecycle.forEachScript(6, (script) => {
      second.push(script === early ? "early" : "late");
    });
    expect(second).toEqual(["early", "late"]);
    harness.dispose();
  });

  it("removes a destroyed script from the dispatch list in the destroy flush", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    expect(harness.lifecycle.scriptsWith(6)).toHaveLength(1);
    entity.destroy();
    harness.flushDestroy();
    expect(harness.lifecycle.scriptsWith(6)).toHaveLength(0);
    harness.dispose();
  });
});

describe("engine bookkeeping", () => {
  it("freezes isStatic once any component has awoken", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.isStatic = true;
    entity.addComponent(RecordingScript, { label: "a" });
    harness.flushA();
    expect(entityInternals(entity).hasAwoken).toBe(true);
    expect(() => {
      entity.isStatic = false;
    }).toThrow(/IGX-0101/u);
    harness.dispose();
  });

  it("keeps the component's creation serial monotonic", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const first = entity.addComponent(RecordingScript, { label: "one" });
    const second = entity.addComponent(RecordingScript, { label: "two" });
    expect(componentInternals(second).serial).toBeGreaterThan(componentInternals(first).serial);
    harness.dispose();
  });
});
