import { describe, expect, it } from "vitest";
import { CharacterController2D } from "../../src/components/character-controller.js";
import { BoxCollider2D, PolygonCollider2D } from "../../src/components/colliders.js";
import { createPhysics2DApp, FIXED_STEP } from "../support/harness.js";
import type { CharacterCollision2D } from "../../src/events.js";
import type { Physics2DAppHarness } from "../support/harness.js";
import type { Entity, Vec2Like } from "@ignifx/core";

/**
 * `CharacterController2D` (`docs/architecture/11-2d-toolkit.md` §8): slopes, autostep,
 * snap-to-ground, and one-way platforms, each measured against the behaviour spike S6.2 pinned.
 *
 * Every scene here follows the spike's geometry: the flat ground the character starts on and the
 * ramp or ledge it walks into are separate static bodies whose surfaces meet at `x = 0`.
 */

/** Metres per second the test characters walk at. */
const WALK_SPEED = 2;

/** The downward pull the tests apply, standing in for a toolkit controller's gravity. */
const FALL_SPEED = 9.81;

/** A gentle downward pull that keeps a grounded character on the floor. */
const STICK_SPEED = 1;

/**
 * Adds a static box.
 *
 * @param harness - The app.
 * @param name - The entity name.
 * @param centre - The box centre, in metres.
 * @param size - The full width and height.
 * @returns The entity.
 */
function addBox(harness: Physics2DAppHarness, name: string, centre: Vec2Like, size: Vec2Like): Entity {
  const entity = harness.world.createEntity(name);
  entity.transform.position = { x: centre.x, y: centre.y, z: 0 };
  entity.addComponent(BoxCollider2D, { size });
  return entity;
}

/**
 * Adds a ramp whose top surface passes through the origin at the given angle, buried under the flat
 * ground to its left so the character walks onto it without meeting an end face.
 *
 * @param harness - The app.
 * @param degrees - The slope, positive rising to the right.
 * @returns The entity.
 */
function addRamp(harness: Physics2DAppHarness, degrees: number): Entity {
  const radians = (degrees * Math.PI) / 180;
  const halfLength = 10;
  const halfThickness = 0.5;
  const points: Vec2Like[] = [
    { x: -halfLength, y: -halfThickness },
    { x: halfLength, y: -halfThickness },
    { x: halfLength, y: halfThickness },
    { x: -halfLength, y: halfThickness },
  ];
  const rotated = points.map((point) => ({
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  }));
  const entity = harness.world.createEntity("Ramp");
  // The surface midpoint sits at x = 5 on the line y = tan(angle) · x; the body origin is that
  // point pushed half a thickness along the inward normal.
  entity.transform.position = {
    x: 5 + halfThickness * Math.sin(radians),
    y: Math.tan(radians) * 5 - halfThickness * Math.cos(radians),
    z: 0,
  };
  entity.addComponent(PolygonCollider2D, { points: rotated });
  return entity;
}

/**
 * Adds a character and returns it with its controller.
 *
 * @param harness - The app.
 * @param x - Where it starts.
 * @param fields - Controller field overrides.
 * @returns The entity and its controller.
 */
function addCharacter(
  harness: Physics2DAppHarness,
  x: number,
  fields: Partial<{
    shape: "capsule" | "box";
    radius: number;
    height: number;
    slopeLimit: number;
    stepOffset: number;
    snapToGround: number;
    onOneWayPlatforms: boolean;
    interpolation: "none" | "interpolate";
  }>,
): { readonly entity: Entity; readonly controller: CharacterController2D } {
  const radius = fields.radius ?? 0.2;
  const height = fields.height ?? 1.2;
  const entity = harness.world.createEntity("Hero");
  entity.transform.position = { x, y: Math.max(radius, height / 2) + 0.02, z: 0 };
  const controller = entity.addComponent(CharacterController2D, { interpolation: "none", ...fields });
  return { entity, controller };
}

