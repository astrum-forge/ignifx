import { describe, expect, it } from "vitest";
import { Component } from "../../src/component/component.js";
import { Script } from "../../src/script/script.js";
import { createTestWorld } from "../support/create-test-world.js";
import { RecordingScript } from "../support/recording-script.js";

/** `docs/architecture/02-scene-graph.md` §2, §3, §9, §10. */

/** A plain component used to exercise the per-type registry. */
class Marker extends Component {
  static typeId = "test/Marker";
}

describe("scenes", () => {
  it("starts with one implicit, persistent, loaded scene named default", () => {
    const harness = createTestWorld();
    expect(harness.world.scenes).toHaveLength(1);
    const scene = harness.world.activeScene;
    expect(scene.name).toBe("default");
    expect(scene.persistent).toBe(true);
    expect(scene.isLoaded).toBe(true);
    expect(scene.asset).toBeNull();
    expect(scene.roots).toEqual([]);
    harness.dispose();
  });

  it("owns entities created in code through the active scene", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.scene).toBe(harness.world.activeScene);
    expect(harness.world.activeScene.roots).toEqual([entity]);
    harness.dispose();
  });

  it("gives a child the parent's scene", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    expect(child.scene).toBe(parent.scene);
    expect(harness.world.activeScene.roots).toEqual([parent]);
    harness.dispose();
  });

  it("exposes an onUnloading signal that Phase 1 never fires", () => {
    const harness = createTestWorld();
    let fired = false;
    harness.world.activeScene.onUnloading.connect(() => {
      fired = true;
    });
    harness.world.dispose();
    expect(fired).toBe(false);
    harness.dispose();
  });
});

describe("creation options", () => {
  it("places an entity at a world position and rotation", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity", {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    });
    expect(entity.transform.localPosition.x).toBeCloseTo(1, 5);
    expect(entity.transform.localRotation.y).toBeCloseTo(Math.SQRT1_2, 5);
    harness.dispose();
  });

  it("applies a position after parenting, so it is a world position", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localPosition.set(10, 0, 0);
    const child = harness.world.createEntity("child", { parent, position: { x: 12, y: 0, z: 0 } });
    expect(child.transform.localPosition.x).toBeCloseTo(2, 5);
    expect(child.transform.position.x).toBeCloseTo(12, 5);
    harness.dispose();
  });

  it("emits onEntityCreated for every entity", () => {
    const harness = createTestWorld();
    const seen: string[] = [];
    harness.world.onEntityCreated.connect((entity) => seen.push(entity.name));
    harness.world.createEntity("a");
    harness.world.createEntity("b");
    expect(seen).toEqual(["a", "b"]);
    harness.dispose();
  });
});

describe("lookups", () => {
  it("finds the first entity by name, depth-first", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("shared");
    harness.world.createEntity("shared", { parent: a });
    harness.world.createEntity("shared");
    expect(harness.world.findByName("shared")).toBe(a);
    expect(harness.world.findByName("missing")).toBeNull();
    expect(harness.world.findAllByName("shared")).toHaveLength(3);
    expect(harness.world.findAllByName("missing")).toEqual([]);
    harness.dispose();
  });

  it("returns a stable, live, allocation-free view from findByTag", () => {
    const harness = createTestWorld();
    const empty = harness.world.findByTag("enemy");
    expect(empty).toEqual([]);
    expect(harness.world.findByTag("enemy")).toBe(empty);
    const a = harness.world.createEntity("a");
    a.tags.add("enemy");
    const view = harness.world.findByTag("enemy");
    expect(view).toEqual([a]);
    const b = harness.world.createEntity("b");
    b.tags.add("enemy");
    expect(harness.world.findByTag("enemy")).toBe(view);
    expect(view).toHaveLength(2);
    a.tags.delete("enemy");
    expect(view).toEqual([b]);
    harness.dispose();
  });

  it("drops a destroyed entity out of the tag index", () => {
    const harness = createTestWorld();
    const a = harness.world.createEntity("a");
    a.tags.add("enemy");
    a.destroy();
    harness.flushDestroy();
    expect(harness.world.findByTag("enemy")).toEqual([]);
    harness.dispose();
  });

  it("stops resolving an entity uid and handle after the destroy flush", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const uid = entity.uid;
    const handle = entity.handle;
    entity.destroy();
    harness.flushDestroy();
    expect(harness.world.getEntity(uid)).toBeNull();
    expect(harness.world.getEntityByHandle(handle)).toBeNull();
    harness.dispose();
  });

  it("never resolves a stale handle to the entity that recycled its slot", () => {
    const harness = createTestWorld();
    const first = harness.world.createEntity("first");
    const stale = first.handle;
    first.destroy();
    harness.flushDestroy();
    const second = harness.world.createEntity("second");
    expect(second.handle).not.toBe(stale);
    expect(harness.world.getEntityByHandle(stale)).toBeNull();
    expect(harness.world.getEntityByHandle(second.handle)).toBe(second);
    harness.dispose();
  });
});

describe("the per-type component registry", () => {
  it("is live, O(1) to obtain, and stable in identity", () => {
    const harness = createTestWorld();
    const view = harness.world.components(Marker);
    expect(view).toEqual([]);
    const entity = harness.world.createEntity("entity");
    const marker = entity.addComponent(Marker);
    expect(harness.world.components(Marker)).toEqual([marker]);
    expect(harness.world.components(Marker)).toBe(harness.world.components(Marker));
    harness.dispose();
  });

  it("matches by inheritance, so a query for Script returns every script", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    entity.addComponent(Marker);
    expect(harness.world.components(Script)).toEqual([script]);
    expect(harness.world.components(Component)).toHaveLength(3);
    harness.dispose();
  });

  it("removes a component in the destroy flush, not before", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const marker = entity.addComponent(Marker);
    marker.destroy();
    expect(harness.world.components(Marker)).toEqual([marker]);
    harness.flushDestroy();
    expect(harness.world.components(Marker)).toEqual([]);
    harness.dispose();
  });

  it("keeps every other component reachable after a swap-remove", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const first = entity.addComponent(Marker);
    const second = entity.addComponent(Marker);
    const third = entity.addComponent(Marker);
    first.destroy();
    harness.flushDestroy();
    expect([...harness.world.components(Marker)].toSorted((a, b) => a.uid.localeCompare(b.uid))).toEqual(
      [second, third].toSorted((a, b) => a.uid.localeCompare(b.uid)),
    );
    second.destroy();
    harness.flushDestroy();
    expect(harness.world.components(Marker)).toEqual([third]);
    harness.dispose();
  });
});

describe("escape hatches and isolation", () => {
  it("exposes the Lite render scene and no simulation scene yet", () => {
    const harness = createTestWorld();
    expect(harness.world.lite.scene).toBe(harness.app.lite.scene);
    expect(harness.world.lite.simulationScene).toBeNull();
    harness.dispose();
  });

  it("runs two independent worlds in one process", () => {
    const first = createTestWorld();
    const second = createTestWorld();
    first.world.createEntity("only-in-first").addComponent(RecordingScript, { label: "a" });
    first.frame();
    expect(first.log).toEqual(["awake:a", "onEnable:a", "start:a"]);
    expect(second.log).toEqual([]);
    expect(second.world.findByName("only-in-first")).toBeNull();
    expect(second.world.components(Component)).toHaveLength(0);
    first.dispose();
    second.dispose();
  });

  it("keeps activeScene settable", () => {
    const harness = createTestWorld();
    const scene = harness.world.activeScene;
    harness.world.activeScene = scene;
    expect(harness.world.activeScene).toBe(scene);
    harness.dispose();
  });
});
