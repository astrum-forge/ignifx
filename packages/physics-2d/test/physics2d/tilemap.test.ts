import { describe, expect, it } from "vitest";
import { CharacterController2D } from "../../src/components/character-controller.js";
import { CircleCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { TilemapCollider2D } from "../../src/components/tilemap-collider.js";
import { createPhysics2DApp, FIXED_STEP } from "../support/harness.js";
import type { TilemapCollisionData } from "@ignifx/2d";

/**
 * `TilemapCollider2D` (`docs/architecture/11-2d-toolkit.md` §2.5, §8).
 *
 * The collision data is built by hand here rather than by `@ignifx/2d`'s loader: the toolkit is an
 * **optional** peer, and the contract this package consumes is the `TilemapCollisionData` shape, not
 * the loader that produces it.
 */

/**
 * Builds a floor two cells thick spanning `x ∈ [-4, 4]`, plus one one-way ledge.
 *
 * @param version - The data version, which is what the runtime watches for changes.
 * @param withLedge - Whether to include the one-way ledge.
 * @returns The collision data.
 */
function buildData(version: number, withLedge: boolean): TilemapCollisionData {
  return {
    cellSize: 1,
    chunkSize: 8,
    version,
    chunks: [
      {
        chunkX: 0,
        chunkY: 0,
        polygons: [
          [
            { x: -4, y: -1 },
            { x: 4, y: -1 },
            { x: 4, y: 0 },
            { x: -4, y: 0 },
          ],
        ],
        oneWayEdges: withLedge
          ? [
              [
                { x: -2, y: 3 },
                { x: 2, y: 3 },
              ],
            ]
          : [],
      },
    ],
  };
}

describe("TilemapCollider2D", () => {
  it("builds a solid outline a body rests on", async () => {
    const harness = await createPhysics2DApp();
    try {
      const map = harness.world.createEntity("Map");
      const collider = map.addComponent(TilemapCollider2D);
      collider.collisionData = buildData(1, false);

      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 4, z: 0 };
      ball.addComponent(CircleCollider2D, { radius: 0.5 });
      ball.addComponent(Rigidbody2D, { interpolation: "none" });

      harness.stepMany(240);
      expect(ball.transform.position.y).toBeCloseTo(0.5, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("rebuilds when the data's version changes", async () => {
    const harness = await createPhysics2DApp();
    try {
      const map = harness.world.createEntity("Map");
      const collider = map.addComponent(TilemapCollider2D);
      collider.collisionData = buildData(1, false);
      harness.stepMany(2);
      expect(harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20)?.entity.name).toBe("Map");

      // A tile edit publishes new geometry under a new version; the runtime notices without any
      // cross-package signal.
      collider.collisionData = {
        ...buildData(2, false),
        chunks: [{ chunkX: 0, chunkY: 0, polygons: [], oneWayEdges: [] }],
      };
      harness.stepMany(2);
      expect(harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20)).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("drops its shapes when the data goes away", async () => {
    const harness = await createPhysics2DApp();
    try {
      const map = harness.world.createEntity("Map");
      const collider = map.addComponent(TilemapCollider2D);
      collider.collisionData = buildData(1, false);
      harness.stepMany(2);
      collider.collisionData = null;
      harness.stepMany(2);
      expect(collider.collisionData).toBeNull();
      expect(harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20)).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("turns a one-way edge into a platform a character jumps up through", async () => {
    const harness = await createPhysics2DApp();
    try {
      const map = harness.world.createEntity("Map");
      const collider = map.addComponent(TilemapCollider2D);
      collider.collisionData = buildData(1, true);

      const hero = harness.world.createEntity("Hero");
      hero.transform.position = { x: 0, y: 0.52, z: 0 };
      const controller = hero.addComponent(CharacterController2D, { interpolation: "none" });

      let peak = 0;
      for (let index = 0; index < 200; index += 1) {
        controller.move({ x: 0, y: (index < 40 ? 8 : -8) * FIXED_STEP });
        harness.step();
        peak = Math.max(peak, hero.transform.position.y);
      }
      expect(peak).toBeGreaterThan(3.6);
      // Coming back down it lands on the edge, whose surface is at y = 3.
      expect(hero.transform.position.y).toBeGreaterThan(3.4);
      expect(hero.transform.position.y).toBeLessThan(3.7);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
