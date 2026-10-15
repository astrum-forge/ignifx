import { describe, expect, it } from "vitest";
import { Component } from "../../src/component/component.js";
import { isUlid } from "../../src/ids/ulid.js";
import { readNodeTag } from "../../src/lite/node.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { bool, color, f32, i32, optional, record } from "../../src/schema/field-kinds.js";
import { Script } from "../../src/script/script.js";
import { Transform } from "../../src/transform/transform.js";
import { createTestWorld } from "../support/create-test-world.js";
import { RecordingScript } from "../support/recording-script.js";

/** `docs/architecture/02-scene-graph.md` §4. */

/** A component with two schema fields, for `init` and default assertions. */
class Health extends Component.define({ maximum: f32(100), armor: i32(2) }) {
  static typeId = "test/Health";
}

/** A component with nested and optional records, for partial `init` assertions. */
class Lamp extends Component.define({
  glow: record({
    enabled: bool(false),
    strength: f32(0.5),
    tint: color("#ff8000"),
    flicker: record({ rate: f32(2), depth: f32(0.1) }),
  }),
  backup: optional(record({ enabled: bool(true), strength: f32(0.25) })),
}) {
  static typeId = "test/Lamp";
}

/** A component that may exist only once per entity. */
class Solo extends Component {
  static typeId = "test/Solo";
  static allowMultiple = false;
}

/** A component that pulls another one in with `requires`. */
class NeedsHealth extends Component {
  static typeId = "test/NeedsHealth";
  static requires = [Health];
}

describe("identity", () => {
  it("gives every entity a ULID and a live handle", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(isUlid(entity.uid)).toBe(true);
    expect(harness.world.getEntity(entity.uid)).toBe(entity);
    expect(harness.world.getEntityByHandle(entity.handle)).toBe(entity);
    harness.dispose();
  });

  it("tags its Lite node with the entity handle so picking resolves back", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(readNodeTag(entity.transform.lite)).toEqual({ entity: entity.handle });
    harness.dispose();
  });

  it("mirrors the name onto the Lite node", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("first");
    expect(entity.transform.lite.name).toBe("first");
    entity.name = "second";
    expect(entity.name).toBe("second");
    expect(entity.transform.lite.name).toBe("second");
    harness.dispose();
  });

  it("names an entity Entity by default", () => {
    const harness = createTestWorld();
    expect(harness.world.createEntity().name).toBe("Entity");
    harness.dispose();
  });
});

describe("hierarchy", () => {
  it("starts as a root of the active scene", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.parent).toBeNull();
    expect(harness.world.activeScene.roots).toContain(entity);
    expect(entity.root()).toBe(entity);
    harness.dispose();
  });

  it("maintains children, parent, and the scene root list across reparenting", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b");
    b.setParent(a);
    expect(a.children).toEqual([b]);
    expect(b.parent).toBe(a);
    expect(harness.world.activeScene.roots).toEqual([a]);
    b.setParent(null);
    expect(a.children).toEqual([]);
    expect(harness.world.activeScene.roots).toEqual([a, b]);
    harness.dispose();
  });

  it("emits onChildAdded, onChildRemoved and onParentChanged", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b");
    const child = harness.world.createEntity("child");
    const seen: string[] = [];
    a.onChildAdded.connect(() => seen.push("a-added"));
    a.onChildRemoved.connect(() => seen.push("a-removed"));
    b.onChildAdded.connect(() => seen.push("b-added"));
    child.onParentChanged.connect((parent) => seen.push(`parent:${parent?.name ?? "null"}`));
    child.setParent(a);
    child.setParent(b);
    expect(seen).toEqual(["a-added", "parent:a", "a-removed", "b-added", "parent:b"]);
    harness.dispose();
  });

  it("rejects a parenting cycle with IGX-0306", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b", { parent: a });
    const c = harness.world.createEntity("c", { parent: b });
    expect(() => a.setParent(c)).toThrow(/IGX-0306/u);
    expect(() => a.setParent(a)).toThrow(/IGX-0306/u);
    harness.dispose();
  });

  it("ignores a reparent to the current parent", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b", { parent: a });
    b.setParent(a);
    expect(a.children).toEqual([b]);
    harness.dispose();
  });

  it("reports descendants and roots", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b", { parent: a });
    const c = harness.world.createEntity("c", { parent: b });
    expect(c.isDescendantOf(a)).toBe(true);
    expect(a.isDescendantOf(c)).toBe(false);
    expect(c.root()).toBe(a);
    harness.dispose();
  });

  it("moves an entity among its siblings with setSiblingIndex, clamping the index", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const [a, b, c] = ["a", "b", "c"].map((name) => harness.world.createEntity(name, { parent }));
    const names = (): string[] => parent.children.map((child) => child.name);

    c?.setSiblingIndex(0);
    expect(names()).toEqual(["c", "a", "b"]);
    c?.setSiblingIndex(1.7);
    expect(names()).toEqual(["a", "c", "b"]);
    a?.setSiblingIndex(99);
    expect(names()).toEqual(["c", "b", "a"]);
    b?.setSiblingIndex(-3);
    expect(names()).toEqual(["b", "c", "a"]);
    harness.dispose();
  });

  it("orders the scene's roots with setSiblingIndex on a root", () => {
    const harness = createTestWorld();
    const [a, b, c] = ["a", "b", "c"].map((name) => harness.world.createEntity(name));

    c?.setSiblingIndex(0);
    expect(harness.world.activeScene.roots).toEqual([c, a, b]);
    a?.destroyImmediate();
    expect(() => a?.setSiblingIndex(0)).toThrow(/IGX-0101/u);
    harness.dispose();
  });

  it("finds a descendant by predicate, deep or shallow", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b", { parent: a });
    const c = harness.world.createEntity("c", { parent: b });
    expect(a.findChild((entity) => entity.name === "c")).toBe(c);
    expect(a.findChild((entity) => entity.name === "c", false)).toBeNull();
    expect(a.findChild(() => false)).toBeNull();
    harness.dispose();
  });
});

