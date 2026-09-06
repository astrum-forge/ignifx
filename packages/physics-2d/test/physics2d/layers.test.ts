import { describe, expect, it } from "vitest";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp } from "../support/harness.js";

/**
 * The collision matrix in 2D (`docs/architecture/09-physics.md` §3, `11-2d-toolkit.md` §8).
 *
 * ## The one 2D-only limit
 *
 * Rapier packs membership and filter into **16 bits each** (`geometry/interaction_groups.d.ts`),
 * so only the project's first sixteen layers can be filtered by. A collider on layer 16 or above
 * reports `IGX-1152` and falls back to layer 0.
 */

/** A project with a handful of named layers. */
const LAYERED = {
  layers: { layers: ["Default", "Player", "Enemy", "Ghost"] },
  physics2d: { collisionMatrix: { Ghost: [] as string[] } },
};

describe("2D layer matrix", () => {
  it("lets a layer that the matrix does not mention collide with everything", async () => {
    const harness = await createPhysics2DApp({ settings: LAYERED });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

      const box = harness.world.createEntity("Box");
      box.layer = harness.world.layers.indexOf("Player");
      box.transform.position = { x: 0, y: 3, z: 0 };
      box.addComponent(BoxCollider2D);
      box.addComponent(Rigidbody2D, { interpolation: "none" });

      harness.stepMany(180);
      expect(box.transform.position.y).toBeCloseTo(0.5, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("lets a layer that collides with nothing fall straight through", async () => {
    const harness = await createPhysics2DApp({ settings: LAYERED });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

      const ghost = harness.world.createEntity("Ghost");
      ghost.layer = harness.world.layers.indexOf("Ghost");
      ghost.transform.position = { x: 0, y: 3, z: 0 };
      ghost.addComponent(BoxCollider2D);
      ghost.addComponent(Rigidbody2D, { interpolation: "none" });

      harness.stepMany(120);
      expect(ghost.transform.position.y).toBeLessThan(-1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("applies a collider's layerOverride instead of the entity's layer", async () => {
    const harness = await createPhysics2DApp({ settings: LAYERED });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 3, z: 0 };
      box.addComponent(BoxCollider2D, { layerOverride: "Ghost" });
      box.addComponent(Rigidbody2D, { interpolation: "none" });

      harness.stepMany(120);
      expect(box.transform.position.y).toBeLessThan(-1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("reports IGX-1152 and falls back to layer 0 above Rapier's sixteen", async () => {
    const layers: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      layers.push(index === 0 ? "Default" : `Layer${String(index)}`);
    }
    const harness = await createPhysics2DApp({ settings: { layers: { layers } } });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

      const box = harness.world.createEntity("Box");
      box.layer = 17;
      box.transform.position = { x: 0, y: 3, z: 0 };
      box.addComponent(BoxCollider2D);
      box.addComponent(Rigidbody2D, { interpolation: "none" });

      harness.stepMany(180);
      expect(harness.sink.toArray().some((record) => record.message.includes("IGX-1152"))).toBe(true);
      // Layer 0 collides with everything, so the fallback still lands on the floor.
      expect(box.transform.position.y).toBeCloseTo(0.5, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("refuses a collision matrix that names an undeclared layer", async () => {
    await expect(
      createPhysics2DApp({ settings: { physics2d: { collisionMatrix: { Nope: [] as string[] } } } }),
    ).rejects.toThrow(/IGX-1155/u);
  });
});
