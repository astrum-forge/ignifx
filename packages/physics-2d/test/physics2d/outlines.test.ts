import { describe, expect, it } from "vitest";
import { BoxCollider2D, CircleCollider2D } from "../../src/components/colliders.js";
import { CharacterController2D } from "../../src/components/character-controller.js";
import { createPhysics2DApp } from "../support/harness.js";

/**
 * `app.physics2d.colliderOutlines` (ADR-0028, amendment of 2026-10-20): Rapier's own drawing of an
 * entity's colliders, as the world-space segments an editor draws as collider gizmos.
 */

/** Floats per segment: two ends of two coordinates. */
const SEGMENT = 4;

/**
 * The bounding box of an outline's points.
 *
 * @param lines - The segments.
 * @returns `[minX, minY, maxX, maxY]`.
 */
function boundsOf(lines: Float32Array): number[] {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let index = 0; index < lines.length; index += 2) {
    for (let axis = 0; axis < 2; axis += 1) {
      const value = lines[index + axis] ?? 0;
      bounds[axis] = Math.min(bounds[axis] ?? 0, value);
      bounds[axis + 2] = Math.max(bounds[axis + 2] ?? 0, value);
    }
  }
  return bounds;
}

/**
 * Asserts two bounds agree to four decimal places.
 *
 * @param actual - The measured bounds.
 * @param expected - The expected bounds.
 */
function expectBounds(actual: readonly number[], expected: readonly number[]): void {
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index], `bound ${String(index)}`).toBeCloseTo(expected[index] ?? 0, 4);
  }
}

describe("colliderOutlines in 2D", () => {
  it("outlines each collider in world space, in an edit-mode app, and follows a move", async () => {
    const harness = await createPhysics2DApp({ editMode: true });
    try {
      const thing = harness.world.createEntity("Thing");
      thing.transform.position = { x: 4, y: 2, z: 0 };
      const box = thing.addComponent(BoxCollider2D, { size: { x: 2, y: 1 } });
      const circle = thing.addComponent(CircleCollider2D, { radius: 0.5, isTrigger: true });
      const [boxOutline, circleOutline, ...rest] = harness.app.physics2d.colliderOutlines(thing);
      expect(rest).toEqual([]);
      expect(boxOutline?.collider).toBe(box);
      expect(boxOutline?.isTrigger).toBe(false);
      expect(boxOutline?.lines.length).toBe(4 * SEGMENT);
      expectBounds(boundsOf(boxOutline?.lines ?? new Float32Array()), [3, 1.5, 5, 2.5]);
      expect(circleOutline?.collider).toBe(circle);
      expect(circleOutline?.isTrigger).toBe(true);
      expectBounds(boundsOf(circleOutline?.lines ?? new Float32Array()), [3.5, 1.5, 4.5, 2.5]);

      thing.transform.position = { x: -4, y: 0, z: 0 };
      const [moved] = harness.app.physics2d.colliderOutlines(thing);
      expectBounds(boundsOf(moved?.lines ?? new Float32Array()), [-5, -0.5, -3, 0.5]);
      // Never simulated: outlining did not step anything.
      expect(harness.app.diagnostics.frame.fixedSteps).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("outlines a game app's colliders once its body exists, and leaves out a controller's own shape", async () => {
    const harness = await createPhysics2DApp();
    try {
      const hero = harness.world.createEntity("Hero");
      hero.addComponent(CharacterController2D, { interpolation: "none" });
      const crate = harness.world.createEntity("Crate");
      crate.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
      expect(harness.app.physics2d.colliderOutlines(crate)).toEqual([]);
      harness.step();
      expect(harness.app.physics2d.colliderOutlines(crate)).toHaveLength(1);
      expect(harness.app.physics2d.colliderOutlines(hero)).toEqual([]);
    } finally {
      harness.dispose();
    }
  });
});
