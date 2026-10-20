import { Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider2D, CircleCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { TilemapCollider2D } from "../../src/components/tilemap-collider.js";
import { createPhysics2DApp } from "../support/harness.js";
import type { Physics2DAppHarness } from "../support/harness.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * `@ignifx/physics-2d` in an edit-mode app (ADR-0028 and its amendment of 2026-10-20): bodies exist
 * and follow the scene, so queries answer, but nothing steps. Nothing falls, no collision or
 * trigger callback fires, and no simulated pose overwrites a transform the editor moves.
 */

/** A frame delta that is not a whole number of fixed steps, so a game app would interpolate. */
const IRREGULAR_DELTA = 1 / 40;

/** Straight down. */
const DOWN = { x: 0, y: -1 };

/** Counts every physics callback, and opts in to edit mode so the gate would let them through. */
class PhysicsProbe2D extends Script implements ScriptCallbacks {
  static typeId = "test/EditModePhysicsProbe2D";

  static runInEditMode = true;

  /** Every physics callback received, by name. */
  readonly calls: string[] = [];

  onCollisionEnter(): void {
    this.calls.push("onCollisionEnter");
  }

  onCollisionStay(): void {
    this.calls.push("onCollisionStay");
  }

  onCollisionExit(): void {
    this.calls.push("onCollisionExit");
  }

  onTriggerEnter(): void {
    this.calls.push("onTriggerEnter");
  }

  onTriggerExit(): void {
    this.calls.push("onTriggerExit");
  }
}

/**
 * Casts a ray straight down from 10 m above a point.
 *
 * @param harness - The harness.
 * @param x - The world X.
 * @returns The entity name hit, or `null`.
 */
function hitBelow(harness: Physics2DAppHarness, x: number): string | null {
  return harness.app.physics2d.raycast({ x, y: 10 }, DOWN, 20)?.entity.name ?? null;
}

describe("2D physics in an edit-mode app", () => {
  it("does not step: a dynamic body stays where it was authored", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      const body = harness.world.createEntity("Falling");
      body.transform.position = { x: 0, y: 5, z: 0 };
      body.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      body.addComponent(Rigidbody2D);
      harness.stepMany(30);
      expect(body.transform.position.y).toBe(5);
      expect(harness.app.diagnostics.frame.fixedSteps).toBe(0);
      // The body exists all the same, where it was authored.
      expect(hitBelow(harness, 0)).toBe("Falling");
      expect(harness.app.physics2d.raycast({ x: 0, y: 10 }, DOWN, 20)?.point.y).toBeCloseTo(5.5);
    } finally {
      harness.dispose();
    }
  });

  it("leaves a transform the editor moved alone, with interpolation on", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      const body = harness.world.createEntity("Crate");
      body.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      body.addComponent(Rigidbody2D, { interpolation: "interpolate" });
      harness.stepMany(5, IRREGULAR_DELTA);
      body.transform.position = { x: 3, y: 2, z: 0 };
      harness.stepMany(5, IRREGULAR_DELTA);
      expect(body.transform.position.x).toBe(3);
      expect(body.transform.position.y).toBe(2);
    } finally {
      harness.dispose();
    }
  });

  it("answers a query without a step, even before the first frame", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      expect(hitBelow(harness, 0)).toBe("Floor");
      harness.stepMany(3);
      expect(hitBelow(harness, 9)).toBe("Floor");
      expect(hitBelow(harness, 11)).toBeNull();
      const counters = harness.app.diagnostics.group("physics2d");
      expect(counters?.get(counters.index("bodies"))).toBe(1);
      expect(counters?.get(counters.index("stepsThisFrame"))).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("follows a transform the editor moves, rotates, or scales", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      const plank = harness.world.createEntity("Plank");
      plank.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      plank.addComponent(Rigidbody2D);
      harness.step();
      expect(hitBelow(harness, 0)).toBe("Plank");

      plank.transform.position = { x: 5, y: 0, z: 0 };
      // No frame in between: the query brings the body along itself.
      expect(hitBelow(harness, 0)).toBeNull();
      expect(hitBelow(harness, 5)).toBe("Plank");

      plank.transform.localScale.set(6, 1, 1);
      harness.step();
      expect(hitBelow(harness, 7.5)).toBe("Plank");
      expect(hitBelow(harness, 2.5)).toBe("Plank");

      plank.transform.rotation2D = 90;
      harness.step();
      expect(hitBelow(harness, 7.5)).toBeNull();
      expect(hitBelow(harness, 5)).toBe("Plank");
      // Never simulated: the dynamic body did not fall while it was re-placed.
      expect(plank.transform.position.y).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("rebuilds for collider and tile changes and removes the body with its entity", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      const pad = harness.world.createEntity("Pad");
      const box = pad.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      harness.step();
      expect(hitBelow(harness, 2)).toBeNull();
      box.size = { x: 6, y: 1 };
      box.rebuild();
      harness.step();
      expect(hitBelow(harness, 2)).toBe("Pad");
      pad.destroy();
      harness.step();
      expect(hitBelow(harness, 0)).toBeNull();

      const map = harness.world.createEntity("Map");
      const tiles = map.addComponent(TilemapCollider2D);
      tiles.collisionData = {
        cellSize: 1,
        chunkSize: 8,
        version: 1,
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
            oneWayEdges: [],
          },
        ],
      };
      harness.step();
      expect(hitBelow(harness, 3)).toBe("Map");
    } finally {
      harness.dispose();
    }
  });

  it("fires no collision or trigger callback, even for overlapping bodies and an opted-in script", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider2D, { size: { x: 10, y: 1 } });
      const floorProbe = floor.addComponent(PhysicsProbe2D);
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 0.25, z: 0 };
      ball.addComponent(CircleCollider2D, { radius: 0.5 });
      ball.addComponent(Rigidbody2D, { collisionEvents: "on" });
      const ballProbe = ball.addComponent(PhysicsProbe2D);
      const zone = harness.world.createEntity("Zone");
      zone.addComponent(BoxCollider2D, { size: { x: 3, y: 3 }, isTrigger: true });
      const zoneProbe = zone.addComponent(PhysicsProbe2D);
      harness.stepMany(30);
      ball.transform.position = { x: 1, y: 0.25, z: 0 };
      harness.stepMany(30);
      expect(floorProbe.calls).toEqual([]);
      expect(ballProbe.calls).toEqual([]);
      expect(zoneProbe.calls).toEqual([]);
      expect(ball.transform.position.y).toBe(0.25);
      expect(harness.app.physics2d.overlapCircle({ x: 1, y: 0.25 }, 0.1)).toContain(ball);
    } finally {
      harness.dispose();
    }
  });

  it("leaves a game app as it was: a query before the first step is still refused", async () => {
    const harness = await createPhysics2DApp();
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      expect(() => hitBelow(harness, 0)).toThrow(/IGX-1153/u);
      harness.step();
      expect(hitBelow(harness, 0)).toBe("Floor");
    } finally {
      harness.dispose();
    }
  });
});