describe("find(path)", () => {
  it("walks named children", () => {
    const harness = createTestWorld();
    const body = harness.world.createEntity("Body");
    const arm = harness.world.createEntity("Arm.L", { parent: body });
    expect(body.find("Arm.L")).toBe(arm);
    harness.dispose();
  });

  it("walks up with .. and stays put with .", () => {
    const harness = createTestWorld();
    const root = harness.world.createEntity("Root");
    const first = harness.world.createEntity("First", { parent: root });
    const second = harness.world.createEntity("Second", { parent: root });
    expect(first.find("../Second")).toBe(second);
    expect(first.find(".")).toBe(first);
    expect(first.find("./../Second")).toBe(second);
    harness.dispose();
  });

  it("resolves a leading slash from the roots of the entity's own scene", () => {
    const harness = createTestWorld();
    const root = harness.world.createEntity("Root");
    const child = harness.world.createEntity("Child", { parent: root });
    const deep = harness.world.createEntity("Deep", { parent: child });
    expect(deep.find("/Root/Child")).toBe(child);
    expect(deep.find("/Missing")).toBeNull();
    harness.dispose();
  });

  it("treats empty segments as no-ops and returns null for nothing", () => {
    const harness = createTestWorld();
    const root = harness.world.createEntity("Root");
    const child = harness.world.createEntity("Child", { parent: root });
    expect(root.find("Child//")).toBe(child);
    expect(root.find("")).toBeNull();
    expect(root.find("/")).toBeNull();
    expect(root.find("Nope/Deeper")).toBeNull();
    expect(root.find("../..")).toBeNull();
    harness.dispose();
  });
});

