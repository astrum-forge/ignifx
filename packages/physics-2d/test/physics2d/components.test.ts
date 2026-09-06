import { Vec2 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import {
  BoxCollider2D,
  CapsuleCollider2D,
  CircleCollider2D,
  EdgeCollider2D,
  PolygonCollider2D,
} from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp } from "../support/harness.js";
import type { ErrorReport } from "@ignifx/core";

/**
 * The component behaviours `11-2d-toolkit.md` §8 promises: implicit static bodies and their
 * `IGX-1151` diagnostic, exact mass, forces and impulses, teleports, damping, frozen rotation, and
 * the geometry each collider builds.
 */

describe("implicit static bodies", () => {
  it("gives a collider-only entity a static body that holds a dynamic one up", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 4, z: 0 };
      ball.addComponent(CircleCollider2D, { radius: 0.5 });
      ball.addComponent(Rigidbody2D, { interpolation: "none" });
      harness.stepMany(200);
      expect(ball.transform.position.y).toBeCloseTo(0.5, 1);
      expect(harness.sink.toArray().some((record) => record.message.includes("IGX-1151"))).toBe(false);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("reports IGX-1151 once when an implicit static body is moved", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      harness.step();
      floor.transform.position = { x: 3, y: 0, z: 0 };
      harness.stepMany(4);
      const reported = harness.sink.toArray().filter((record) => record.message.includes("IGX-1151"));
      expect(reported.length).toBe(1);
    } finally {
      harness.dispose();
    }
  });
});

