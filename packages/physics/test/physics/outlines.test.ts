import { describe, expect, it } from "vitest";
import {
  BoxCollider,
  CapsuleCollider,
  CylinderCollider,
  HeightfieldCollider,
  MeshCollider,
  SphereCollider,
} from "../../src/components/colliders.js";
import { OUTLINE_CIRCLE_SEGMENTS } from "../../src/runtime/outline.js";
import { createPhysicsApp } from "../support/harness.js";

/**
 * `app.physics.colliderOutlines` (ADR-0028, amendment of 2026-10-20): the world-space line segments
 * an editor draws as collider gizmos.
 */

/** Floats per segment: two ends of three coordinates. */
const SEGMENT = 6;

/**
 * The bounding box of an outline's points.
 *
 * @param lines - The segments.
 * @returns `[minX, minY, minZ, maxX, maxY, maxZ]`.
 */
function boundsOf(lines: Float32Array): number[] {
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let index = 0; index < lines.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = lines[index + axis] ?? 0;
      bounds[axis] = Math.min(bounds[axis] ?? 0, value);
      bounds[axis + 3] = Math.max(bounds[axis + 3] ?? 0, value);
    }
  }
  return bounds;
}

/**
 * Asserts two bounds agree to five decimal places.
 *
 * @param actual - The measured bounds.
 * @param expected - The expected bounds.
 */
function expectBounds(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index], `bound ${String(index)}`).toBeCloseTo(expected[index] ?? 0, 5);
  }
}

describe("colliderOutlines", () => {
  it("outlines a box in world space with the entity's pose and scale, before any step", async () => {
    const harness = await createPhysicsApp();
    try {
      const crate = harness.world.createEntity("Crate");
      crate.transform.position = { x: 10, y: 2, z: -3 };
      crate.transform.localScale.set(2, 1, 1);
      const box = crate.addComponent(BoxCollider, { size: { x: 1, y: 2, z: 4 }, center: { x: 0.5, y: 0, z: 0 } });
      const [outline, ...rest] = harness.app.physics.colliderOutlines(crate);
      expect(rest).toEqual([]);
      expect(outline?.collider).toBe(box);
      expect(outline?.isTrigger).toBe(false);
      expect(outline?.lines.length).toBe(12 * SEGMENT);
      expectBounds(boundsOf(outline?.lines ?? new Float32Array()), [10, 1, -5, 12, 3, -1]);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("rotates the outline with the entity", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const plank = harness.world.createEntity("Plank");
      plank.transform.eulerAngles = { x: 0, y: 90, z: 0 };
      plank.addComponent(BoxCollider, { size: { x: 4, y: 1, z: 1 } });
      const lines = harness.app.physics.colliderOutlines(plank)[0]?.lines ?? new Float32Array();
      expectBounds(boundsOf(lines), [-0.5, -0.5, -2, 0.5, 0.5, 2]);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("outlines a sphere, a capsule, and a cylinder by circles, and marks a trigger", async () => {
    const harness = await createPhysicsApp();
    try {
      const thing = harness.world.createEntity("Thing");
      thing.addComponent(SphereCollider, { radius: 1, isTrigger: true });
      thing.addComponent(CapsuleCollider, { radius: 0.5, height: 3, direction: "x", center: { x: 0, y: 5, z: 0 } });
      thing.addComponent(CylinderCollider, { radius: 2, height: 1, center: { x: 0, y: -5, z: 0 } });
      const [sphere, capsule, cylinder] = harness.app.physics.colliderOutlines(thing);
      expect(sphere?.isTrigger).toBe(true);
      expect(sphere?.lines.length).toBe(3 * OUTLINE_CIRCLE_SEGMENTS * SEGMENT);
      expectBounds(boundsOf(sphere?.lines ?? new Float32Array()), [-1, -1, -1, 1, 1, 1]);
      expect(capsule?.isTrigger).toBe(false);
      expectBounds(boundsOf(capsule?.lines ?? new Float32Array()), [-1.5, 4.5, -0.5, 1.5, 5.5, 0.5]);
      expectBounds(boundsOf(cylinder?.lines ?? new Float32Array()), [-2, -5.5, -2, 2, -4.5, 2]);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("outlines a heightfield by the box of its samples, a mesh collider by nothing", async () => {
    const harness = await createPhysicsApp();
    try {
      const ground = harness.world.createEntity("Ground");
      ground.addComponent(HeightfieldCollider, {
        heights: [0, 1, 2, 3],
        samplesX: 2,
        samplesZ: 2,
        size: { x: 8, y: 1, z: 6 },
      });
      const [field] = harness.app.physics.colliderOutlines(ground);
      expectBounds(boundsOf(field?.lines ?? new Float32Array()), [-4, 0, -3, 4, 3, 3]);

      const statue = harness.world.createEntity("Statue");
      statue.addComponent(MeshCollider);
      const [mesh] = harness.app.physics.colliderOutlines(statue);
      expect(mesh?.lines.length).toBe(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("leaves out disabled colliders and answers nothing for an entity without one", async () => {
    const harness = await createPhysicsApp();
    try {
      const thing = harness.world.createEntity("Thing");
      expect(harness.app.physics.colliderOutlines(thing)).toEqual([]);
      thing.addComponent(BoxCollider).enabled = false;
      expect(harness.app.physics.colliderOutlines(thing)).toEqual([]);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
