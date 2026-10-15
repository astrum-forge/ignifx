import { describe, expect, it } from "vitest";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp } from "../support/harness.js";

/**
 * `@ignifx/physics-2d` in an edit-mode app (ADR-0028): the restore, step, and interpolation systems
 * do not run, so nothing falls, nothing overwrites a transform the editor moves, and no body exists.
 */

/** A frame delta that is not a whole number of fixed steps, so a game app would interpolate. */
const IRREGULAR_DELTA = 1 / 40;

describe("2D physics in an edit-mode app", () => {
  it("does not step: a dynamic body stays where it was authored", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      const body = harness.world.createEntity("Falling");
      body.transform.position = { x: 0, y: 10, z: 0 };
      body.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      body.addComponent(Rigidbody2D);
      harness.stepMany(30);
      expect(body.transform.position.y).toBe(10);
      expect(harness.app.diagnostics.frame.fixedSteps).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("leaves a transform the editor moved alone, with interpolation on", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      const body = harness.world.createEntity("Crate");
      body.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      body.addComponent(Rigidbody2D, { interpolation: "interpolate" });
      harness.stepMany(5, IRREGULAR_DELTA);
      body.transform.position = { x: 3, y: 2, z: 0 };
      harness.stepMany(5, IRREGULAR_DELTA);
      expect(body.transform.position.x).toBe(3);
      expect(body.transform.position.y).toBe(2);
    } finally {
      harness.dispose();
    }
  });

  it("builds no body, so a query is refused as it is before a game's first step", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      harness.stepMany(10);
      expect(() => harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 })).toThrow(/IGX-1153/u);
    } finally {
      harness.dispose();
    }
  });
});