describe("Rigidbody2D", () => {
  it("weighs exactly what mass says, and derives the mass from area when mass is 0", async () => {
    const harness = await createPhysics2DApp();
    try {
      const heavy = harness.world.createEntity("Heavy");
      heavy.transform.position = { x: 0, y: 5, z: 0 };
      heavy.addComponent(BoxCollider2D, { size: { x: 2, y: 2 } });
      const heavyBody = heavy.addComponent(Rigidbody2D, { mass: 7 });

      const auto = harness.world.createEntity("Auto");
      auto.transform.position = { x: 5, y: 5, z: 0 };
      auto.addComponent(BoxCollider2D, { size: { x: 2, y: 2 } });
      const autoBody = auto.addComponent(Rigidbody2D, { mass: 0 });

      harness.step();
      expect(heavyBody.computedMass).toBeCloseTo(7, 4);
      // Rapier's default density is 1 kg/m², so a 2 x 2 box weighs 4 kg.
      expect(autoBody.computedMass).toBeCloseTo(4, 4);
    } finally {
      harness.dispose();
    }
  });

  it("reads and writes velocities in ignifx units", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, {
        gravityScale: 0,
        angularDamping: 0,
        interpolation: "none",
      });
      harness.step();

      rigidbody.linearVelocity = { x: 3, y: -2 };
      rigidbody.angularVelocity = 90;
      harness.step();
      expect(rigidbody.linearVelocity.x).toBeCloseTo(3, 3);
      expect(rigidbody.linearVelocity.y).toBeCloseTo(-2, 3);
      expect(rigidbody.angularVelocity).toBeCloseTo(90, 2);

      const out = rigidbody.linearVelocityToRef(new Vec2());
      expect(out.x).toBeCloseTo(3, 3);
    } finally {
      harness.dispose();
    }
  });

  it("accelerates under a force and jumps under an impulse", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, { mass: 1, gravityScale: 0, interpolation: "none" });
      harness.step();

      for (let index = 0; index < 60; index += 1) {
        rigidbody.addForce({ x: 10, y: 0 });
        harness.step();
      }
      expect(rigidbody.linearVelocity.x).toBeGreaterThan(8);

      rigidbody.linearVelocity = { x: 0, y: 0 };
      rigidbody.addImpulse({ x: 0, y: 5 });
      harness.step();
      expect(rigidbody.linearVelocity.y).toBeCloseTo(5, 1);
    } finally {
      harness.dispose();
    }
  });

  it("spins under a torque and stops when rotation is frozen", async () => {
    const harness = await createPhysics2DApp();
    try {
      const spinner = harness.world.createEntity("Spinner");
      spinner.addComponent(BoxCollider2D);
      const spin = spinner.addComponent(Rigidbody2D, { gravityScale: 0, angularDamping: 0, interpolation: "none" });

      const locked = harness.world.createEntity("Locked");
      locked.transform.position = { x: 5, y: 0, z: 0 };
      locked.addComponent(BoxCollider2D);
      const lock = locked.addComponent(Rigidbody2D, {
        gravityScale: 0,
        freezeRotation: true,
        interpolation: "none",
      });
      harness.step();

      for (let index = 0; index < 30; index += 1) {
        spin.addTorque(2);
        lock.addTorque(2);
        harness.step();
      }
      expect(spin.angularVelocity).toBeGreaterThan(1);
      expect(lock.angularVelocity).toBe(0);
      expect(Math.abs(spinner.transform.rotation2D)).toBeGreaterThan(0.1);
      expect(locked.transform.rotation2D).toBeCloseTo(0, 5);
    } finally {
      harness.dispose();
    }
  });

  it("slows a body down with linear damping", async () => {
    const harness = await createPhysics2DApp();
    try {
      const fast = harness.world.createEntity("Fast");
      fast.addComponent(BoxCollider2D);
      const fastBody = fast.addComponent(Rigidbody2D, { gravityScale: 0, interpolation: "none" });
      const slow = harness.world.createEntity("Slow");
      slow.transform.position = { x: 10, y: 0, z: 0 };
      slow.addComponent(BoxCollider2D);
      const slowBody = slow.addComponent(Rigidbody2D, { gravityScale: 0, linearDamping: 4, interpolation: "none" });
      harness.step();
      fastBody.linearVelocity = { x: 10, y: 0 };
      slowBody.linearVelocity = { x: 10, y: 0 };
      harness.stepMany(60);
      expect(fastBody.linearVelocity.x).toBeCloseTo(10, 2);
      expect(slowBody.linearVelocity.x).toBeLessThan(1);
    } finally {
      harness.dispose();
    }
  });

  it("teleports without leaving a velocity behind", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.transform.position = { x: 0, y: 10, z: 0 };
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, { interpolation: "none" });
      harness.stepMany(20);
      rigidbody.teleport({ x: 4, y: 4 }, 45);
      expect(body.transform.position.x).toBeCloseTo(4, 5);
      expect(body.transform.rotation2D).toBeCloseTo(45, 4);
      harness.step();
      expect(body.transform.position.x).toBeCloseTo(4, 2);
      expect(body.transform.position.z).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("keeps a kinematic body exactly where the game puts it and pushes dynamic bodies", async () => {
    const harness = await createPhysics2DApp();
    try {
      const platform = harness.world.createEntity("Platform");
      platform.addComponent(BoxCollider2D, { size: { x: 4, y: 0.5 } });
      platform.addComponent(Rigidbody2D, { bodyType: "kinematic", interpolation: "none" });

      const crate = harness.world.createEntity("Crate");
      crate.transform.position = { x: 0, y: 1, z: 0 };
      crate.addComponent(BoxCollider2D);
      crate.addComponent(Rigidbody2D, { interpolation: "none" });

      for (let index = 0; index < 120; index += 1) {
        platform.transform.position = { x: index * 0.02, y: 0, z: 0 };
        harness.step();
      }
      expect(platform.transform.position.x).toBeCloseTo(119 * 0.02, 2);
      expect(crate.transform.position.y).toBeCloseTo(0.75, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("collider geometry", () => {
  it("supports circles, capsules, convex polygons, and edge chains", async () => {
    const harness = await createPhysics2DApp();
    try {
      const ground = harness.world.createEntity("Ground");
      ground.addComponent(EdgeCollider2D, {
        points: [
          { x: -10, y: 0 },
          { x: 10, y: 0 },
        ],
      });
      const wedge = harness.world.createEntity("Wedge");
      wedge.transform.position = { x: 4, y: 0, z: 0 };
      wedge.addComponent(PolygonCollider2D, {
        points: [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      });

      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 3, z: 0 };
      ball.addComponent(CircleCollider2D, { radius: 0.5 });
      ball.addComponent(Rigidbody2D, { interpolation: "none" });

      const pill = harness.world.createEntity("Pill");
      pill.transform.position = { x: -3, y: 3, z: 0 };
      pill.addComponent(CapsuleCollider2D, { radius: 0.25, height: 1, direction: "y" });
      pill.addComponent(Rigidbody2D, { freezeRotation: true, interpolation: "none" });

      harness.stepMany(240);
      expect(ball.transform.position.y).toBeCloseTo(0.5, 1);
      expect(pill.transform.position.y).toBeCloseTo(0.5, 1);
      harness.step();
      expect(harness.app.physics2d.raycast({ x: 4, y: 5 }, { x: 0, y: -1 }, 20)?.entity.name).toBe("Wedge");
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("lays a horizontal capsule on its side", async () => {
    const harness = await createPhysics2DApp();
    try {
      const ground = harness.world.createEntity("Ground");
      ground.transform.position = { x: 0, y: -0.5, z: 0 };
      ground.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      const pill = harness.world.createEntity("Pill");
      pill.transform.position = { x: 0, y: 3, z: 0 };
      pill.addComponent(CapsuleCollider2D, { radius: 0.25, height: 2, direction: "x" });
      pill.addComponent(Rigidbody2D, { freezeRotation: true, interpolation: "none" });
      harness.stepMany(240);
      // Lying down, the capsule's half-height is its radius, not half its length.
      expect(pill.transform.position.y).toBeCloseTo(0.25, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("refuses degenerate point lists with IGX-1156", async () => {
    const harness = await createPhysics2DApp();
    try {
      const reported: string[] = [];
      harness.app.onError.connect((report: ErrorReport): void => {
        reported.push(report.error instanceof Error ? report.error.message : String(report.error));
      });
      const bad = harness.world.createEntity("Bad");
      bad.addComponent(PolygonCollider2D, { points: [{ x: 0, y: 0 }] });
      harness.step();
      // The scheduler catches a system failure and routes it to `app.onError`
      // (`packages/core/src/scheduler/scheduler.ts`), so the code arrives there rather than at the
      // call site.
      expect(reported.some((message) => message.includes("IGX-1156"))).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it("scales shapes by the entity's lossy scale", async () => {
    const harness = await createPhysics2DApp();
    try {
      const ground = harness.world.createEntity("Ground");
      ground.transform.position = { x: 0, y: -0.5, z: 0 };
      ground.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      const big = harness.world.createEntity("Big");
      big.transform.position = { x: 0, y: 6, z: 0 };
      big.transform.localScale2D = new Vec2(1, 4);
      big.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      big.addComponent(Rigidbody2D, { freezeRotation: true, interpolation: "none" });
      harness.stepMany(300);
      // A unit box scaled 4x in Y rests with its centre two metres above the floor.
      expect(big.transform.position.y).toBeCloseTo(2, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
