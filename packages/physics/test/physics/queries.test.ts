import { LayerMask } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider, SphereCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { PhysicsErrorCode } from "../../src/errors.js";
import { createPhysicsApp } from "../support/harness.js";

/**
 * `app.physics` queries (`docs/architecture/09-physics.md` §5), including the two corrections §5
 * needs: `shapeCast` and `overlap` resolve entities against the extension's body-bounds index,
 * because `@babylonjs/lite@1.27.0` reports a body for `physicsRaycast` only.
 */

describe("raycast", () => {
  it("refuses to answer before the first fixed step", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      let code: string | null = null;
      try {
        harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
      } catch (error: unknown) {
        code = (error as { code?: string }).code ?? null;
      }
      // Havok builds its broadphase in the first step (`index.d.ts` 8570).
      expect(code).toBe(PhysicsErrorCode.queryBeforeStep);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("hits the right entity at the right point with the right normal", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      harness.stepMany(2);

      const hit = harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
      expect(hit?.entity.name).toBe("Floor");
      expect(hit?.point.y).toBeCloseTo(0.5, 3);
      expect(hit?.normal.y).toBeCloseTo(1, 3);
      expect(hit?.distance).toBeCloseTo(4.5, 3);
      // A primitive shape reports no triangle (`RaycastResult.triangleIndex`, 9386).
      expect(hit?.triangleIndex).toBe(-1);
      expect(hit?.collider).toBe(floor.getComponent(BoxCollider));
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("returns null when the ray clears everything, and respects the layer mask", async () => {
    const harness = await createPhysicsApp({ settings: { layers: ["Default", "Ground"] } });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.layer = harness.world.layers.requireIndex("Ground");
      floor.addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      harness.stepMany(2);

      expect(harness.app.physics.raycast({ x: 50, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10)).toBeNull();
      const masked = harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10, {
        layerMask: LayerMask.fromNames(harness.world.layers, ["Default"]),
      });
      expect(masked).toBeNull();
      const allowed = harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10, {
        layerMask: LayerMask.fromNames(harness.world.layers, ["Ground"]),
      });
      expect(allowed?.entity.name).toBe("Floor");
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("ignores a zero-length direction", async () => {
    const harness = await createPhysicsApp();
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      harness.stepMany(2);
      expect(harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 })).toBeNull();
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("overlap", () => {
  it("lists the entities whose bounds the query shape touches", async () => {
    const harness = await createPhysicsApp();
    try {
      const near = harness.world.createEntity("Near");
      near.transform.position = { x: 0, y: 0, z: 0 };
      near.addComponent(SphereCollider, { radius: 0.5 });

      const far = harness.world.createEntity("Far");
      far.transform.position = { x: 20, y: 0, z: 0 };
      far.addComponent(SphereCollider, { radius: 0.5 });

      const trigger = harness.world.createEntity("Trigger");
      trigger.transform.position = { x: 0.5, y: 0, z: 0 };
      trigger.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 }, isTrigger: true });

      harness.stepMany(2);

      const solids = [...harness.app.physics.overlap({ kind: "sphere", radius: 1 }, { x: 0, y: 0, z: 0 })];
      expect(solids.map((entity) => entity.name)).toEqual(["Near"]);

      const withTriggers = [
        ...harness.app.physics.overlap({ kind: "sphere", radius: 1 }, { x: 0, y: 0, z: 0 }, undefined, {
          hitTriggers: true,
        }),
      ];
      expect(new Set(withTriggers.map((entity) => entity.name))).toEqual(new Set(["Near", "Trigger"]));

      const empty = [
        ...harness.app.physics.overlap({ kind: "box", size: { x: 1, y: 1, z: 1 } }, { x: 50, y: 0, z: 0 }),
      ];
      expect(empty).toEqual([]);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("shapeCast", () => {
  it("reports the sweep contact and resolves the entity it hit", async () => {
    const harness = await createPhysicsApp();
    try {
      const wall = harness.world.createEntity("Wall");
      wall.transform.position = { x: 0, y: 0, z: 0 };
      wall.addComponent(BoxCollider, { size: { x: 1, y: 4, z: 4 } });
      harness.stepMany(2);

      const hit = harness.app.physics.shapeCast(
        { kind: "sphere", radius: 0.25 },
        { x: -5, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      );
      expect(hit).not.toBeNull();
      expect(hit?.fraction).toBeGreaterThan(0);
      expect(hit?.fraction).toBeLessThan(1);
      expect(hit?.entity?.name).toBe("Wall");
      expect(hit?.point.x).toBeCloseTo(-0.5, 2);
      expect(hit?.distance).toBeGreaterThan(3);

      expect(
        harness.app.physics.shapeCast(
          { kind: "capsule", radius: 0.25, height: 1 },
          { x: 0, y: 40, z: 0 },
          { x: 5, y: 40, z: 0 },
        ),
      ).toBeNull();
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("answers the one thing shapeProximity reports exactly: a distance", async () => {
    const harness = await createPhysicsApp();
    try {
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 0, z: 0 };
      ball.addComponent(SphereCollider, { radius: 1 });
      harness.stepMany(2);

      const distance = harness.app.physics.distanceToNearest({ kind: "sphere", radius: 0.5 }, { x: 4, y: 0, z: 0 }, 10);
      expect(distance).toBeGreaterThan(2);
      expect(distance).toBeLessThan(3);
      expect(harness.app.physics.distanceToNearest({ kind: "sphere", radius: 0.5 }, { x: 40, y: 0, z: 0 }, 1)).toBe(
        Number.POSITIVE_INFINITY,
      );
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("diagnostics", () => {
  it("counts queries, bodies, and steps in the physics group", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 4, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(2);

      harness.app.physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
      harness.step();

      const group = harness.app.diagnostics.group("physics");
      expect(group).not.toBeNull();
      expect(group?.get(group.index("bodies"))).toBe(2);
      expect(group?.get(group.index("activeBodies"))).toBe(1);
      expect(group?.get(group.index("stepsThisFrame"))).toBe(1);
      expect(group?.get(group.index("queries"))).toBe(1);
      expect(group?.get(group.index("stepMs"))).toBeGreaterThanOrEqual(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