describe("components", () => {
  it("always carries exactly one transform, first in attach order", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.components[0]).toBe(entity.transform);
    expect(entity.getComponent(Transform)).toBe(entity.transform);
    harness.dispose();
  });

  it("applies schema defaults and then init", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const plain = entity.addComponent(Health);
    expect(plain.maximum).toBe(100);
    expect(plain.armor).toBe(2);
    const custom = entity.addComponent(Health, { maximum: 250 });
    expect(custom.maximum).toBe(250);
    expect(custom.armor).toBe(2);
    harness.dispose();
  });

  it("merges a partial record init over the schema defaults, at any depth", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const lamp = entity.addComponent(Lamp, { glow: { enabled: true, flicker: { rate: 5 } } });
    expect(lamp.glow.enabled).toBe(true);
    expect(lamp.glow.strength).toBe(0.5);
    expect(lamp.glow.tint).toEqual({ r: 1, g: 128 / 255, b: 0, a: 1 });
    expect(lamp.glow.flicker).toEqual({ rate: 5, depth: 0.1 });
    expect(lamp.backup).toBeNull();

    const withBackup = harness.world.createEntity("other").addComponent(Lamp, { backup: { strength: 1 } });
    expect(withBackup.backup).toEqual({ enabled: true, strength: 1 });
    harness.dispose();
  });

  it("keeps PostProcessStack's own bloom defaults when only enabled is given", () => {
    const harness = createTestWorld();
    const stack = harness.world.createEntity("camera").addComponent(PostProcessStack, { bloom: { enabled: true } });
    expect(stack.bloom).toEqual({ ...new PostProcessStack().bloom, enabled: true });
    expect(stack.bloom.threshold).toBe(0.9);
    harness.dispose();
  });

  it("rejects an init value the schema does not accept", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(() => entity.addComponent(Health, { armor: 1.5 })).toThrow(/IGX-0606/u);
    harness.dispose();
  });

  it("auto-adds and then finds the components a class requires", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const needy = entity.addComponent(NeedsHealth);
    expect(entity.getComponent(Health)).not.toBeNull();
    expect(needy.requireComponent(Health).maximum).toBe(100);
    harness.dispose();
  });

  it("throws IGX-0202 for a second instance of a single-instance class", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(Solo);
    expect(() => entity.addComponent(Solo)).toThrow(/IGX-0202/u);
    harness.dispose();
  });

  it("throws IGX-0201 from requireComponent when nothing matches", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(() => entity.requireComponent(Health)).toThrow(/IGX-0201/u);
    expect(entity.getComponent(Health)).toBeNull();
    expect(entity.hasComponent(Health)).toBe(false);
    harness.dispose();
  });

  it("matches by inheritance as well as identity", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    expect(entity.getComponent(Script)).toBe(script);
    expect(entity.getComponent(Component)).toBe(entity.transform);
    expect(entity.getComponents(Component)).toHaveLength(2);
    harness.dispose();
  });

  it("searches children and parents", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    const health = child.addComponent(Health);
    expect(parent.getComponentInChildren(Health)).toBe(health);
    expect(parent.getComponentsInChildren(Health)).toEqual([health]);
    expect(child.getComponentInParent(Health)).toBe(health);
    expect(parent.getComponentInParent(Health)).toBeNull();
    harness.dispose();
  });

  it("skips inactive entities in child searches unless asked not to", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    const health = child.addComponent(Health);
    child.active = false;
    expect(parent.getComponentInChildren(Health)).toBeNull();
    expect(parent.getComponentInChildren(Health, true)).toBe(health);
    expect(parent.getComponentsInChildren(Health, true)).toEqual([health]);
    harness.dispose();
  });

  it("ignores a removeComponent for a component of another entity", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("a");
    const b = harness.world.createEntity("b");
    const health = a.addComponent(Health);
    b.removeComponent(health);
    harness.flushDestroy();
    expect(health.isDestroyed).toBe(false);
    harness.dispose();
  });

  it("removes a component through the destroy flush", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    script.destroy();
    expect(script.isDestroyed).toBe(true);
    expect(entity.components).toContain(script);
    harness.flushDestroy();
    expect(entity.components).not.toContain(script);
    expect(entity.isDestroyed).toBe(false);
    harness.dispose();
  });

  it("throws IGX-0206 when a component's identity is read before the engine assigns it", () => {
    const detached = new Health();
    expect(() => detached.entity).toThrow(/IGX-0206/u);
    expect(() => detached.uid).toThrow(/IGX-0206/u);
    expect(() => detached.handle).toThrow(/IGX-0206/u);
    expect(() => detached.world).toThrow(/IGX-0206/u);
    expect(() => detached.app).toThrow(/IGX-0206/u);
    expect(() => detached.transform).toThrow(/IGX-0206/u);
    expect(detached.isDestroyed).toBe(false);
    expect(detached.enabled).toBe(true);
  });

  it("makes destroy a no-op on a component the engine never attached", () => {
    const detached = new Health();
    detached.destroy();
    expect(detached.isDestroyed).toBe(true);
  });
});

describe("layers and tags", () => {
  it("starts on layer zero and accepts slots 0 to 31", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.layer).toBe(0);
    entity.layer = 31;
    expect(entity.layer).toBe(31);
    harness.dispose();
  });

  it("rejects a layer outside 0 to 31 with IGX-0303", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(() => {
      entity.layer = 32;
    }).toThrow(/IGX-0303/u);
    expect(() => {
      entity.layer = -1;
    }).toThrow(/IGX-0303/u);
    expect(() => {
      entity.layer = 1.5;
    }).toThrow(/IGX-0303/u);
    harness.dispose();
  });

  it("adds, tests, iterates and deletes tags", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.tags.add("player").add("hero");
    expect(entity.tags.has("player")).toBe(true);
    expect(entity.tags.size).toBe(2);
    expect([...entity.tags]).toEqual(["player", "hero"]);
    expect([...entity.tags.values()]).toEqual(["player", "hero"]);
    expect(entity.tags.delete("player")).toBe(true);
    expect(entity.tags.delete("player")).toBe(false);
    expect(entity.tags.size).toBe(1);
    harness.dispose();
  });

  it("ignores a duplicate tag", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.tags.add("player");
    entity.tags.add("player");
    expect(harness.world.findByTag("player")).toEqual([entity]);
    harness.dispose();
  });
});

describe("isStatic", () => {
  it("defaults to false and can be set before awake", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.isStatic).toBe(false);
    entity.isStatic = true;
    expect(entity.isStatic).toBe(true);
    harness.dispose();
  });
});

describe("redundant writes", () => {
  it("ignores an active write that changes nothing", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.log.length = 0;
    entity.active = true;
    expect(harness.log).toEqual([]);
    entity.active = false;
    expect(harness.log).toEqual(["onDisable:a"]);
    entity.active = false;
    expect(harness.log).toEqual(["onDisable:a"]);
    harness.dispose();
  });

  it("cancels a queued enable when the component is disabled again before the flush", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    script.enabled = false;
    script.enabled = true;
    script.enabled = false;
    harness.flushA();
    expect(harness.log).toEqual([]);
    harness.dispose();
  });
});
