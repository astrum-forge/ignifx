import { describe, expect, it } from "vitest";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp, FIXED_STEP } from "../support/harness.js";

/**
 * Interpolation (`docs/architecture/09-physics.md` §1, identical in 2D): the `Systems(Update, -900)`
 * system writes `lerp(prev, cur, time.fixedStepAlpha)` at the top of `Update` and the
 * `FixedUpdate −100` system puts the authoritative pose back before anything reads it, so the
 * display pose never leaks into Rapier. `display-pose.test.ts` covers the other half: everything
 * outside the fixed loop reads the display pose.
 */

describe("2D interpolation", () => {
  it("shows a display pose between the two fixed poses and restores the authoritative one", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.transform.position = { x: 0, y: 10, z: 0 };
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, { gravityScale: 0, interpolation: "interpolate" });
      harness.step();
      rigidbody.linearVelocity = { x: 6, y: 0 };
      harness.step();
      const afterFullStep = body.transform.position.x;

      // Half a fixed step's worth of frame time leaves the alpha at 0.5 and the display pose
      // halfway between the last two authoritative ones.
      harness.step(FIXED_STEP / 2);
      const displayed = body.transform.position.x;
      expect(displayed).toBeGreaterThan(afterFullStep);
      expect(displayed).toBeLessThan(afterFullStep + 6 * FIXED_STEP);
    } finally {
      harness.dispose();
    }
  });

  it("leaves a body alone when interpolation is off", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.transform.position = { x: 0, y: 10, z: 0 };
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, { gravityScale: 0, interpolation: "none" });
      harness.step();
      rigidbody.linearVelocity = { x: 6, y: 0 };
      harness.step();
      const afterFullStep = body.transform.position.x;
      harness.step(FIXED_STEP / 2);
      expect(body.transform.position.x).toBe(afterFullStep);
    } finally {
      harness.dispose();
    }
  });

  it("switches interpolation off for the whole world from settings", async () => {
    const harness = await createPhysics2DApp({ settings: { physics2d: { interpolation: false } } });
    try {
      const body = harness.world.createEntity("Body");
      body.transform.position = { x: 0, y: 10, z: 0 };
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, { gravityScale: 0 });
      harness.step();
      rigidbody.linearVelocity = { x: 6, y: 0 };
      harness.step();
      const afterFullStep = body.transform.position.x;
      harness.step(FIXED_STEP / 2);
      expect(body.transform.position.x).toBe(afterFullStep);
    } finally {
      harness.dispose();
    }
  });

  it("interpolates rotation the short way round", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, {
        gravityScale: 0,
        angularDamping: 0,
        interpolation: "interpolate",
      });
      harness.step();
      rigidbody.angularVelocity = 600;
      harness.stepMany(4);
      const displayed = body.transform.rotation2D;
      expect(Number.isFinite(displayed)).toBe(true);
      expect(Math.abs(displayed)).toBeLessThanOrEqual(180.001);
    } finally {
      harness.dispose();
    }
  });
});
