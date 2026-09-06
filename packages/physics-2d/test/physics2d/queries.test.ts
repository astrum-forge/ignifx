import { LayerMask } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider2D, CircleCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp } from "../support/harness.js";

/**
 * `app.physics2d` queries (`docs/architecture/11-2d-toolkit.md` §8, `09-physics.md` §5).
 *
 * Every 2D query carries the collider it hit, because Rapier's query pipeline returns the
 * `Collider` (`pipeline/world.d.ts`) — there is no bounds-index approximation as in 3D.
 */

describe("2D queries", () => {
  it("refuses to run before the first fixed step", async () => {
    const harness = await createPhysics2DApp();
    try {
      expect(() => harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 })).toThrow(/IGX-1153/u);
    } finally {
      harness.dispose();
    }
  });

  it("raycasts to the nearest collider and reports its entity, point, and normal", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      harness.step();

      const hit = harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20);
      expect(hit?.entity.name).toBe("Floor");
      expect(hit?.collider).toBeInstanceOf(BoxCollider2D);
      expect(hit?.distance).toBeCloseTo(5, 2);
      expect(hit?.point.y).toBeCloseTo(0, 2);
      expect(hit?.normal.y).toBeCloseTo(1, 2);
    } finally {
      harness.dispose();
    }
  });

  it("returns null for a ray that hits nothing and for a zero direction", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 2, y: 1 } });
      harness.step();
      expect(harness.app.physics2d.raycast({ x: 50, y: 5 }, { x: 0, y: -1 }, 20)).toBeNull();
      expect(harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: 0 })).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("lists every collider along a ray, nearest first", async () => {
    const harness = await createPhysics2DApp();
    try {
      for (let index = 0; index < 3; index += 1) {
        const wall = harness.world.createEntity(`Wall${String(index)}`);
        wall.transform.position = { x: 0, y: -index * 2, z: 0 };
        wall.addComponent(BoxCollider2D, { size: { x: 4, y: 0.2 } });
      }
      harness.step();
      const hits = harness.app.physics2d.raycastAll({ x: 0, y: 5 }, { x: 0, y: -1 }, 20);
      expect(hits.map((hit) => hit.entity.name)).toEqual(["Wall0", "Wall1", "Wall2"]);
      expect(hits[0]?.distance).toBeLessThan(hits[1]?.distance ?? 0);
    } finally {
      harness.dispose();
    }
  });

  it("skips triggers unless the caller asks for them", async () => {
    const harness = await createPhysics2DApp();
    try {
      const zone = harness.world.createEntity("Zone");
      zone.addComponent(BoxCollider2D, { size: { x: 4, y: 1 }, isTrigger: true });
      harness.step();
      expect(harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20)).toBeNull();
      expect(
        harness.app.physics2d.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20, { hitTriggers: true })?.entity.name,
      ).toBe("Zone");
    } finally {
      harness.dispose();
    }
  });

  it("honours a layer mask", async () => {
    const harness = await createPhysics2DApp({ settings: { layers: { layers: ["Default", "Player"] } } });
    try {
      const wall = harness.world.createEntity("Wall");
      wall.layer = harness.world.layers.indexOf("Player");
      wall.addComponent(BoxCollider2D, { size: { x: 4, y: 1 } });
      harness.step();
      const service = harness.app.physics2d;
      expect(service.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20)?.entity.name).toBe("Wall");
      const defaultOnly = LayerMask.of(0);
      expect(service.raycast({ x: 0, y: 5 }, { x: 0, y: -1 }, 20, { layerMask: defaultOnly })).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("lists the entities a circle and a box overlap", async () => {
    const harness = await createPhysics2DApp();
    try {
      const left = harness.world.createEntity("Left");
      left.transform.position = { x: -1, y: 0, z: 0 };
      left.addComponent(CircleCollider2D, { radius: 0.5 });
      const right = harness.world.createEntity("Right");
      right.transform.position = { x: 4, y: 0, z: 0 };
      right.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      harness.step();

      const service = harness.app.physics2d;
      expect([...service.overlapCircle({ x: -1, y: 0 }, 0.6)].map((entity) => entity.name)).toEqual(["Left"]);
      expect([...service.overlapBox({ x: 4, y: 0 }, { x: 2, y: 2 })].map((entity) => entity.name)).toEqual(["Right"]);
      expect([...service.overlapCircle({ x: 20, y: 0 }, 0.5)]).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("sweeps a circle and reports the first contact", async () => {
    const harness = await createPhysics2DApp();
    try {
      const wall = harness.world.createEntity("Wall");
      wall.transform.position = { x: 5, y: 0, z: 0 };
      wall.addComponent(BoxCollider2D, { size: { x: 1, y: 4 } });
      harness.step();

      const hit = harness.app.physics2d.shapeCast({ x: 0, y: 0 }, 0.5, { x: 1, y: 0 }, 20);
      expect(hit?.entity.name).toBe("Wall");
      // The circle's surface meets the wall's left face at x = 4.5, so its centre travels 4.
      expect(hit?.distance).toBeCloseTo(4, 1);
      expect(hit?.fraction).toBeCloseTo(0.2, 1);
      expect(harness.app.physics2d.shapeCast({ x: 0, y: 0 }, 0.5, { x: -1, y: 0 }, 20)).toBeNull();
      expect(harness.app.physics2d.shapeCast({ x: 0, y: 0 }, 0.5, { x: 0, y: 0 }, 20)).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("counts queries and bodies in the physics2d diagnostics group", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider2D, { size: { x: 4, y: 1 } });
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 4, z: 0 };
      ball.addComponent(CircleCollider2D);
      ball.addComponent(Rigidbody2D);
      harness.stepMany(3);
      const group = harness.app.diagnostics.group("physics2d");
      expect(group?.get(group.index("bodies"))).toBe(2);
      expect(group?.get(group.index("colliders"))).toBe(2);
      expect(group?.get(group.index("stepsThisFrame"))).toBe(1);
      expect(group?.get(group.index("stepMs"))).toBeGreaterThanOrEqual(0);
    } finally {
      harness.dispose();
    }
  });
});
