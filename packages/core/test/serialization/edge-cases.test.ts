import { afterEach, describe, expect, it } from "vitest";
import { Component } from "../../src/component/component.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { applyOverrides } from "../../src/serialization/overrides.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { sceneFileJsonSchema } from "../../src/serialization/scene-file.js";
import { serializeComponent, serializeScene } from "../../src/serialization/serialize.js";
import { UidRemap, membershipEncoder } from "../../src/serialization/uid-remap.js";
import { validateSceneFile } from "../../src/serialization/validate.js";
import { Everything, Tagger, buildFile, createSerializationWorld, entityRecord, fakeHandle } from "./fixtures.js";
import type { JsonObject } from "../../src/schema/json.js";
import type { MutableSceneEntity, OverrideTarget } from "../../src/serialization/overrides.js";
import type { SceneAsset } from "../../src/serialization/scene-asset.js";
import type { TestWorld } from "../support/create-test-world.js";

/** The degraded paths: malformed files, missing targets, and the diff's less common branches. */

/** A component class with no schema at all. */
class Bare extends Component {
  static typeId = "test/Bare";
}

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

describe("loading a degraded file", () => {
  it("makes an entity whose parent is unknown a root, with a diagnostic", async () => {
    const asset = await createSceneAsset(
      "a.scene.json",
      buildFile({ entities: [entityRecord({ uid: "A", name: "A", parent: "GONE" })] }),
    );
    const harness = world();
    const built = instantiateScene(harness.world, asset);
    expect(built.issues[0]?.code).toBe(CoreErrorCode.unresolvedReference);
    expect(built.roots).toHaveLength(0);
    expect(harness.world.getEntity("A")?.parent).toBeNull();
  });

  it("honours a component that the file disables", async () => {
    const asset = await createSceneAsset(
      "a.scene.json",
      buildFile({
        entities: [entityRecord({ uid: "A", components: [{ uid: "C", type: "test/Tagger", enabled: false }] })],
      }),
    );
    const harness = world();
    instantiateScene(harness.world, asset);
    expect(harness.world.getEntity("A")?.getComponent(Tagger)?.enabled).toBe(false);
  });

  it("reports an unresolved reference and a mistyped prop, keeping the defaults", async () => {
    const asset = await createSceneAsset(
      "a.scene.json",
      buildFile({
        entities: [
          entityRecord({
            uid: "A",
            components: [{ uid: "C", type: "test/Everything", props: { target: { $entity: "GONE" }, speed: "fast" } }],
          }),
        ],
      }),
    );
    const harness = world();
    const built = instantiateScene(harness.world, asset);
    const codes = built.issues.map((issue) => issue.code);
    expect(codes).toContain(CoreErrorCode.unresolvedReference);
    expect(codes).toContain(CoreErrorCode.schemaTypeMismatch);
    const mover = harness.world.getEntity("A")?.getComponent(Everything);
    expect(mover?.target).toBeNull();
    expect(mover?.speed).toBe(5);
  });

  it("fills short transform arrays with the identity and skips empty tags", async () => {
    const asset = await createSceneAsset("a.scene.json", {
      ...buildFile({ entities: [] }),
      entities: [
        {
          uid: "A",
          name: "A",
          parent: null,
          tags: ["", "kept"],
          transform: { position: [], rotation: [], scale: [] } as never,
        },
      ],
    });
    const harness = world();
    instantiateScene(harness.world, asset);
    const entity = harness.world.getEntity("A");
    expect(entity?.transform.localPosition.x).toBe(0);
    expect(entity?.transform.localRotation.w).toBe(1);
    expect(entity?.transform.localScale.z).toBe(1);
    expect([...(entity?.tags.values() ?? [])]).toEqual(["kept"]);
  });

  it("takes the parent's scene when no owning instance is given", async () => {
    const harness = world();
    const other = harness.world.scenes[0];
    const parent = harness.world.createEntity("Parent");
    const asset = await createSceneAsset("a.scene.json", buildFile({ entities: [entityRecord({ uid: "A" })] }));
    const built = instantiateScene(harness.world, asset, { parent });
    expect(built.roots).toHaveLength(1);
    expect(harness.world.getEntity("A")?.scene).toBe(other);
  });
});

