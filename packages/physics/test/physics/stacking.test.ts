import { describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { createPhysicsApp } from "../support/harness.js";

/**
 * Exit criterion 2 of Phase 4: a stacking-stability scene. Five unit boxes are dropped into a stack
 * on a static floor and stepped for 600 fixed steps; the stack must come to rest and stay there.
 */

describe("stacking stability", () => {
  it("keeps a five-box stack at rest over 600 steps", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });

      const boxes = [];
      for (let index = 0; index < 5; index += 1) {
        const box = harness.world.createEntity(`Box${String(index)}`);
        // Each box starts a hair above its resting height so the stack settles rather than
        // starting interpenetrated.
        box.transform.position = { x: 0, y: 1 + index * 1.01, z: 0 };
        box.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
        box.addComponent(Rigidbody, { mass: 1, interpolation: "none" });
        boxes.push(box);
      }

      harness.stepMany(300);
      const settled = boxes.map((box) => box.transform.position.y);
      harness.stepMany(300);
      const after = boxes.map((box) => box.transform.position.y);

      for (let index = 0; index < boxes.length; index += 1) {
        // Within 1 mm of where it was 300 steps earlier: the stack is at rest, not creeping.
        expect(Math.abs((after[index] ?? 0) - (settled[index] ?? 0))).toBeLessThan(0.001);
      }
      // The top box rests near y = 5: the floor's top at 0.5 plus five half-metre half-heights
      // (1, 2, 3, 4, 5). Havok allows a few millimetres of contact penetration, hence the window.
      expect(after[4]).toBeGreaterThan(4.95);
      expect(after[4]).toBeLessThan(5.05);
      // Still stacked in order rather than scattered.
      for (let index = 1; index < boxes.length; index += 1) {
        expect(after[index]).toBeGreaterThan(after[index - 1] ?? 0);
      }
    } finally {
      harness.dispose();
    }
  }, 60_000);
});
