import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { addComponentFromRecord } from "../../src/serialization/load.js";
import { serializeEntity } from "../../src/serialization/serialize.js";
import { Tagger, createSerializationWorld } from "./fixtures.js";
import type { Everything } from "./fixtures.js";
import type { TestWorld } from "../support/create-test-world.js";

/** `addComponentFromRecord`: one component built from its scene file record on a live entity. */

let worlds: TestWorld[] = [];

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

/**
 * A world with the serialization test components registered.
 *
 * @returns The harness.
 */
function world(): TestWorld {
  const harness = createSerializationWorld();
  worlds.push(harness);
  return harness;
}

describe("addComponentFromRecord", () => {
  it("adopts the record's uid, enabled flag and props", () => {
    const { world: live } = world();
    const entity = live.createEntity("Player");

    const { component, issues } = addComponentFromRecord(entity, {
      uid: "C-1",
      type: "test/Tagger",
      enabled: false,
      props: { note: "hello" },
    });

    expect(issues).toEqual([]);
    expect(component).toBeInstanceOf(Tagger);
    expect(component.uid).toBe("C-1");
    expect(component.enabled).toBe(false);
    expect(serializeEntity(entity).components).toEqual([
      { uid: "C-1", type: "test/Tagger", enabled: false, props: { note: "hello" } },
    ]);
  });

  it("resolves references through the decoder it is given, and reports what it cannot read", () => {
    const { world: live } = world();
    const entity = live.createEntity("Player");
    const target = live.createEntity("Target");

    const { component, issues } = addComponentFromRecord(
      entity,
      { uid: "C-1", type: "test/Everything", props: { target: { $entity: target.uid }, speed: "fast" } },
      { references: { entity: (uid) => live.getEntity(uid), component: () => null, asset: () => null } },
    );

    expect((component as Everything).target).toBe(target);
    expect((component as Everything).speed).toBe(5);
    expect(issues.map((issue) => issue.code)).toEqual([CoreErrorCode.schemaTypeMismatch]);
    expect(issues[0]?.message).toContain("C-1.speed");
  });

  it("places the component at an index of the file's component list", () => {
    const { world: live } = world();
    const entity = live.createEntity("Player");
    addComponentFromRecord(entity, { uid: "A", type: "test/Tagger" });
    addComponentFromRecord(entity, { uid: "B", type: "test/Tagger" });

    addComponentFromRecord(entity, { uid: "C", type: "test/Tagger" }, { index: 1 });
    addComponentFromRecord(entity, { uid: "D", type: "test/Tagger" }, { index: 0 });
    addComponentFromRecord(entity, { uid: "E", type: "test/Tagger" }, { index: 99 });

    expect(entity.components[0]).toBe(entity.transform);
    expect(serializeEntity(entity).components?.map((record) => record.uid)).toEqual(["D", "A", "C", "B", "E"]);
  });

  it("refuses a type that is not registered with IGX-0307", () => {
    const { world: live } = world();
    const entity = live.createEntity("Player");

    let error: unknown = null;
    try {
      addComponentFromRecord(entity, { uid: "C", type: "game/Inventory" });
    } catch (thrown) {
      error = thrown;
    }

    expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.unknownComponentTypeId);
    expect(error instanceof Error && error.message).toContain(
      'The component type "game/Inventory" is not registered; register it with app.registerComponents or check its typeId.',
    );
    expect(entity.components).toHaveLength(1);
  });
});
