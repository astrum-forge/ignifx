import { Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController } from "../../src/components/character-controller.js";
import { BoxCollider, HeightfieldCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { createPhysicsApp, FIXED_STEP } from "../support/harness.js";
import type { PhysicsAppHarness } from "../support/harness.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * A capsule `CharacterController` standing and jumping on a sloped `HeightfieldCollider` — the
 * terrain-walk failure: above about 7° the character read "not grounded" even standing still, so it
 * could not jump. A rigid body on the same field always rested correctly, which is why the suite
 * also drops a box: the field itself is not in question, only the controller's support probe.
 */

/** Samples per side of the field. */
const SAMPLES = 33;

/** The field's extent in metres. */
const EXTENT = 64;

/** The downward acceleration the test character applies to itself, in m/s². */
const GRAVITY = 20;

/** The take-off speed of a jump, in m/s. */
const JUMP_SPEED = 6;

/** The small downward speed a grounded character keeps, so it stays pressed onto the slope. */
const STICK_SPEED = 1;

/** A minimal character script: gravity, a ground stick, and a jump on request. */
class Jumper extends Script implements ScriptCallbacks {
  static typeId = "test/Jumper";

  /** Vertical speed, positive upwards. */
  verticalSpeed = 0;

  /** Set to jump on the next fixed step. */
  wantsJump = false;

  fixedUpdate(dt: number): void {
    const controller = this.entity.requireComponent(CharacterController);
    if (this.wantsJump && controller.isGrounded) {
      this.verticalSpeed = JUMP_SPEED;
      this.wantsJump = false;
    } else if (controller.isGrounded && this.verticalSpeed <= 0) {
      this.verticalSpeed = -STICK_SPEED;
    } else {
      this.verticalSpeed -= GRAVITY * dt;
    }
    controller.move({ x: 0, y: this.verticalSpeed * dt, z: 0 });
  }
}

/**
 * Heights for a uniform slope of `degrees`, rising along one grid axis and level along the other.
 *
 * @param degrees - The slope angle.
 * @returns The heights, row by row.
 */
function slopeHeights(degrees: number): number[] {
  const rise = Math.tan((degrees * Math.PI) / 180);
  const spacing = EXTENT / (SAMPLES - 1);
  const heights: number[] = [];
  for (let iz = 0; iz < SAMPLES; iz += 1) {
    for (let ix = 0; ix < SAMPLES; ix += 1) {
      heights.push((ix * spacing - EXTENT / 2) * rise);
    }
  }
  return heights;
}

/**
 * Adds a sloped heightfield to a harness.
 *
 * @param harness - The app under test.
 * @param degrees - The slope angle.
 */
function slope(harness: PhysicsAppHarness, degrees: number): void {
  harness.world.createEntity("Ground").addComponent(HeightfieldCollider, {
    heights: slopeHeights(degrees),
    samplesX: SAMPLES,
    samplesZ: SAMPLES,
    size: { x: EXTENT, y: 0, z: EXTENT },
  });
}

/**
 * The height of the field at a world X: the plane `y = x tan a`. The last test checks this against
 * rays, which cannot measure under the character itself — a ray that meets the capsule first
 * reports no hit.
 *
 * @param x - The world X.
 * @param degrees - The slope angle.
 * @returns The height.
 */
function planeHeight(x: number, degrees: number): number {
  return x * Math.tan((degrees * Math.PI) / 180);
}

/**
 * The slope angle a normal describes, in degrees.
 *
 * @param normal - The normal.
 * @param normal.y - Its vertical component.
 * @returns The angle.
 */
function slopeOf(normal: { readonly y: number }): number {
  return (Math.acos(Math.min(1, normal.y)) * 180) / Math.PI;
}

describe("a CharacterController on a sloped HeightfieldCollider", () => {
  for (const degrees of [0, 10, 20, 30]) {
    it(`stands grounded on a ${String(degrees)}° slope, close to the surface`, async () => {
      const harness = await createPhysicsApp();
      try {
        slope(harness, degrees);
        const player = harness.world.createEntity("Player");
        player.transform.position = { x: 0, y: 3, z: 0 };
        const controller = player.addComponent(CharacterController);
        player.addComponent(Jumper);
        harness.stepMany(90);

        expect(controller.supportState).toBe("supported");
        expect(controller.isGrounded).toBe(true);
        // The averaged contact normal can read shallower than the face where the capsule touches a
        // triangle edge of the field, never steeper.
        expect(slopeOf(controller.groundNormal)).toBeLessThan(degrees + 1);

        // A capsule's lowest point clears a plane of slope `a` by `r (1 / cos a - 1)` plus the skin.
        // Lite's controller can come to rest anywhere inside its contact tolerance
        // (`keepContactTolerance`, 0.1 m, `index.d.ts` 8304) on top of that, and no further.
        const at = player.transform.position;
        const feet = at.y - controller.height / 2;
        const cosine = Math.cos((degrees * Math.PI) / 180);
        const clearance = controller.radius * (1 / cosine - 1) + controller.skinWidth / cosine;
        expect(feet - planeHeight(at.x, degrees)).toBeGreaterThan(0);
        expect(feet - planeHeight(at.x, degrees)).toBeLessThan(clearance + 0.1 + 0.05);
      } finally {
        harness.dispose();
      }
    }, 30_000);
  }

  for (const degrees of [10, 20, 30]) {
    it(`jumps off a ${String(degrees)}° slope and lands grounded again`, async () => {
      const harness = await createPhysicsApp();
      try {
        slope(harness, degrees);
        const player = harness.world.createEntity("Player");
        player.transform.position = { x: 0, y: 3, z: 0 };
        const controller = player.addComponent(CharacterController);
        const jumper = player.addComponent(Jumper);
        harness.stepMany(90);
        expect(controller.isGrounded).toBe(true);

        const standing = player.transform.position.y;
        jumper.wantsJump = true;
        // A quarter of the way to the apex: 6 m/s against 20 m/s² peaks after 0.3 s.
        harness.stepMany(Math.round(0.15 / FIXED_STEP));
        expect(controller.isGrounded).toBe(false);
        expect(player.transform.position.y).toBeGreaterThan(standing + 0.3);

        harness.stepMany(90);
        expect(controller.isGrounded).toBe(true);
        expect(player.transform.position.y).toBeCloseTo(standing, 0);
      } finally {
        harness.dispose();
      }
    }, 30_000);
  }

  it("is the controller, not the field: the field is the plane, and a box rests on it", async () => {
    const harness = await createPhysicsApp();
    try {
      slope(harness, 20);
      harness.step();
      for (const [x, z] of [
        [5, 0],
        [-5, 3],
        [12, -7],
      ] as const) {
        const hit = harness.app.physics.raycast({ x, y: 100, z }, { x: 0, y: -1, z: 0 }, 300);
        expect(hit?.point.y ?? Number.NaN).toBeCloseTo(planeHeight(x, 20), 2);
      }
      const crate = harness.world.createEntity("Crate");
      crate.transform.position = { x: 0, y: 3, z: 0 };
      crate.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
      crate.addComponent(Rigidbody, { mass: 1, interpolation: "none" });
      harness.stepMany(90);
      const at = crate.transform.position;
      // Resting or tumbling, the box stays in contact with the field rather than hovering above it.
      expect(at.y - planeHeight(at.x, 20)).toBeLessThan(1);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
