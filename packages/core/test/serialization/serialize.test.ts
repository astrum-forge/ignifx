import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { SCENE_FILE_FORMAT, SCENE_FORMAT_VERSION, stringifySceneFile } from "../../src/serialization/scene-file.js";
import { serializeComponent, serializeEntity, serializeScene } from "../../src/serialization/serialize.js";
import {
  Anonymous,
  Everything,
  Tagger,
  Versioned,
  buildFile,
  createSerializationWorld,
  entityRecord,
} from "./fixtures.js";
import type { SerializeIssue } from "../../src/serialization/serialize.js";
import type { TestWorld } from "../support/create-test-world.js";

/** What the writer puts in a file, and what it leaves out (`06` §1, §2, §5). */

let worlds: TestWorld[] = [];

function world(): TestWorld {
  const harness = createSerializationWorld();
  worlds.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

describe("serializeScene", () => {
  it("writes the header, the name, and the entities in tree order", () => {
    const harness = world();
    const a = harness.world.createEntity("A");
    const b = harness.world.createEntity("B", { parent: a });
    harness.world.createEntity("C", { parent: b });
    harness.world.createEntity("D", { parent: a });
    const file = serializeScene(harness.world.activeScene, { name: "Level" });
    expect(file.format).toBe(SCENE_FILE_FORMAT);
    expect(file.formatVersion).toBe(SCENE_FORMAT_VERSION);
    expect(file.engineVersion).toBe("0.0.0");
    expect(file.name).toBe("Level");
    expect(file.entities.map((entity) => entity.name)).toEqual(["A", "B", "C", "D"]);
    expect(file.entities[1]?.parent).toBe(a.uid);
    expect(file.entities[0]?.parent).toBeNull();
  });

  it("omits properties that are at their default", () => {
    const harness = world();
    harness.world.createEntity("Plain").addComponent(Tagger);
    const entity = serializeScene(harness.world.activeScene).entities[0];
    expect(entity).not.toHaveProperty("active");
    expect(entity).not.toHaveProperty("static");
    expect(entity).not.toHaveProperty("layer");
    expect(entity).not.toHaveProperty("tags");
    expect(entity?.components?.[0]).not.toHaveProperty("enabled");
    expect(entity?.components?.[0]).not.toHaveProperty("schemaVersion");
    expect(entity?.transform).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  });

  it("writes non-default flags", () => {
    const harness = world();
    const entity = harness.world.createEntity("Odd");
    entity.active = false;
    entity.isStatic = true;
    entity.layer = harness.world.layers.indexOf("Enemy");
    entity.tags.add("b");
    entity.tags.add("a");
    const component = entity.addComponent(Tagger);
    component.enabled = false;
    const written = serializeScene(harness.world.activeScene).entities[0];
    expect(written?.active).toBe(false);
    expect(written?.static).toBe(true);
    expect(written?.layer).toBe("Enemy");
    expect(written?.tags).toEqual(["a", "b"]);
    expect(written?.components?.[0]?.enabled).toBe(false);
  });

  it("writes schemaVersion only when the class declares something other than 1", () => {
    const harness = world();
    harness.world.registry.register(Versioned);
    harness.world.createEntity("V").addComponent(Versioned);
    const written = serializeScene(harness.world.activeScene).entities[0]?.components?.[0];
    expect(written?.schemaVersion).toBe(3);
  });

  it("writes props in schema declaration order and skips the transform component", () => {
    const harness = world();
    harness.world.createEntity("E").addComponent(Everything);
    const written = serializeScene(harness.world.activeScene).entities[0];
    expect(written?.components).toHaveLength(1);
    expect(Object.keys(written?.components?.[0]?.props ?? {})[0]).toBe("speed");
    expect(Object.keys(written?.components?.[0]?.props ?? {})).not.toContain("scratch");
  });

  it("reports a component without a typeId and leaves it out", () => {
    const harness = world();
    harness.world.createEntity("E").addComponent(Anonymous);
    const issues: SerializeIssue[] = [];
    const file = serializeScene(harness.world.activeScene, {
      onIssue: (issue) => {
        issues.push(issue);
      },
    });
    expect(file.entities[0]?.components).toBeUndefined();
    expect(issues[0]?.code).toBe(CoreErrorCode.componentTypeIdMissing);
  });

  it("writes a reference to an entity outside the file as null, with a diagnostic", () => {
    const harness = world();
    const inside = harness.world.createEntity("Inside");
    const outside = harness.world.createEntity("Outside");
    const mover = inside.addComponent(Everything);
    mover.target = outside;
    const issues: SerializeIssue[] = [];
    const file = serializeScene([inside], {
      onIssue: (issue) => {
        issues.push(issue);
      },
    });
    expect(file.entities).toHaveLength(1);
    expect(file.entities[0]?.components?.[0]?.props?.["target"]).toBeNull();
    expect(issues.some((issue) => issue.code === CoreErrorCode.unresolvedReference)).toBe(true);
  });

  it("accepts an explicit entity list and carries the instance's settings", () => {
    const harness = world();
    const kept = harness.world.createEntity("Kept");
    harness.world.createEntity("Dropped");
    expect(serializeScene([kept]).entities.map((entity) => entity.name)).toEqual(["Kept"]);
    harness.world.activeScene.setSettings({ clearColor: [0, 0, 0, 1] });
    expect(serializeScene(harness.world.activeScene).settings).toEqual({ clearColor: [0, 0, 0, 1] });
    expect(serializeScene(harness.world.activeScene, { settings: null }).settings).toBeUndefined();
  });

  it("skips destroyed entities and components", () => {
    const harness = world();
    const alive = harness.world.createEntity("Alive");
    const doomed = harness.world.createEntity("Doomed");
    doomed.destroy();
    const component = alive.addComponent(Tagger);
    alive.removeComponent(component);
    const file = serializeScene(harness.world.activeScene);
    expect(file.entities.map((entity) => entity.name)).toEqual(["Alive"]);
    expect(file.entities[0]?.components).toBeUndefined();
  });

  it("produces the same text twice", () => {
    const harness = world();
    const entity = harness.world.createEntity("E");
    entity.addComponent(Everything, { speed: 1 / 3 });
    const first = stringifySceneFile(serializeScene(harness.world.activeScene));
    const second = stringifySceneFile(serializeScene(harness.world.activeScene));
    expect(first).toBe(second);
    expect(first).toContain('"speed": 0.333333');
  });

  it("writes an entity added under an instance at run time as a plain entity", async () => {
    const prefab = await createSceneAsset(
      "p.prefab.json",
      buildFile({ entities: [entityRecord({ uid: "P", name: "P" })] }),
    );
    const harness = world();
    const built = instantiateScene(harness.world, prefab, { asInstance: true });
    const root = built.roots[0];
    if (root !== undefined) {
      harness.world.createEntity("Runtime", { parent: root });
    }
    const issues: SerializeIssue[] = [];
    const file = serializeScene(harness.world.activeScene, {
      onIssue: (issue) => {
        issues.push(issue);
      },
    });
    expect(file.entities.map((entity) => entity.name)).toEqual(["P", "Runtime"]);
    expect(file.entities[0]?.instance?.scene).toEqual({ $asset: "p.prefab.json" });
    expect(issues.some((issue) => issue.message.includes("added under the instance"))).toBe(true);
  });
});

describe("serializeEntity and serializeComponent", () => {
  it("write one object on its own", () => {
    const harness = world();
    const parent = harness.world.createEntity("Parent");
    const child = harness.world.createEntity("Child", { parent });
    child.transform.localPosition.set(1, 2, 3);
    const mover = child.addComponent(Everything, { speed: 2 });
    mover.target = parent;
    const written = serializeEntity(child);
    expect(written.parent).toBe(parent.uid);
    expect(written.transform.position).toEqual([1, 2, 3]);
    expect(written.components?.[0]?.props?.["target"]).toEqual({ $entity: parent.uid });
    expect(serializeComponent(mover).type).toBe("test/Everything");
    expect(serializeComponent(mover).uid).toBe(mover.uid);
  });

  it("refuses a component whose class declares no typeId", () => {
    const harness = world();
    const component = harness.world.createEntity("E").addComponent(Anonymous);
    expect(() => serializeComponent(component)).toThrow(/typeId/u);
  });
});
