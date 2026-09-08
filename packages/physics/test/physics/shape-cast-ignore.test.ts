import { describe, expect, it } from "vitest";
import { CharacterController } from "../../src/components/character-controller.js";
import { BoxCollider } from "../../src/components/colliders.js";
import { createPhysicsApp } from "../support/harness.js";
import type { PhysicsAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * `ShapeCastOptions.ignore` (`docs/architecture/09-physics.md` §5, 2026-09-08).
 *
 * Lite's `ShapeCastQuery` has no collision masks, so a sweep cannot be filtered by layer; what it
 * can do is pass through one body (`ignoreBody`). These tests pin the two cases that motivated it:
 * a sweep that starts *inside* a body reports that body at fraction zero unless it is ignored, and
 * a `CharacterController`'s capsule — which is not a `Rigidbody` record — is one of the bodies that
 * can be ignored, because the third-person camera boom starts inside exactly that capsule.
 */

/** Where the wall every sweep here is meant to find stands, on x. */
const WALL_X = 4;

/**
 * Adds a static box at the origin of the given size.
 *
 * @param harness - The app.
 * @param name - The entity name.
 * @param x - Its centre's x.
 * @param size - Its edge lengths.
 * @returns The entity.
 */
function addBlock(harness: PhysicsAppHarness, name: string, x: number, size: number): Entity {
  const entity = harness.world.createEntity(name);
  entity.transform.position = { x, y: 0, z: 0 };
  entity.addComponent(BoxCollider, { size: { x: size, y: size, z: size } });
  return entity;
}

describe("shapeCast with an ignored entity", () => {
  it("passes through the ignored static body and reports the one behind it", async () => {
    const harness = await createPhysicsApp();
    try {
      const shell = addBlock(harness, "Shell", 0, 2);
      addBlock(harness, "Wall", WALL_X, 1);
      harness.stepMany(2);

      const sweep = { kind: "sphere", radius: 0.2 } as const;
      const from = { x: 0, y: 0, z: 0 };
      const to = { x: 8, y: 0, z: 0 };

      // Starting inside the shell, the sweep is stopped by it before it has moved at all.
      const blocked = harness.app.physics.shapeCast(sweep, from, to);
      expect(blocked).not.toBeNull();
      expect(blocked?.fraction ?? 1).toBeLessThan(0.05);
      expect(blocked?.entity?.name).toBe("Shell");

      // Ignoring the shell lets the same sweep reach the wall.
      const through = harness.app.physics.shapeCast(sweep, from, to, { ignore: shell });
      expect(through).not.toBeNull();
      expect(through?.entity?.name).toBe("Wall");
      // The wall's near face is at x = 3.5 and the sphere's radius is 0.2, over an 8 m sweep.
      expect(through?.distance ?? 0).toBeCloseTo(WALL_X - 0.5 - 0.2, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("passes through a character controller's capsule", async () => {
    const harness = await createPhysicsApp();
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
      // A wall tall enough to be in the sweep's path at shoulder height, on the far side of the player.
      const wall = harness.world.createEntity("Wall");
      wall.transform.position = { x: -WALL_X, y: 1.5, z: 0 };
      wall.addComponent(BoxCollider, { size: { x: 1, y: 4, z: 4 } });
      const player = harness.world.createEntity("Player");
      player.transform.position = { x: 0, y: 1.4, z: 0 };
      player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
      harness.stepMany(4);

      // A boom leaving a shoulder pivot just outside the capsule and sweeping back through it, which
      // is what a third-person rig does on every yaw whose camera ends up on the far side.
      const sweep = { kind: "sphere", radius: 0.2 } as const;
      const pivot = { x: 0.6, y: 1.4, z: 0 };
      const far = { x: -8, y: 1.4, z: 0 };

      const blocked = harness.app.physics.shapeCast(sweep, pivot, far);
      expect(blocked).not.toBeNull();
      expect(blocked?.fraction ?? 1).toBeLessThan(0.05);
      // A controller's capsule is not in the body-bounds index, so the hit is geometry with no
      // entity — which is exactly why a rig could not tell it apart from a wall.
      expect(blocked?.entity ?? null).toBeNull();

      const through = harness.app.physics.shapeCast(sweep, pivot, far, { ignore: player });
      expect(through).not.toBeNull();
      expect(through?.entity?.name).toBe("Wall");
      // The wall's near face is at x = -3.5, the pivot at 0.6, the sphere's radius 0.2.
      expect(through?.distance ?? 0).toBeCloseTo(0.6 + WALL_X - 0.5 - 0.2, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("ignores nothing when the entity has no body", async () => {
    const harness = await createPhysicsApp();
    try {
      addBlock(harness, "Wall", WALL_X, 1);
      const ghost = harness.world.createEntity("Ghost");
      harness.stepMany(2);

      const hit = harness.app.physics.shapeCast(
        { kind: "sphere", radius: 0.2 },
        { x: 0, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
        { ignore: ghost },
      );
      expect(hit?.entity?.name).toBe("Wall");
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