describe("references inside a prefab", () => {
  it("rewrites $entity and $component to this copy of the instance", async () => {
    const prefab = await createSceneAsset(
      "p.prefab.json",
      buildFile({
        entities: [
          entityRecord({
            uid: "P",
            name: "P",
            components: [
              {
                uid: "PC",
                type: "test/Everything",
                props: {
                  target: { $entity: "PK" },
                  follow: { $component: "PKC" },
                  waypoints: [{ nested: { $entity: "PK" } }],
                },
              },
            ],
          }),
          entityRecord({
            uid: "PK",
            name: "Kid",
            parent: "P",
            components: [{ uid: "PKC", type: "test/Tagger" }],
          }),
        ],
      }),
    );
    const level = await createSceneAsset(
      "l.scene.json",
      buildFile({
        entities: [
          entityRecord({ uid: "A", instance: { scene: { $asset: prefab.address } } }),
          entityRecord({ uid: "B", instance: { scene: { $asset: prefab.address } } }),
        ],
      }),
      [fakeHandle(prefab.address, prefab)],
    );
    const harness = world();
    const built = instantiateScene(harness.world, level);
    const first = built.roots[0]?.children[0];
    const second = built.roots[1]?.children[0];
    const firstMover = first?.getComponent(Everything);
    expect(firstMover?.target).toBe(first?.children[0]);
    expect(firstMover?.follow).toBe(first?.children[0]?.getComponent(Tagger));
    expect(second?.getComponent(Everything)?.target).toBe(second?.children[0]);
    expect(firstMover?.target).not.toBe(second?.getComponent(Everything)?.target);
  });
});

/** A prefab whose single entity differs from what the test then makes of it. */
function prefabFor(entity: Parameters<typeof entityRecord>[0]): Promise<SceneAsset> {
  return createSceneAsset("p.prefab.json", buildFile({ entities: [entityRecord(entity)] }));
}

/** Instances a prefab once into a level and builds the result into a world. */
async function instance(prefab: SceneAsset, harness: TestWorld): Promise<void> {
  const level = await createSceneAsset(
    "l.scene.json",
    buildFile({ entities: [entityRecord({ uid: "L", name: "L", instance: { scene: { $asset: prefab.address } } })] }),
    [fakeHandle(prefab.address, prefab)],
  );
  instantiateScene(harness.world, level);
}

/** A patch target whose component carries an array of objects. */
function arrayTarget(): Map<string, OverrideTarget> {
  const data: MutableSceneEntity = {
    uid: "R",
    name: "R",
    parent: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    components: [{ uid: "C", type: "test/Everything", props: { rows: [{ hp: 1 }] } }],
  };
  return new Map([["R", { data, components: new Map([["C", "C"]]) }]]);
}