/**
 * Walks a character to the right for a number of fixed steps.
 *
 * @param harness - The app.
 * @param controller - The controller to drive.
 * @param steps - How many fixed steps to run.
 * @param speed - Horizontal speed in metres per second.
 */
function walk(
  harness: Physics2DAppHarness,
  controller: CharacterController2D,
  steps: number,
  speed = WALK_SPEED,
): void {
  for (let index = 0; index < steps; index += 1) {
    const pull = controller.isGrounded ? STICK_SPEED : FALL_SPEED;
    controller.move({ x: speed * FIXED_STEP, y: -pull * FIXED_STEP });
    harness.step();
  }
}

describe("CharacterController2D slopes", () => {
  it("walks up a 30 degree slope when the limit is 45", async () => {
    const harness = await createPhysics2DApp();
    try {
      addBox(harness, "Ground", { x: -3, y: -0.5 }, { x: 6, y: 1 });
      addRamp(harness, 30);
      const hero = addCharacter(harness, -2, { slopeLimit: 45 });
      walk(harness, hero.controller, 600);
      const position = hero.entity.transform.position;
      expect(position.x).toBeGreaterThan(2);
      // The feet track the ramp surface y = tan(30°) · x, within the controller's skin width.
      expect(Math.abs(position.y - 0.6 - Math.tan(Math.PI / 6) * position.x)).toBeLessThan(0.12);
      expect(hero.controller.isGrounded).toBe(true);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("refuses a 60 degree slope when the limit is 45", async () => {
    const harness = await createPhysics2DApp();
    try {
      addBox(harness, "Ground", { x: -3, y: -0.5 }, { x: 6, y: 1 });
      addRamp(harness, 60);
      const hero = addCharacter(harness, -2, { slopeLimit: 45 });
      walk(harness, hero.controller, 600);
      expect(hero.entity.transform.position.x).toBeLessThan(0.2);
      expect(hero.entity.transform.position.y).toBeLessThan(0.8);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("climbs the same 60 degree slope once the limit allows it", async () => {
    const harness = await createPhysics2DApp();
    try {
      addBox(harness, "Ground", { x: -3, y: -0.5 }, { x: 6, y: 1 });
      addRamp(harness, 60);
      const hero = addCharacter(harness, -2, { slopeLimit: 75 });
      walk(harness, hero.controller, 600);
      expect(hero.entity.transform.position.y).toBeGreaterThan(1);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("CharacterController2D autostep", () => {
  it("steps a box character up a 0.3 m ledge and refuses it without stepOffset", async () => {
    const climbed = async (stepOffset: number): Promise<number> => {
      const harness = await createPhysics2DApp();
      try {
        addBox(harness, "Ground", { x: 0, y: -0.5 }, { x: 40, y: 1 });
        addBox(harness, "Ledge", { x: 20, y: 0.15 }, { x: 40, y: 0.3 });
        const hero = addCharacter(harness, -1, { shape: "box", radius: 0.2, height: 1.2, stepOffset });
        walk(harness, hero.controller, 200);
        return hero.entity.transform.position.y - 0.6;
      } finally {
        harness.dispose();
      }
    };
    expect(await climbed(0.35)).toBeGreaterThan(0.25);
    expect(await climbed(0)).toBeLessThan(0.05);
  }, 30_000);

  it("refuses a step taller than stepOffset", async () => {
    const harness = await createPhysics2DApp();
    try {
      addBox(harness, "Ground", { x: 0, y: -0.5 }, { x: 40, y: 1 });
      addBox(harness, "Ledge", { x: 20, y: 0.25 }, { x: 40, y: 0.5 });
      const hero = addCharacter(harness, -1, { shape: "box", radius: 0.2, height: 1.2, stepOffset: 0.35 });
      walk(harness, hero.controller, 200);
      expect(hero.entity.transform.position.y - 0.6).toBeLessThan(0.05);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("CharacterController2D snap-to-ground", () => {
  it("keeps the character on a descending slope", async () => {
    const airborneFrames = async (snapToGround: number): Promise<number> => {
      const harness = await createPhysics2DApp();
      try {
        addRamp(harness, -25);
        const hero = addCharacter(harness, 0.5, { snapToGround, slopeLimit: 50 });
        let airborne = 0;
        for (let index = 0; index < 200; index += 1) {
          hero.controller.move({ x: 4 * FIXED_STEP, y: -(hero.controller.isGrounded ? 0.2 : FALL_SPEED) * FIXED_STEP });
          harness.step();
          if (!hero.controller.isGrounded) {
            airborne += 1;
          }
        }
        return airborne;
      } finally {
        harness.dispose();
      }
    };
    expect(await airborneFrames(0.5)).toBeLessThan(5);
    expect(await airborneFrames(0)).toBeGreaterThan(20);
  }, 30_000);
});

describe("CharacterController2D one-way platforms", () => {
  it("passes up through a one-way platform and lands on it coming down", async () => {
    const harness = await createPhysics2DApp();
    try {
      addBox(harness, "Ground", { x: 0, y: -0.5 }, { x: 12, y: 1 });
      const platform = harness.world.createEntity("Platform");
      platform.transform.position = { x: 0, y: 2, z: 0 };
      platform.addComponent(BoxCollider2D, { size: { x: 4, y: 0.2 }, oneWay: true });

      const hero = addCharacter(harness, 0, { onOneWayPlatforms: true });
      let peak = 0;
      for (let index = 0; index < 260; index += 1) {
        hero.controller.move({ x: 0, y: (index < 40 ? 7 : -7) * FIXED_STEP });
        harness.step();
        peak = Math.max(peak, hero.entity.transform.position.y);
      }
      expect(peak).toBeGreaterThan(2.8);
      // It came back down and is resting on top of the platform (top at y = 2.1, feet 0.6 below).
      expect(hero.entity.transform.position.y).toBeGreaterThan(2.6);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("treats the same platform as solid when the controller opts out", async () => {
    const harness = await createPhysics2DApp();
    try {
      addBox(harness, "Ground", { x: 0, y: -0.5 }, { x: 12, y: 1 });
      const platform = harness.world.createEntity("Platform");
      platform.transform.position = { x: 0, y: 2, z: 0 };
      platform.addComponent(BoxCollider2D, { size: { x: 4, y: 0.2 }, oneWay: true });

      const hero = addCharacter(harness, 0, { onOneWayPlatforms: false });
      for (let index = 0; index < 60; index += 1) {
        hero.controller.move({ x: 0, y: 7 * FIXED_STEP });
        harness.step();
      }
      expect(hero.entity.transform.position.y).toBeLessThan(1.9);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("CharacterController2D reporting", () => {
  it("reports velocity, ground normal, and the obstacles it hit", async () => {
    const harness = await createPhysics2DApp();
    try {
      addBox(harness, "Ground", { x: 0, y: -0.5 }, { x: 12, y: 1 });
      const hero = addCharacter(harness, 0, {});
      const hits: string[] = [];
      hero.controller.onCollided.connect((collision: CharacterCollision2D): void => {
        hits.push(collision.other?.name ?? "-");
      });
      walk(harness, hero.controller, 30);
      expect(hero.controller.isGrounded).toBe(true);
      expect(hero.controller.velocity.x).toBeGreaterThan(0);
      expect(hero.controller.groundNormal.y).toBeGreaterThan(0.9);
      expect(hits).toContain("Ground");
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("teleports without sliding", async () => {
    const harness = await createPhysics2DApp();
    try {
      addBox(harness, "Ground", { x: 0, y: -0.5 }, { x: 12, y: 1 });
      const hero = addCharacter(harness, 0, {});
      walk(harness, hero.controller, 10);
      hero.controller.teleport({ x: 4, y: 3 });
      expect(hero.entity.transform.position.x).toBeCloseTo(4, 5);
      harness.step();
      expect(hero.entity.transform.position.x).toBeCloseTo(4, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
