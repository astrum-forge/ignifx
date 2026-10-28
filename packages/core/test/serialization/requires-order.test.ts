import { afterEach, describe, expect, it } from "vitest";
import { Component } from "../../src/component/component.js";
import { f32 } from "../../src/schema/field-kinds.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { buildFile, createSerializationWorld, entityRecord } from "./fixtures.js";
import type { SceneFileComponent } from "../../src/serialization/scene-file.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * Audit defect B2 (engine ask E33): a file may list a component before the component its class
 * `requires`. Loading it must attach the file's own record, not a second, auto-added instance.
 */

/** A single-instance component other classes require, with a prop the file sets. */
class Body extends Component.define({ mass: f32(1) }) {
  static typeId = "test/Body";
  static allowMultiple = false;
}

/** A subclass that satisfies `requires: [Body]`. */
class HeavyBody extends Body {
  static override typeId = "test/HeavyBody";
}

/** A multi-instance component, which an auto-add would duplicate rather than refuse. */
class Sensor extends Component.define({ range: f32(1) }) {
  static typeId = "test/Sensor";
}

/** Requires both, and records what `onAttach` found. */
class Controller extends Component {
  static typeId = "test/Controller";
  static requires = [Body, Sensor];
  sawBody = false;

  onAttach(): void {
    this.sawBody = this.entity.getComponent(Body) !== null;
  }
}

/** Requires the controller, so the file below needs a chain of reorders. */
class Driver extends Component {
  static typeId = "test/Driver";
  static requires = [Controller];
}

let worlds: TestWorld[] = [];

function world(): TestWorld {
  const harness = createSerializationWorld();
  harness.world.registry.registerAll([Body, HeavyBody, Sensor, Controller, Driver]);
  worlds.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

async function load(harness: TestWorld, components: SceneFileComponent[]): Promise<void> {
  const asset = await createSceneAsset(
    "a.scene.json",
    buildFile({ entities: [entityRecord({ uid: "E", components })] }),
  );
  instantiateScene(harness.world, asset);
}

/** The file-visible components of `E`, as type id and uid, in entity order. */
function listed(harness: TestWorld): string[] {
  const entity = harness.world.getEntity("E");
  return (entity?.components ?? []).filter((c) => c !== entity?.transform).map((c) => `${c.uid}:${typeIdOf(c)}`);
}

function typeIdOf(component: Component): string {
  return (component.constructor as { readonly typeId?: string }).typeId ?? "?";
}

describe("loading components listed before what they require", () => {
  it("attaches each record once, keeps file order and uids, and decodes the later records' props", async () => {
    const harness = world();
    await load(harness, [
      { uid: "D", type: "test/Driver" },
      { uid: "C", type: "test/Controller" },
      { uid: "S", type: "test/Sensor", props: { range: 7 } },
      { uid: "B", type: "test/Body", props: { mass: 3 } },
    ]);
    expect(listed(harness)).toEqual(["D:test/Driver", "C:test/Controller", "S:test/Sensor", "B:test/Body"]);
    const entity = harness.world.getEntity("E");
    expect(entity?.getComponent(Body)?.mass).toBe(3);
    expect(entity?.getComponent(Sensor)?.range).toBe(7);
    // The required records attach first, as `addComponent` promises.
    expect(entity?.getComponent(Controller)?.sawBody).toBe(true);
  });

  it("accepts a later subclass record as the required type", async () => {
    const harness = world();
    await load(harness, [
      { uid: "C", type: "test/Controller" },
      { uid: "H", type: "test/HeavyBody", props: { mass: 9 } },
      { uid: "S", type: "test/Sensor" },
    ]);
    expect(listed(harness)).toEqual(["C:test/Controller", "H:test/HeavyBody", "S:test/Sensor"]);
  });

  it("still auto-adds a required type no record supplies", async () => {
    const harness = world();
    await load(harness, [
      { uid: "C", type: "test/Controller" },
      { uid: "B", type: "test/Body" },
    ]);
    const types = listed(harness).map((entry) => entry.slice(entry.indexOf(":") + 1));
    expect(types.toSorted()).toEqual(["test/Body", "test/Controller", "test/Sensor"]);
  });

  it("round-trips the reordered file unchanged", async () => {
    const harness = world();
    const components: SceneFileComponent[] = [
      { uid: "C", type: "test/Controller" },
      { uid: "S", type: "test/Sensor" },
      { uid: "B", type: "test/Body" },
    ];
    await load(harness, components);
    const entity = harness.world.getEntity("E");
    const saved = serializeScene(entity === null ? [] : [entity], { engineVersion: null });
    expect(saved.entities[0]?.components?.map((c) => c.uid)).toEqual(["C", "S", "B"]);
  });
});
