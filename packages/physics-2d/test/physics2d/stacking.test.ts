import { describe, expect, it } from "vitest";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp } from "../support/harness.js";

/**
 * A stack of boxes settles and stays settled — the standard "is the solver actually solving?" test
 * (`docs/architecture/09-physics.md` §8, mirrored in 2D).
 */

/** How many boxes the tower holds. */
const BOX_COUNT = 5;

describe("2D stacking", () => {
  it("settles five boxes into a tower that stays put", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

      const boxes = [];
      for (let index = 0; index < BOX_COUNT; index += 1) {
        const box = harness.world.createEntity(`Box${String(index)}`);
        box.transform.position = { x: 0, y: 0.5 + index * 1.05, z: 0 };
        box.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
        box.addComponent(Rigidbody2D, { interpolation: "none" });
        boxes.push(box);
      }

      harness.stepMany(600);

      for (let index = 0; index < BOX_COUNT; index += 1) {
        const box = boxes[index];
        expect(box).toBeDefined();
        // Each box rests on the one below, within a couple of centimetres of penetration slop.
        expect(box?.transform.position.y ?? 0).toBeGreaterThan(0.5 + index - 0.05);
        expect(box?.transform.position.y ?? 0).toBeLessThan(0.5 + index + 0.05);
        expect(Math.abs(box?.transform.position.x ?? 1)).toBeLessThan(0.1);
      }
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
