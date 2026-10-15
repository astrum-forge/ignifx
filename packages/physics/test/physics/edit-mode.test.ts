import { describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { createPhysicsApp } from "../support/harness.js";

/**
 * `@ignifx/physics` in an edit-mode app (ADR-0028): the restore, step, and interpolation systems do
 * not run, so nothing falls, nothing overwrites a transform the editor moves, and no body exists.
 */

/** A frame delta that is not a whole number of fixed steps, so a game app would interpolate. */
const IRREGULAR_DELTA = 1 / 40;

describe("physics in an edit-mode app", () => {
  it("does not step: a dynamic body stays where it was authored", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 10, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { mass: 1 });
      harness.stepMany(30);
      expect(box.transform.position.y).toBe(10);
      expect(harness.app.diagnostics.frame.fixedSteps).toBe(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("leaves a transform the editor moved alone, with interpolation on", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const box = harness.world.createEntity("Box");
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "interpolate" });
      harness.stepMany(5, IRREGULAR_DELTA);
      box.transform.position = { x: 3, y: 2, z: 1 };
      harness.stepMany(5, IRREGULAR_DELTA);
      expect(box.transform.position.x).toBe(3);
      expect(box.transform.position.y).toBe(2);
      expect(box.transform.position.z).toBe(1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("builds no body, so a query is refused as it is before a game's first step", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      harness.stepMany(10);
      expect(() => harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10)).toThrow(/IGX-0902/u);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
