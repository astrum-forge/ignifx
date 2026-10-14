import { LayerMask } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController } from "../../src/components/character-controller.js";
import { BoxCollider } from "../../src/components/colliders.js";
import { createPhysicsApp } from "../support/harness.js";
import type { PhysicsAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * Queries against a `CharacterController` (`docs/architecture/09-physics.md` §5). The controller's
 * capsule is a real Havok body, but it lives in the runtime's controller records rather than its
 * body records, so until 2026-10-14 a ray that hit it returned `null` and `shapeCast`/`overlap` never
 * named the character.
 */

/** The capsule's centre height when it stands on the floor: floor top 0.5 plus half of 1.8. */
const STANDING_Y = 1.4;

/** The capsule's top: its centre plus half its height. */
const HEAD_Y = 2.3;

/** Straight down. */
const DOWN = { x: 0, y: -1, z: 0 } as const;

/** A scene with a floor on the default layer and a character on the `Player` layer. */
interface Scene {
  /** The app. */
  readonly harness: PhysicsAppHarness;
  /** The floor, 40 m square, top face at y = 0.5. */
  readonly floor: Entity;
  /** The character. */
  readonly player: Entity;
  /** Its controller. */
  readonly controller: CharacterController;
}

/**
 * Builds the scene and steps it until the broadphase exists.
 *
 * @returns The scene.
 */
async function standingCharacter(): Promise<Scene> {
  const harness = await createPhysicsApp({ settings: { layers: ["Default", "Player"] } });
  const floor = harness.world.createEntity("Floor");
  floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
  const player = harness.world.createEntity("Player");
  player.layer = harness.world.layers.requireIndex("Player");
  player.transform.position = { x: 0, y: STANDING_Y, z: 0 };
  const controller = player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
  harness.stepMany(4);
  return { harness, floor, player, controller };
}

/**
 * A mask of the named layers.
 *
 * @param harness - The app.
 * @param layers - Layer names.
 * @returns The mask.
 */
function only(harness: PhysicsAppHarness, ...layers: string[]): LayerMask {
  return LayerMask.fromNames(harness.world.layers, layers);
}

/**
 * The names of the entities an overlap reports.
 *
 * @param entities - The overlap result.
 * @returns Their names, in order.
 */
function names(entities: readonly Entity[]): string[] {
  return entities.map((entity) => entity.name);
}

describe("raycast against a character controller", () => {
  it("returns the character's entity, with no collider", async () => {
    const { harness } = await standingCharacter();
    try {
      const hit = harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, DOWN, 10);
      expect(hit?.entity.name).toBe("Player");
      expect(hit?.collider).toBeNull();
      expect(hit?.point.y).toBeCloseTo(HEAD_Y, 2);
      expect(hit?.normal.y).toBeCloseTo(1, 3);
      expect(hit?.distance).toBeCloseTo(5 - HEAD_Y, 2);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("passes through the capsule when the layer mask excludes the character", async () => {
    const { harness, player } = await standingCharacter();
    try {
      const behind = harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, DOWN, 10, {
        layerMask: only(harness, "Default"),
      });
      expect(behind?.entity.name).toBe("Floor");
      expect(behind?.point.y).toBeCloseTo(0.5, 2);
      // Measured from the caller's origin, not from where the ray resumed inside the capsule.
      expect(behind?.distance).toBeCloseTo(4.5, 2);

      const character = harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, DOWN, 10, {
        layerMask: only(harness, "Player"),
      });
      expect(character?.entity).toBe(player);
      expect(
        harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, DOWN, 10, { layerMask: LayerMask.nothing() }),
      ).toBeNull();
      // Running out of length inside the skipped capsule is a miss, not a reversed ray.
      expect(
        harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, DOWN, 3, { layerMask: only(harness, "Default") }),
      ).toBeNull();

      // A layer change reaches the query filter on the next fixed step, as it does for a body.
      player.layer = harness.world.layers.requireIndex("Default");
      harness.step();
      const moved = harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, DOWN, 10, {
        layerMask: only(harness, "Default"),
      });
      expect(moved?.entity).toBe(player);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("follows the capsule as it moves, and forgets it once the controller is removed", async () => {
    const { harness, player, controller } = await standingCharacter();
    try {
      for (let step = 0; step < 40; step += 1) {
        controller.move({ x: 0.05, y: 0, z: 0 });
        harness.step();
      }
      const x = player.transform.position.x;
      expect(x).toBeGreaterThan(1.5);
      expect(harness.app.physics.raycast({ x, y: 5, z: 0 }, DOWN, 10)?.entity).toBe(player);
      expect(harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, DOWN, 10)?.entity.name).toBe("Floor");

      controller.rebuild();
      harness.step();
      expect(harness.app.physics.raycast({ x, y: 5, z: 0 }, DOWN, 10)?.entity).toBe(player);

      player.removeComponent(controller);
      harness.step();
      expect(harness.app.physics.raycast({ x, y: 5, z: 0 }, DOWN, 10)?.entity.name).toBe("Floor");
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("shapeCast against a character controller", () => {
  it("attributes the capsule to the character, and passes through it when told to ignore it", async () => {
    const { harness, player } = await standingCharacter();
    try {
      const sweep = { kind: "sphere", radius: 0.2 } as const;
      const from = { x: 0, y: 5, z: 0 };
      const to = { x: 0, y: -5, z: 0 };

      const hit = harness.app.physics.shapeCast(sweep, from, to);
      expect(hit?.entity).toBe(player);
      expect(hit?.collider).toBeNull();
      expect(hit?.point.y).toBeCloseTo(HEAD_Y, 1);

      const through = harness.app.physics.shapeCast(sweep, from, to, { ignore: player });
      expect(through?.entity?.name).toBe("Floor");

      // A sweep cannot be layer-filtered, so the capsule still stops it; the mask only decides
      // that the contact is not attributed to the character.
      const masked = harness.app.physics.shapeCast(sweep, from, to, { layerMask: only(harness, "Default") });
      expect(masked?.point.y).toBeCloseTo(HEAD_Y, 1);
      expect(masked?.entity ?? null).toBeNull();
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("overlap against a character controller", () => {
  it("lists the character, filtered by layer", async () => {
    const { harness } = await standingCharacter();
    try {
      const probe = { kind: "sphere", radius: 0.5 } as const;
      const torso = { x: 0, y: STANDING_Y, z: 0 };
      expect(names(harness.app.physics.overlap(probe, torso))).toEqual(["Player"]);
      expect(
        names(harness.app.physics.overlap(probe, torso, undefined, { layerMask: only(harness, "Default") })),
      ).toEqual([]);
      expect(names(harness.app.physics.overlap(probe, { x: 5, y: STANDING_Y, z: 0 }))).toEqual([]);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("tracks teleports and crouching", async () => {
    const { harness, controller } = await standingCharacter();
    try {
      const probe = { kind: "sphere", radius: 0.1 } as const;
      const head = { x: 0, y: HEAD_Y - 0.2, z: 0 };
      expect(names(harness.app.physics.overlap(probe, head))).toEqual(["Player"]);

      // Crouching keeps the feet and lowers the top of the capsule to 0.5 + 1.0.
      controller.setHeight(1, true);
      harness.step();
      expect(names(harness.app.physics.overlap(probe, head))).toEqual([]);
      expect(names(harness.app.physics.overlap(probe, { x: 0, y: 1.4, z: 0 }))).toEqual(["Player"]);

      controller.teleport({ x: 6, y: 1, z: 0 });
      expect(names(harness.app.physics.overlap(probe, { x: 6, y: 1, z: 0 }))).toEqual(["Player"]);
      expect(names(harness.app.physics.overlap(probe, { x: 0, y: 1, z: 0 }))).toEqual([]);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
