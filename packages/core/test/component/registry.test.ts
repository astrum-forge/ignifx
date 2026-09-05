import { describe, expect, it } from "vitest";
import { ComponentRegistry, implementsCallback } from "../../src/component/component-registry.js";
import { Component } from "../../src/component/component.js";
import { ScriptCallbackKind } from "../../src/lifecycle/callbacks.js";
import { f32 } from "../../src/schema/field-kinds.js";
import { Script } from "../../src/script/script.js";
import { Transform } from "../../src/transform/transform.js";

/** `docs/architecture/03-scripting-and-components.md` §4. */

/** A script that implements exactly two callbacks. */
class Partial extends Script {
  static typeId = "test/Partial";
  static executionOrder = 7;
  static updateWhenPaused = true;

  awake(): void {
    // Deliberately empty: the subject is that the registry notices the method exists.
  }

  update(dt: number): void {
    void dt;
  }
}

/** A script that implements nothing. */
class Bare extends Script {
  static typeId = "test/Bare";
}

/** A plain component with a schema carrying no references. */
class Plain extends Component.define({ value: f32(0) }) {
  static typeId = "test/Plain";
}

describe("registration", () => {
  it("maps a namespaced type id onto its class", () => {
    const registry = new ComponentRegistry();
    registry.register(Partial);
    expect(registry.get("test/Partial")).toBe(Partial);
    expect(registry.get("test/Missing")).toBeNull();
    expect(registry.isRegistered(Partial)).toBe(true);
    expect(registry.isRegistered(Bare)).toBe(false);
    harnessSize(registry, 1);
  });

  it("registers several classes at once", () => {
    const registry = new ComponentRegistry();
    registry.registerAll([Partial, Bare, Plain]);
    expect(registry.get("test/Bare")).toBe(Bare);
    harnessSize(registry, 3);
  });

  it("accepts an explicit type id for a class that declares none", () => {
    const registry = new ComponentRegistry();
    class Anonymous extends Script {}
    registry.register(Anonymous, "test/Anonymous");
    expect(registry.get("test/Anonymous")).toBe(Anonymous);
  });

  it("throws IGX-0203 when two classes claim one type id", () => {
    const registry = new ComponentRegistry();
    class Other extends Script {
      static typeId = "test/Partial";
    }
    registry.register(Partial);
    expect(() => registry.register(Other)).toThrow(/IGX-0203/u);
  });

  it("tolerates registering the same class twice", () => {
    const registry = new ComponentRegistry();
    registry.register(Partial);
    expect(() => registry.register(Partial)).not.toThrow();
  });

  it("rejects a malformed type id with IGX-0203", () => {
    const registry = new ComponentRegistry();
    class Bad extends Script {
      static typeId = "NoNamespace";
    }
    class AlsoBad extends Script {
      static typeId = "game/lowercase/Name/";
    }
    expect(() => registry.register(Bad)).toThrow(/IGX-0203/u);
    expect(() => registry.register(AlsoBad)).toThrow(/IGX-0203/u);
  });

  it("throws IGX-0204 when a class without a type id must be serialized", () => {
    const registry = new ComponentRegistry();
    expect(registry.requireTypeId(Partial)).toBe("test/Partial");
    class Anonymous extends Script {}
    expect(() => registry.requireTypeId(Anonymous)).toThrow(/IGX-0204/u);
  });
});

describe("class info", () => {
  it("describes a class the first time it is seen, without explicit registration", () => {
    const registry = new ComponentRegistry();
    const info = registry.describe(Bare);
    expect(info.type).toBe(Bare);
    expect(info.typeId).toBe("test/Bare");
    expect(info.isScript).toBe(true);
    expect(registry.describe(Bare)).toBe(info);
  });

  it("records the ancestor chain nearest first, ending at Component", () => {
    const registry = new ComponentRegistry();
    expect(registry.describe(Partial).ancestors).toEqual([Partial, Script, Component]);
    expect(registry.describe(Transform).ancestors).toEqual([Transform, Component]);
  });

  it("records which callbacks the class implements, once per class", () => {
    const registry = new ComponentRegistry();
    const info = registry.describe(Partial).script;
    expect(implementsCallback(info, ScriptCallbackKind.awake)).toBe(true);
    expect(implementsCallback(info, ScriptCallbackKind.update)).toBe(true);
    expect(implementsCallback(info, ScriptCallbackKind.start)).toBe(false);
    expect(implementsCallback(info, ScriptCallbackKind.onCollisionEnter)).toBe(false);
    expect(implementsCallback(registry.describe(Bare).script, ScriptCallbackKind.update)).toBe(false);
    expect(implementsCallback(null, ScriptCallbackKind.update)).toBe(false);
  });

  it("carries executionOrder and updateWhenPaused from the class statics", () => {
    const registry = new ComponentRegistry();
    const info = registry.describe(Partial).script;
    expect(info?.executionOrder).toBe(7);
    expect(info?.updateWhenPaused).toBe(true);
    const bare = registry.describe(Bare).script;
    expect(bare?.executionOrder).toBe(0);
    expect(bare?.updateWhenPaused).toBe(false);
  });

  it("leaves script info null for a plain component", () => {
    const registry = new ComponentRegistry();
    const info = registry.describe(Plain);
    expect(info.isScript).toBe(false);
    expect(info.script).toBeNull();
  });

  it("lists only the tracked reference fields of a schema", () => {
    const registry = new ComponentRegistry();
    expect(registry.describe(Plain).trackedFields).toEqual([]);
    expect(registry.describe(Bare).schema).toBeNull();
  });

  it("assigns a dense class index in first-sight order", () => {
    const registry = new ComponentRegistry();
    expect(registry.describe(Bare).classIndex).toBe(0);
    expect(registry.describe(Partial).classIndex).toBe(1);
    expect(registry.describe(Bare).classIndex).toBe(0);
  });

  it("defaults allowMultiple to true and reads it from the class when set", () => {
    const registry = new ComponentRegistry();
    expect(registry.describe(Bare).allowMultiple).toBe(true);
    expect(registry.describe(Transform).allowMultiple).toBe(false);
    expect(registry.describe(Bare).requires).toEqual([]);
  });
});

/**
 * Asserts a registry's described-class count.
 *
 * @param registry - The registry.
 * @param expected - How many classes it should have described.
 */
function harnessSize(registry: ComponentRegistry, expected: number): void {
  expect(registry.size).toBe(expected);
}
