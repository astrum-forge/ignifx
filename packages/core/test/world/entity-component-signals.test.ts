import { afterEach, describe, expect, it } from "vitest";
import { createTestWorld } from "../support/create-test-world.js";
import { RecordingScript } from "../support/recording-script.js";
import type { Component } from "../../src/index.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * `Entity.onComponentAdded` and `Entity.onComponentRemoved`
 * (`docs/architecture/02-scene-graph.md` §8): how an extension learns that an entity's component
 * set changed, which is what `Rigidbody.collisionEvents` auto-detection needs
 * (`09-physics.md` §2.1).
 */

let harness: TestWorld | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a world.
 *
 * @returns The harness.
 */
function build(): TestWorld {
  const created = createTestWorld();
  harness = created;
  return created;
}

describe("Entity.onComponentAdded", () => {
  it("emits synchronously with the component already in the entity's list", () => {
    const world = build().world;
    const entity = world.createEntity("A");
    const seen: Component[] = [];
    let present = false;
    entity.onComponentAdded.connect((component: Component): void => {
      seen.push(component);
      present = entity.components.includes(component);
    });

    const script = entity.addComponent(RecordingScript, { label: "a" });

    expect(seen).toEqual([script]);
    expect(present).toBe(true);
  });

  it("is the same signal on every read", () => {
    const world = build().world;
    const entity = world.createEntity("A");

    expect(entity.onComponentAdded).toBe(entity.onComponentAdded);
    expect(entity.onComponentRemoved).toBe(entity.onComponentRemoved);
    expect(entity.onComponentAdded).not.toBe(entity.onComponentRemoved);
  });

  it("does not fire for components added to another entity", () => {
    const world = build().world;
    const entity = world.createEntity("A");
    const other = world.createEntity("B");
    const seen: Component[] = [];
    entity.onComponentAdded.connect((component: Component): void => {
      seen.push(component);
    });

    other.addComponent(RecordingScript, { label: "b" });

    expect(seen).toEqual([]);
  });

  it("disconnects a handler when its owner is destroyed", () => {
    const test = build();
    const entity = test.world.createEntity("A");
    const owner = test.world.createEntity("Owner");
    const seen: Component[] = [];
    entity.onComponentAdded.connect(
      (component: Component): void => {
        seen.push(component);
      },
      { owner },
    );

    owner.destroy();
    test.flushDestroy();
    entity.addComponent(RecordingScript, { label: "a" });

    expect(seen).toEqual([]);
  });
});

describe("Entity.onComponentRemoved", () => {
  it("waits for the destroy flush and reports the component as already detached", () => {
    const test = build();
    const entity = test.world.createEntity("A");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    const seen: Component[] = [];
    let stillListed = true;
    entity.onComponentRemoved.connect((component: Component): void => {
      seen.push(component);
      stillListed = entity.components.includes(component);
    });

    entity.removeComponent(script);
    expect(seen).toEqual([]);

    test.flushDestroy();
    expect(seen).toEqual([script]);
    expect(stillListed).toBe(false);
  });

  it("fires for every component when the entity itself is destroyed", () => {
    const test = build();
    const entity = test.world.createEntity("A");
    const first = entity.addComponent(RecordingScript, { label: "a" });
    const second = entity.addComponent(RecordingScript, { label: "b" });
    const seen: Component[] = [];
    entity.onComponentRemoved.connect((component: Component): void => {
      seen.push(component);
    });

    entity.destroy();
    test.flushDestroy();

    expect(seen).toContain(first);
    expect(seen).toContain(second);
    expect(seen).toContain(entity.transform);
  });
});
