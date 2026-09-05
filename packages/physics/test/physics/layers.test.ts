import { describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { PhysicsErrorCode } from "../../src/errors.js";
import { createPhysicsApp } from "../support/harness.js";
import type { SettingsInput } from "@ignifx/core";

/**
 * Layers and the collision matrix (`docs/architecture/09-physics.md` §3): the membership bit is
 * `1 << entity.layer`, the collide mask comes from `physics.collisionMatrix`, and a runtime `layer`
 * change lands on the next fixed step.
 */

/** A project with three user layers and a matrix that isolates `Ghost` from `Ground`. */
const SETTINGS: SettingsInput = {
  layers: ["Default", "Ground", "Ghost"],
  physics: { collisionMatrix: { Ghost: ["Ghost"], Ground: ["Default", "Ground"] } },
};

describe("collision matrix", () => {
  it("lets two layers that the matrix separates pass through each other", async () => {
    const harness = await createPhysicsApp({ settings: SETTINGS });
    try {
      const layers = harness.world.layers;
      const floor = harness.world.createEntity("Floor");
      floor.layer = layers.requireIndex("Ground");
      floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });

      const solid = harness.world.createEntity("Solid");
      solid.layer = layers.requireIndex("Default");
      solid.transform.position = { x: 0, y: 4, z: 0 };
      solid.addComponent(BoxCollider);
      solid.addComponent(Rigidbody, { interpolation: "none" });

      const ghost = harness.world.createEntity("Ghost");
      ghost.layer = layers.requireIndex("Ghost");
      ghost.transform.position = { x: 4, y: 4, z: 0 };
      ghost.addComponent(BoxCollider);
      ghost.addComponent(Rigidbody, { interpolation: "none" });

      harness.stepMany(120);
      // `Default` is not in `Ground`'s row, but `Default` has no row of its own, so its mask is
      // "everything" — and Havok needs *both* directions, so the pair collides.
      expect(solid.transform.position.y).toBeGreaterThan(0.9);
      // `Ghost` collides only with `Ghost`, so it falls straight through the floor.
      expect(ghost.transform.position.y).toBeLessThan(-5);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("applies a runtime layer change on the next fixed step", async () => {
    const harness = await createPhysicsApp({ settings: SETTINGS });
    try {
      const layers = harness.world.layers;
      const floor = harness.world.createEntity("Floor");
      floor.layer = layers.requireIndex("Ground");
      floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });

      const box = harness.world.createEntity("Box");
      box.layer = layers.requireIndex("Default");
      box.transform.position = { x: 0, y: 4, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });

      harness.stepMany(120);
      const resting = box.transform.position.y;
      expect(resting).toBeGreaterThan(0.9);

      box.layer = layers.requireIndex("Ghost");
      harness.stepMany(120);
      expect(box.transform.position.y).toBeLessThan(resting - 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("refuses a collision matrix that names a layer the project does not declare", async () => {
    let code: string | null = null;
    try {
      await createPhysicsApp({
        settings: { layers: ["Default"], physics: { collisionMatrix: { Nope: ["Default"] } } },
      });
    } catch (error: unknown) {
      code = (error as { code?: string }).code ?? null;
    }
    expect(code).toBe(PhysicsErrorCode.unknownLayer);
  }, 30_000);

  it("honours a collider's layerOverride", async () => {
    const harness = await createPhysicsApp({ settings: SETTINGS });
    try {
      const layers = harness.world.layers;
      const floor = harness.world.createEntity("Floor");
      floor.layer = layers.requireIndex("Ground");
      floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });

      // The entity sits on `Default`, which would collide, but the collider filters as `Ghost`.
      const box = harness.world.createEntity("Box");
      box.layer = layers.requireIndex("Default");
      box.transform.position = { x: 0, y: 4, z: 0 };
      box.addComponent(BoxCollider, { layerOverride: "Ghost" });
      box.addComponent(Rigidbody, { interpolation: "none" });

      harness.stepMany(120);
      expect(box.transform.position.y).toBeLessThan(-5);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
