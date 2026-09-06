import { createApp, createManualClock, createMemorySink } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController2D } from "../../src/components/character-controller.js";
import { BoxCollider2D, CircleCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { TilemapCollider2D } from "../../src/components/tilemap-collider.js";
import { physics2d } from "../../src/extension.js";
import { createPhysics2DApp, FIXED_STEP } from "../support/harness.js";

/**
 * The edges: bodies that exist before the extension starts, components used on an app that never
 * registered `physics2d()`, combine rules, off-centre impulses, and teardown.
 */

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

describe("bodies that exist before the world does", () => {
  it("seeds every collider, controller, and rigidbody that was attached before start", async () => {
    const clock = createManualClock();
    const app = await createApp({ headless: true, clock, logSink: createMemorySink(), extensions: [physics2d()] });
    try {
      const floor = app.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      const crate = app.world.createEntity("Crate");
      crate.transform.position = { x: 0, y: 4, z: 0 };
      crate.addComponent(BoxCollider2D);
      crate.addComponent(Rigidbody2D, { interpolation: "none" });
      const hero = app.world.createEntity("Hero");
      hero.transform.position = { x: 3, y: 1, z: 0 };
      hero.addComponent(CharacterController2D);
      const map = app.world.createEntity("Map");
      map.addComponent(TilemapCollider2D);

      // Everything above was attached while the runtime was still `null`; `onStart`'s catch-up pass
      // is what gives them bodies.
      await app.start();
      for (let index = 0; index < 240; index += 1) {
        clock.advance(FIXED_STEP * MILLISECONDS_PER_SECOND);
        app.step(FIXED_STEP);
      }
      expect(crate.transform.position.y).toBeCloseTo(0.5, 1);
      const group = app.diagnostics.group("physics2d");
      expect(group?.get(group.index("bodies"))).toBe(3);
    } finally {
      app.dispose();
    }
  }, 30_000);
});

describe("components without the extension", () => {
  it("does nothing rather than throwing when physics2d() was never registered", async () => {
    const app = await createApp({ headless: true, clock: createManualClock() });
    try {
      await app.start();
      const entity = app.world.createEntity("Lonely");
      const rigidbody = entity.addComponent(Rigidbody2D);
      const controller = entity.addComponent(CharacterController2D);
      rigidbody.addForce({ x: 1, y: 0 });
      rigidbody.addImpulse({ x: 1, y: 0 }, { x: 0, y: 1 });
      rigidbody.addTorque(1);
      rigidbody.linearVelocity = { x: 1, y: 1 };
      rigidbody.angularVelocity = 10;
      rigidbody.teleport({ x: 2, y: 2 });
      rigidbody.rebuild();
      controller.move({ x: 1, y: 0 });
      controller.teleport({ x: 1, y: 1 });
      controller.rebuild();
      expect(rigidbody.linearVelocity.x).toBe(0);
      expect(rigidbody.angularVelocity).toBe(0);
      expect(rigidbody.computedMass).toBe(0);
      expect(rigidbody.rapier.body).toBeNull();
      expect(controller.velocity.x).toBe(0);
      expect(controller.isGrounded).toBe(false);
      expect(controller.groundNormal.y).toBe(1);
    } finally {
      app.dispose();
    }
  });
});

/**
 * Slides a crate down a 20-degree slope and reports how far it travelled, with the two surfaces'
 * frictions combined by the named rule.
 *
 * @param frictionCombine - The rule both colliders declare.
 * @returns The crate's final X position, in metres.
 */
async function slideDistance(frictionCombine: "average" | "min" | "multiply" | "max"): Promise<number> {
  const harness = await createPhysics2DApp();
  try {
    const slope = harness.world.createEntity("Slope");
    slope.transform.position = { x: 0, y: -0.5, z: 0 };
    slope.transform.rotation2D = 20;
    slope.addComponent(BoxCollider2D, {
      size: { x: 40, y: 1 },
      inlineMaterial: { friction: 1, restitution: 0 },
      frictionCombine,
    });
    const crate = harness.world.createEntity("Crate");
    crate.transform.position = { x: 0, y: 1, z: 0 };
    crate.addComponent(BoxCollider2D, { inlineMaterial: { friction: 0.02, restitution: 0 }, frictionCombine });
    crate.addComponent(Rigidbody2D, { interpolation: "none" });
    harness.stepMany(180);
    return crate.transform.position.x;
  } finally {
    harness.dispose();
  }
}

describe("surfaces and off-centre forces", () => {
  it("combines friction with the rule each collider names", async () => {
    const slippery = await slideDistance("multiply");
    const grippy = await slideDistance("max");
    // 1 x 0.02 slides much further than max(1, 0.02).
    expect(slippery).toBeLessThan(grippy);
    expect(await slideDistance("min")).toBeLessThan(grippy);
    expect(await slideDistance("average")).toBeLessThan(grippy);
  }, 60_000);

  it("spins a body with an impulse applied away from its centre of mass", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      const rigidbody = body.addComponent(Rigidbody2D, {
        gravityScale: 0,
        angularDamping: 0,
        interpolation: "none",
      });
      harness.step();
      rigidbody.addImpulse({ x: 2, y: 0 }, { x: 0, y: 0.5 });
      harness.step();
      expect(Math.abs(rigidbody.angularVelocity)).toBeGreaterThan(1);
      rigidbody.addForce({ x: 0, y: 1 }, { x: 0.5, y: 0 });
      harness.step();
      expect(rigidbody.linearVelocity.y).toBeGreaterThan(0);
    } finally {
      harness.dispose();
    }
  });

  it("drops a body's Rapier objects when its entity is destroyed", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      const doomed = harness.world.createEntity("Doomed");
      doomed.transform.position = { x: 0, y: 4, z: 0 };
      doomed.addComponent(CircleCollider2D);
      doomed.addComponent(Rigidbody2D);
      harness.stepMany(3);
      const group = harness.app.diagnostics.group("physics2d");
      expect(group?.get(group.index("bodies"))).toBe(2);
      doomed.destroy();
      harness.stepMany(3);
      expect(group?.get(group.index("bodies"))).toBe(1);
      expect(harness.app.physics2d.raycast({ x: 0, y: 8 }, { x: 0, y: -1 }, 20)?.entity.name).toBe("Floor");
    } finally {
      harness.dispose();
    }
  });

  it("removes a body when its last collider is removed and rebuilds it when one returns", async () => {
    const harness = await createPhysics2DApp();
    try {
      const entity = harness.world.createEntity("Shifter");
      const collider = entity.addComponent(BoxCollider2D);
      harness.stepMany(2);
      const group = harness.app.diagnostics.group("physics2d");
      expect(group?.get(group.index("bodies"))).toBe(1);
      collider.destroy();
      harness.stepMany(2);
      expect(group?.get(group.index("bodies"))).toBe(0);
      entity.addComponent(CircleCollider2D);
      harness.stepMany(2);
      expect(group?.get(group.index("bodies"))).toBe(1);
    } finally {
      harness.dispose();
    }
  });

  it("carries a dynamic body's velocity across a rebuild", async () => {
    const harness = await createPhysics2DApp();
    try {
      const entity = harness.world.createEntity("Mover");
      entity.addComponent(BoxCollider2D);
      const rigidbody = entity.addComponent(Rigidbody2D, { gravityScale: 0, interpolation: "none" });
      harness.step();
      rigidbody.linearVelocity = { x: 5, y: 0 };
      harness.step();
      rigidbody.rebuild();
      harness.step();
      expect(rigidbody.linearVelocity.x).toBeCloseTo(5, 2);
    } finally {
      harness.dispose();
    }
  });

  it("rebuilds a body when its entity changes layer", async () => {
    const harness = await createPhysics2DApp({
      settings: {
        layers: { layers: ["Default", "Ghost"] },
        physics2d: { collisionMatrix: { Ghost: [] as string[] } },
      },
    });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 3, z: 0 };
      ball.addComponent(CircleCollider2D);
      ball.addComponent(Rigidbody2D, { interpolation: "none" });
      harness.stepMany(200);
      expect(ball.transform.position.y).toBeCloseTo(0.5, 1);
      ball.layer = harness.world.layers.indexOf("Ghost");
      harness.stepMany(120);
      expect(ball.transform.position.y).toBeLessThan(-1);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
