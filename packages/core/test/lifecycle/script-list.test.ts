import { describe, expect, it } from "vitest";
import { ScriptCallbackKind } from "../../src/lifecycle/callbacks.js";
import { ScriptList } from "../../src/lifecycle/script-list.js";
import { createTestWorld } from "../support/create-test-world.js";
import { EarlyScript, LateScript, RecordingScript } from "../support/recording-script.js";
import type { ScriptClassInfo } from "../../src/component/component-registry.js";
import type { Script } from "../../src/script/script.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * The sorted dispatch list behind `world.scriptsWith` and `world.forEachScript`
 * (`docs/architecture/01-lifecycle-and-time.md` §3).
 */

/**
 * The class info of a script, which the list needs for its sort key.
 *
 * @param harness - The world under test.
 * @param script - The script.
 * @returns Its class's ordering data.
 */
function infoOf(harness: TestWorld, script: Script): ScriptClassInfo {
  const info = harness.world.registry.describe(script.constructor).script;
  if (info === null) {
    throw new Error("expected a script class");
  }
  return info;
}

describe("sorted insertion", () => {
  it("orders by executionOrder, then by creation serial", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const late = entity.addComponent(LateScript, { label: "late" });
    const middleA = entity.addComponent(RecordingScript, { label: "a" });
    const early = entity.addComponent(EarlyScript, { label: "early" });
    const middleB = entity.addComponent(RecordingScript, { label: "b" });
    const list = new ScriptList();
    for (const script of [late, middleA, early, middleB]) {
      list.insert(script, infoOf(harness, script));
    }
    expect(list.items).toEqual([early, middleA, middleB, late]);
    harness.dispose();
  });

  it("ignores a duplicate insert", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    const list = new ScriptList();
    list.insert(script, infoOf(harness, script));
    list.insert(script, infoOf(harness, script));
    expect(list.items).toEqual([script]);
    harness.dispose();
  });

  it("ignores a removal of a script that is not in the list", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    const list = new ScriptList();
    expect(() => {
      list.remove(script);
    }).not.toThrow();
    expect(list.items).toEqual([]);
    harness.dispose();
  });
});

describe("mutation during a walk", () => {
  it("applies an insert only once the walk has finished", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const early = entity.addComponent(EarlyScript, { label: "early" });
    const late = entity.addComponent(LateScript, { label: "late" });
    const list = new ScriptList();
    list.insert(early, infoOf(harness, early));
    harness.flushA();
    const visited: Script[] = [];
    list.forEach((script) => {
      visited.push(script);
      list.insert(late, infoOf(harness, late));
    });
    expect(visited).toEqual([early]);
    expect(list.items).toEqual([early, late]);
    harness.dispose();
  });

  it("applies a removal only once the walk has finished, and skips it meanwhile", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const early = entity.addComponent(EarlyScript, { label: "early" });
    const late = entity.addComponent(LateScript, { label: "late" });
    harness.flushA();
    const list = new ScriptList();
    list.insert(early, infoOf(harness, early));
    list.insert(late, infoOf(harness, late));
    const visited: Script[] = [];
    list.forEach((script) => {
      visited.push(script);
      list.remove(late);
      late.enabled = false;
    });
    expect(visited).toEqual([early]);
    expect(list.items).toEqual([early]);
    harness.dispose();
  });

  it("visits only scripts that are effectively enabled", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const enabled = entity.addComponent(EarlyScript, { label: "on" });
    const disabled = entity.addComponent(LateScript, { label: "off" });
    harness.flushA();
    disabled.enabled = false;
    const list = new ScriptList();
    list.insert(enabled, infoOf(harness, enabled));
    list.insert(disabled, infoOf(harness, disabled));
    const visited: Script[] = [];
    list.forEach((script) => visited.push(script));
    expect(visited).toEqual([enabled]);
    harness.dispose();
  });

  it("restores its depth when a visitor throws", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.flushA();
    const list = new ScriptList();
    list.insert(script, infoOf(harness, script));
    expect(() => {
      list.forEach(() => {
        throw new Error("boom");
      });
    }).toThrow("boom");
    list.remove(script);
    expect(list.items).toEqual([]);
    harness.dispose();
  });

  it("empties on clear", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    const list = new ScriptList();
    list.insert(script, infoOf(harness, script));
    list.clear();
    expect(list.items).toEqual([]);
    harness.dispose();
  });
});

describe("the world's dispatch lists", () => {
  it("returns a shared empty list for a callback ordinal with no list", () => {
    const harness = createTestWorld();
    expect(harness.lifecycle.scriptsWith(ScriptCallbackKind.awake)).toEqual([]);
    expect(() => {
      harness.lifecycle.forEachScript(ScriptCallbackKind.awake, () => {
        throw new Error("should not be visited");
      });
    }).not.toThrow();
    harness.dispose();
  });
});