describe("override diffing", () => {
  it("emits an override for every entity property that changed", async () => {
    const prefab = await prefabFor({ uid: "P", name: "P", tags: ["a"] });
    const harness = world();
    await instance(prefab, harness);
    const entity = harness.world.findByName("P");
    if (entity === null) {
      expect.unreachable();
      return;
    }
    entity.name = "Renamed";
    entity.active = false;
    entity.isStatic = true;
    entity.layer = harness.world.layers.indexOf("Enemy");
    entity.tags.delete("a");
    entity.tags.add("b");
    entity.transform.localPosition.set(1, 0, 0);
    entity.transform.localRotation.set(0, 1, 0, 0);
    entity.transform.localScale.set(2, 2, 2);
    const paths = (serializeScene(harness.world.activeScene).entities[0]?.instance?.overrides ?? []).map(
      (override) => override.path,
    );
    expect(paths).toEqual([
      "P/name",
      "P/active",
      "P/static",
      "P/layer",
      "P/tags",
      "P/transform/position",
      "P/transform/rotation",
      "P/transform/scale",
    ]);
  });

  it("emits an override when a transform array in the file is the wrong length", async () => {
    const prefab = await createSceneAsset("p.prefab.json", {
      ...buildFile({ entities: [] }),
      entities: [
        {
          uid: "P",
          name: "P",
          parent: null,
          transform: { position: [0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        },
      ],
    } as never);
    const harness = world();
    await instance(prefab, harness);
    const paths = (serializeScene(harness.world.activeScene).entities[0]?.instance?.overrides ?? []).map(
      (override) => override.path,
    );
    expect(paths).toEqual(["P/transform/position"]);
  });

  it("emits an override when a component's enabled flag changed", async () => {
    const prefab = await prefabFor({ uid: "P", name: "P", components: [{ uid: "PC", type: "test/Tagger" }] });
    const harness = world();
    await instance(prefab, harness);
    const component = harness.world.findByName("P")?.getComponent(Tagger);
    if (component !== null && component !== undefined) {
      component.enabled = false;
    }
    const overrides = serializeScene(harness.world.activeScene).entities[0]?.instance?.overrides ?? [];
    expect(overrides).toEqual([{ path: "P/components/PC/enabled", value: false }]);
  });

  it("ignores a run-time component whose class has no typeId", async () => {
    const prefab = await prefabFor({ uid: "P", name: "P" });
    const harness = world();
    await instance(prefab, harness);
    class Nameless extends Component.define({}) {}
    harness.world.findByName("P")?.addComponent(Nameless);
    expect(serializeScene(harness.world.activeScene).entities[0]?.instance?.overrides).toBeUndefined();
  });
});

describe("components without a schema", () => {
  it("write no props and contribute no JSON Schema branch", () => {
    const harness = world();
    harness.world.registry.register(Bare);
    const component = harness.world.createEntity("E").addComponent(Bare);
    expect(serializeComponent(component)).toEqual({ uid: component.uid, type: "test/Bare" });
    const defs = sceneFileJsonSchema(harness.world.registry)["$defs"] as JsonObject;
    const branches = (defs["component"] as JsonObject)["allOf"] as readonly JsonObject[];
    const ids = branches.map((branch) => ((branch["if"] as JsonObject)["properties"] as JsonObject)["type"]);
    expect(ids).not.toContainEqual({ const: "test/Bare" });
  });
});

describe("uid remap", () => {
  it("answers null for uids it does not hold and counts what it does", () => {
    const harness = world();
    const remap = new UidRemap();
    const entity = harness.world.createEntity("E");
    const component = entity.addComponent(Tagger);
    remap.addEntity("E", entity);
    remap.addComponent("C", component);
    expect(remap.size).toBe(1);
    expect(remap.entity("E")).toBe(entity);
    expect(remap.component("C")).toBe(component);
    expect(remap.entity("nope")).toBeNull();
    expect(remap.component("nope")).toBeNull();
    expect([...remap.entries()]).toEqual([["E", entity]]);
    remap.clear();
    expect(remap.size).toBe(0);
  });

  it("resolves a reference only when the target is in the file", () => {
    const harness = world();
    const inside = harness.world.createEntity("In");
    const outside = harness.world.createEntity("Out");
    const encoder = membershipEncoder(new Set([inside]), new Set());
    expect(encoder.entityUid(inside)).toBe(inside.uid);
    expect(encoder.entityUid(outside)).toBeNull();
    expect(encoder.entityUid(null)).toBeNull();
    expect(encoder.entityUid(7)).toBeNull();
    expect(encoder.componentUid({})).toBeNull();
  });
});

describe("override patcher edge cases", () => {
  it("descends from an array into an object", () => {
    const lookup = arrayTarget();
    applyOverrides([{ path: "R/components/C/props/rows/0/hp", value: 5 }], lookup, () => undefined);
    expect(lookup.get("R")?.data.components[0]?.props?.["rows"]).toEqual([{ hp: 5 }]);
  });

  it("adds a component with no optional fields and drops non-numbers from a transform patch", () => {
    const lookup = arrayTarget();
    applyOverrides(
      [
        { op: "add", path: "R/components", value: { uid: "N", type: "test/Tagger" } },
        { path: "R/transform/position", value: [1, "x", Number.NaN, 3] },
      ],
      lookup,
      () => undefined,
    );
    expect(lookup.get("R")?.data.components[1]).toEqual({ uid: "N", type: "test/Tagger" });
    expect(lookup.get("R")?.data.transform.position).toEqual([1, 3]);
  });
});

describe("validateSceneFile tags", () => {
  it("reports a non-string tag by index", () => {
    const issues = validateSceneFile(buildFile({ entities: [entityRecord({ uid: "A", tags: ["a", 2] as never })] }));
    expect(issues).toEqual([{ path: "entities/0/tags/1", message: "expected a string." }]);
  });
});

describe("more degraded shapes", () => {
  it("reports overrides that are not an array", () => {
    const issues = validateSceneFile(
      buildFile({
        entities: [entityRecord({ uid: "A", instance: { scene: { $asset: "p" }, overrides: 7 as never } })],
      }),
    );
    expect(issues).toEqual([{ path: "entities/0/instance/overrides", message: "expected an array." }]);
  });

  it("writes a reference to a value that is not an object as null", () => {
    const harness = world();
    const component = harness.world.createEntity("E").addComponent(Everything);
    // A plain field write of a non-entity is what a mistyped script does; the writer must not throw.
    Reflect.set(component, "target", 7);
    Reflect.set(component, "follow", "no");
    const written = serializeComponent(component);
    expect(written.props?.["target"]).toBeNull();
    expect(written.props?.["follow"]).toBeNull();
  });

  it("emits a tags override when the count differs", async () => {
    const prefab = await createSceneAsset(
      "p.prefab.json",
      buildFile({ entities: [entityRecord({ uid: "P", name: "P", tags: ["a", "b"] })] }),
    );
    const level = await createSceneAsset(
      "l.scene.json",
      buildFile({ entities: [entityRecord({ uid: "L", name: "L", instance: { scene: { $asset: prefab.address } } })] }),
      [fakeHandle(prefab.address, prefab)],
    );
    const harness = world();
    instantiateScene(harness.world, level);
    harness.world.findByName("P")?.tags.delete("b");
    const overrides = serializeScene(harness.world.activeScene).entities[0]?.instance?.overrides;
    expect(overrides).toEqual([{ path: "P/tags", value: ["a"] }]);
  });
});
