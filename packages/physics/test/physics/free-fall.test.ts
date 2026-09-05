import { describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { createPhysicsApp, FIXED_STEP } from "../support/harness.js";

/**
 * Exit criterion 1 of Phase 4: Lite's own headless free-fall example, reproduced *through* ignifx —
 * the same box, the same gravity, but stepped by the fixed loop on the simulation scene instead of
 * by Lite's per-frame callback (`docs/architecture/09-physics.md` §1, spike S4.1).
 */

/** Standard gravity, matching the `physics.gravity` default. */
const GRAVITY_Y = -9.81;

describe("analytic free fall", () => {
  it("matches y = y0 - ½·g·t² to within half a step of velocity after 60 steps", async () => {
    const harness = await createPhysicsApp();
    try {
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 10, z: 0 };
      box.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
      box.addComponent(Rigidbody, { mass: 1, interpolation: "none" });

      const steps = 60;
      const drops: number[] = [];
      let previous = 10;
      for (let index = 0; index < steps; index += 1) {
        harness.step();
        const y = box.transform.position.y;
        drops.push(previous - y);
        previous = y;
      }

      const y = box.transform.position.y;
      const elapsed = steps * FIXED_STEP;
      const analytic = 10 + 0.5 * GRAVITY_Y * elapsed * elapsed;

      // A semi-implicit (symplectic) Euler integrator lags the exact parabola by at most half a
      // step of velocity: |y - y_analytic| <= ½·g·h·t. At 60 Hz over one second that bound is
      // 0.5 * 9.81 * (1/60) * 1 = 0.0818 m, and it is the tolerance this test states.
      const tolerance = 0.5 * Math.abs(GRAVITY_Y) * FIXED_STEP * elapsed;
      expect(Math.abs(y - analytic)).toBeLessThan(tolerance);
      expect(y).toBeLessThan(10);

      // The integrator itself: after the first step, every step's drop grows by exactly one
      // gravity increment, g·h². (Havok's *first* step integrates only about 0.61 of one gravity
      // increment — measured against @babylonjs/lite@1.27.0 / @babylonjs/havok@1.3.14 — which is
      // why the analytic comparison above carries the half-step tolerance rather than an equality.)
      const increment = Math.abs(GRAVITY_Y) * FIXED_STEP * FIXED_STEP;
      // Precision 5 rather than 6: a body pose round-trips through Lite's `ObservableVec3`, whose
      // storage is `Float32Array`, so a metre-scale value carries about 1e-7 of quantisation.
      for (let index = 2; index < steps; index += 1) {
        const growth = (drops[index] ?? 0) - (drops[index - 1] ?? 0);
        expect(growth).toBeCloseTo(increment, 5);
      }
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("puts the same pose on the render scene's node as on the body", async () => {
    const harness = await createPhysicsApp();
    try {
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 4, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(10);

      // The body is bound to `transform.lite`, the very node the render scene draws, so reading the
      // transform *is* reading the simulation (`09-physics.md` §1).
      expect(box.transform.position.y).toBeLessThan(4);
      expect(box.transform.lite.position.y).toBe(box.transform.position.y);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("rests on a static floor", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: 0, z: 0 };
      floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });

      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 3, z: 0 };
      box.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
      box.addComponent(Rigidbody, { interpolation: "none" });

      harness.stepMany(180);
      // The floor's top is y = 0.5 and the box's half-height is 0.5, so it rests at y = 1.
      expect(box.transform.position.y).toBeGreaterThan(0.99);
      expect(box.transform.position.y).toBeLessThan(1.01);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
