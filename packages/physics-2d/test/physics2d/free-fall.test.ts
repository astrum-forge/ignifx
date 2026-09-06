import { describe, expect, it } from "vitest";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp, FIXED_STEP } from "../support/harness.js";

describe("2D free fall", () => {
  it("falls at gravity, within Rapier's integrator tolerance", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Falling");
      body.transform.position = { x: 0, y: 10, z: 0 };
      body.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      body.addComponent(Rigidbody2D, { interpolation: "none" });
      harness.stepMany(60);
      const analytic = 10 - 0.5 * 9.81 * 1;
      expect(body.transform.position.y).toBeCloseTo(analytic, 1);
      expect(Math.abs(body.transform.position.y - analytic)).toBeLessThan(0.05);
      expect(body.transform.position.x).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("lands on a static floor and stops", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      const crate = harness.world.createEntity("Crate");
      crate.transform.position = { x: 0, y: 5, z: 0 };
      crate.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      const rigidbody = crate.addComponent(Rigidbody2D, { interpolation: "none" });
      harness.stepMany(240);
      expect(crate.transform.position.y).toBeCloseTo(0.5, 1);
      expect(Math.abs(rigidbody.linearVelocity.y)).toBeLessThan(0.05);
    } finally {
      harness.dispose();
    }
  });

  it("respects gravityScale and a fixed step", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floaty = harness.world.createEntity("Floaty");
      floaty.transform.position = { x: 0, y: 10, z: 0 };
      floaty.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      floaty.addComponent(Rigidbody2D, { gravityScale: 0, interpolation: "none" });
      harness.stepMany(60, FIXED_STEP);
      expect(floaty.transform.position.y).toBeCloseTo(10, 5);
    } finally {
      harness.dispose();
    }
  });
});
