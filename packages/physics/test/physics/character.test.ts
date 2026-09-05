import { Quat, Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController } from "../../src/components/character-controller.js";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { createPhysicsApp } from "../support/harness.js";
import type { CharacterCollision } from "../../src/events.js";
import type { PhysicsAppHarness } from "../support/harness.js";
import type { Entity, ScriptCallbacks } from "@ignifx/core";

/**
 * `CharacterController` (`docs/architecture/09-physics.md` §2.3): support classification against the
 * slope limit, collide-and-slide, dynamic-body pushing, skin width, and the interpolation restore.
 */

/** Walks its entity a fixed displacement every step, pressed into the ground. */
class Walker extends Script implements ScriptCallbacks {
  static typeId = "test/Walker";

  /** Metres along +X per step. */
  forward = 0.03;

  /** Metres downwards per step, standing in for gravity. */
  down = 0.02;

  /** The authoritative position at the top of each step. */
  readonly samples: number[] = [];

  fixedUpdate(): void {
    this.samples.push(this.transform.position.y);
    this.entity.requireComponent(CharacterController).move({ x: this.forward, y: -this.down, z: 0 });
  }
}

describe("CharacterController", () => {
  it("reports supported on flat ground and never on a 60° slope", async () => {
    const flat = await standOn(0);
    const steep = await standOn(60);
    expect(flat).toEqual({ grounded: true, state: "supported" });
    expect(steep.grounded).toBe(false);
    expect(steep.state).not.toBe("supported");
  }, 30_000);

  it("reports sliding on any incline, because a bare controller has no static friction", async () => {
    // Measured against `@babylonjs/lite@1.27.0`: `PhysicsCharacterController.staticFriction`
    // defaults to `0` (`index.d.ts` 8310), so a kinematic capsule pressed against *any* incline
    // keeps a residual down-slope velocity and `checkSupport` classifies it as `SLIDING` — even at
    // 10°, and regardless of `slopeLimit`. `slopeLimit` still decides what the character can climb,
    // which is what the next test asserts, and the 3D toolkit's controllers (Phase 7) add the
    // friction and gravity handling that make `supportState` read the way Unity's does.
    const gentle = await standOn(10);
    expect(gentle.state).toBe("sliding");
  }, 30_000);

  it("walks up a 30° slope and is stopped by a 60° one", async () => {
    const gentle = await climb(30);
    const steep = await climb(60);
    expect(gentle).toBeGreaterThan(0.1);
    expect(steep).toBeLessThan(gentle / 2);
  }, 30_000);

  it("keeps its skin width off the floor", async () => {
    const thin = await restingHeight(0.01);
    const thick = await restingHeight(0.2);
    // `skinWidth` is Lite's `keepDistance`: the separation the solver maintains from a surface.
    expect(thick - thin).toBeGreaterThan(0.1);
  }, 30_000);

  it("pushes a dynamic body and reports it through onCollided", async () => {
    const harness = await createPhysicsApp();
    try {
      floor(harness);
      const crate = harness.world.createEntity("Crate");
      crate.transform.position = { x: 1.2, y: 1.4, z: 0 };
      crate.addComponent(BoxCollider, { size: { x: 0.8, y: 0.8, z: 0.8 } });
      crate.addComponent(Rigidbody, { mass: 0.5, interpolation: "none" });

      const player = harness.world.createEntity("Player");
      player.transform.position = { x: 0, y: 1.4, z: 0 };
      const controller = player.addComponent(CharacterController, { pushStrength: 1 });
      const pushes: CharacterCollision[] = [];
      controller.onCollided.connect((collision): void => {
        pushes.push({ other: collision.other, impulse: collision.impulse, point: collision.point });
      });
      const walker = player.addComponent(Walker);
      walker.down = 0.005;

      const startX = crate.transform.position.x;
      harness.stepMany(120);
      expect(crate.transform.position.x).toBeGreaterThan(startX + 0.05);
      expect(pushes.length).toBeGreaterThan(0);
      expect(pushes[0]?.other?.name).toBe("Crate");
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("restores its authoritative position before fixedUpdate", async () => {
    const interpolated = await walkSamples("interpolate");
    const plain = await walkSamples("none");
    expect(interpolated).toEqual(plain);
    expect(interpolated.length).toBeGreaterThan(20);
  }, 30_000);

  it("teleports, resizes, and reports its velocity", async () => {
    const harness = await createPhysicsApp();
    try {
      floor(harness);
      const player = harness.world.createEntity("Player");
      player.transform.position = { x: 0, y: 1.4, z: 0 };
      const controller = player.addComponent(CharacterController);
      harness.stepMany(4);

      controller.teleport({ x: 5, y: 1.4, z: 0 });
      harness.step();
      expect(player.transform.position.x).toBeCloseTo(5, 1);

      controller.setVelocity({ x: 2, y: 0, z: 0 });
      expect(controller.velocity.x).toBeCloseTo(2, 3);

      controller.setHeight(1);
      harness.step();
      expect(controller.height).toBe(1);
      expect(controller.groundNormal.y).toBeGreaterThan(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

/**
 * Adds a large static floor to a harness.
 *
 * @param harness - The app under test.
 * @returns The floor entity.
 */
function floor(harness: PhysicsAppHarness): Entity {
  const entity = harness.world.createEntity("Floor");
  entity.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
  return entity;
}

/**
 * Builds a ramp of the given inclination, rising along +X.
 *
 * @param harness - The app under test.
 * @param degrees - The slope angle.
 * @returns The ramp entity.
 */
function ramp(harness: PhysicsAppHarness, degrees: number): Entity {
  const entity = harness.world.createEntity("Ramp");
  entity.transform.position = { x: 0, y: 0, z: 0 };
  entity.transform.rotation = Quat.fromEulerDegrees(0, 0, degrees);
  entity.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 10 } });
  return entity;
}

/**
 * Drops a controller onto a ramp and reports how the support probe classified it.
 *
 * @param degrees - The ramp's inclination.
 * @returns Whether the controller is grounded, and its support state.
 */
async function standOn(degrees: number): Promise<{ grounded: boolean; state: string }> {
  const harness = await createPhysicsApp();
  try {
    ramp(harness, degrees);
    const player = harness.world.createEntity("Player");
    player.transform.position = { x: 0, y: 1.6, z: 0 };
    const controller = player.addComponent(CharacterController);
    const walker = player.addComponent(Walker);
    walker.forward = 0;
    walker.down = 0.02;
    harness.stepMany(90);
    return { grounded: controller.isGrounded, state: controller.supportState };
  } finally {
    harness.dispose();
  }
}

/**
 * Walks a controller up a ramp and reports how much height it gained.
 *
 * @param degrees - The ramp's inclination.
 * @returns The height gained, in metres.
 */
async function climb(degrees: number): Promise<number> {
  const harness = await createPhysicsApp();
  try {
    ramp(harness, degrees);
    const player = harness.world.createEntity("Player");
    player.transform.position = { x: 0, y: 1.6, z: 0 };
    player.addComponent(CharacterController);
    player.addComponent(Walker);
    harness.stepMany(30);
    const start = player.transform.position.y;
    harness.stepMany(120);
    return player.transform.position.y - start;
  } finally {
    harness.dispose();
  }
}

/**
 * Settles a controller onto a flat floor and reports where it came to rest.
 *
 * @param skinWidth - The controller's `skinWidth`.
 * @returns The resting Y of the entity.
 */
async function restingHeight(skinWidth: number): Promise<number> {
  const harness = await createPhysicsApp();
  try {
    floor(harness);
    const player = harness.world.createEntity("Player");
    player.transform.position = { x: 0, y: 2, z: 0 };
    player.addComponent(CharacterController, { skinWidth });
    player.addComponent(Walker).forward = 0;
    harness.stepMany(150);
    return player.transform.position.y;
  } finally {
    harness.dispose();
  }
}

/**
 * Walks a controller on flat ground with irregular frames and returns the authoritative poses its
 * script observed at the top of each step.
 *
 * @param interpolation - Which interpolation mode the controller uses.
 * @returns The samples.
 */
async function walkSamples(interpolation: "none" | "interpolate"): Promise<readonly number[]> {
  const harness = await createPhysicsApp();
  try {
    floor(harness);
    const player = harness.world.createEntity("Player");
    player.transform.position = { x: 0, y: 1.4, z: 0 };
    player.addComponent(CharacterController, { interpolation });
    const walker = player.addComponent(Walker);
    for (let index = 0; index < 40; index += 1) {
      harness.step(1 / 40);
    }
    return [...walker.samples];
  } finally {
    harness.dispose();
  }
}
