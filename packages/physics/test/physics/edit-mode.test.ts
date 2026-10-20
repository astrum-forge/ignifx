import { Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController } from "../../src/components/character-controller.js";
import { BoxCollider, SphereCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { createPhysicsApp } from "../support/harness.js";
import type { PhysicsAppHarness } from "../support/harness.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * `@ignifx/physics` in an edit-mode app (ADR-0028 and its amendment of 2026-10-20): bodies exist
 * and follow the scene, so queries answer, but nothing steps. Nothing falls, no collision or
 * trigger callback fires, and no simulated pose overwrites a transform the editor moves.
 */

/** A frame delta that is not a whole number of fixed steps, so a game app would interpolate. */
const IRREGULAR_DELTA = 1 / 40;

/** Straight down. */
const DOWN = { x: 0, y: -1, z: 0 };

/** Counts every physics callback, and opts in to edit mode so the gate would let them through. */
class PhysicsProbe extends Script implements ScriptCallbacks {
  static typeId = "test/EditModePhysicsProbe";

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
 * Casts a ray straight down from 10 m above a point on the ground plane.
 *
 * @param harness - The harness.
 * @param x - The world X.
 * @param z - The world Z.
 * @returns The entity name hit, or `null`.
 */
function hitBelow(harness: PhysicsAppHarness, x: number, z: number): string | null {
  return harness.app.physics.raycast({ x, y: 10, z }, DOWN, 20)?.entity.name ?? null;
}

describe("physics in an edit-mode app", () => {
  it("does not step: a dynamic body stays where it was authored", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 10, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { mass: 1 });
      harness.stepMany(30);
      expect(box.transform.position.y).toBe(10);
      expect(harness.app.diagnostics.frame.fixedSteps).toBe(0);
      expect(harness.app.physics.hasStepped).toBe(false);
      // The body exists all the same.
      expect(harness.app.physics.raycast({ x: 0, y: 20, z: 0 }, DOWN, 20)?.entity).toBe(box);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("leaves a transform the editor moved alone, with interpolation on", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const box = harness.world.createEntity("Box");
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "interpolate" });
      harness.stepMany(5, IRREGULAR_DELTA);
      box.transform.position = { x: 3, y: 2, z: 1 };
      harness.stepMany(5, IRREGULAR_DELTA);
      expect(box.transform.position.x).toBe(3);
      expect(box.transform.position.y).toBe(2);
      expect(box.transform.position.z).toBe(1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("answers a query without a step, even before the first frame", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      expect(hitBelow(harness, 0, 0)).toBe("Floor");
      harness.stepMany(3);
      expect(hitBelow(harness, 4, 4)).toBe("Floor");
      expect(hitBelow(harness, 6, 0)).toBeNull();
      const counters = harness.app.diagnostics.group("physics");
      expect(counters?.get(counters.index("bodies"))).toBe(1);
      expect(counters?.get(counters.index("stepsThisFrame"))).toBe(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("follows a transform the editor moves, rotates, or scales", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const wall = harness.world.createEntity("Wall");
      wall.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
      wall.addComponent(Rigidbody, { mass: 1 });
      harness.step();
      expect(hitBelow(harness, 0, 0)).toBe("Wall");

      wall.transform.position = { x: 5, y: 0, z: 0 };
      // No frame in between: the query brings the body along itself.
      expect(hitBelow(harness, 0, 0)).toBeNull();
      expect(hitBelow(harness, 5, 0)).toBe("Wall");

      harness.step();
      wall.transform.localScale.set(6, 1, 1);
      harness.step();
      expect(hitBelow(harness, 7.5, 0)).toBe("Wall");
      expect(hitBelow(harness, 2.5, 0)).toBe("Wall");

      wall.transform.eulerAngles = { x: 0, y: 90, z: 0 };
      harness.step();
      expect(hitBelow(harness, 7.5, 0)).toBeNull();
      expect(hitBelow(harness, 5, 2.5)).toBe("Wall");
      // Never simulated: the dynamic body did not fall while it was re-placed.
      expect(wall.transform.position.y).toBe(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("rebuilds a body when its colliders change and removes it with its entity", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const pad = harness.world.createEntity("Pad");
      const box = pad.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
      harness.step();
      expect(hitBelow(harness, 2, 0)).toBeNull();

      box.size = { x: 6, y: 1, z: 1 };
      box.rebuild();
      harness.step();
      expect(hitBelow(harness, 2, 0)).toBe("Pad");

      box.enabled = false;
      pad.removeComponent(box);
      harness.step();
      expect(hitBelow(harness, 0, 0)).toBeNull();

      pad.addComponent(SphereCollider, { radius: 1 });
      harness.step();
      expect(hitBelow(harness, 0, 0)).toBe("Pad");

      pad.destroy();
      harness.step();
      expect(hitBelow(harness, 0, 0)).toBeNull();
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("fires no collision or trigger callback, even for overlapping bodies and an opted-in script", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      const floorProbe = floor.addComponent(PhysicsProbe);
      const crate = harness.world.createEntity("Crate");
      crate.transform.position = { x: 0, y: 0.25, z: 0 };
      crate.addComponent(BoxCollider);
      crate.addComponent(Rigidbody, { mass: 1, collisionEvents: "on" });
      const crateProbe = crate.addComponent(PhysicsProbe);
      const zone = harness.world.createEntity("Zone");
      zone.addComponent(BoxCollider, { size: { x: 3, y: 3, z: 3 }, isTrigger: true });
      zone.addComponent(Rigidbody, { bodyType: "kinematic" });
      const zoneProbe = zone.addComponent(PhysicsProbe);
      harness.stepMany(30);
      crate.transform.position = { x: 1, y: 0.25, z: 0 };
      harness.stepMany(30);
      expect(floorProbe.calls).toEqual([]);
      expect(crateProbe.calls).toEqual([]);
      expect(zoneProbe.calls).toEqual([]);
      expect(crate.transform.position.y).toBe(0.25);
      expect(crate.getComponent(Rigidbody)?.linearVelocity.y).toBe(0);
      expect(harness.app.physics.overlap({ kind: "sphere", radius: 0.1 }, { x: 1, y: 0.25, z: 0 })).toContain(crate);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("keeps a character controller's capsule on the entity the editor moves", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const hero = harness.world.createEntity("Hero");
      hero.transform.position = { x: 0, y: 1, z: 0 };
      hero.addComponent(CharacterController, { height: 2, radius: 0.5 });
      harness.step();
      expect(hitBelow(harness, 0, 0)).toBe("Hero");
      hero.transform.position = { x: 4, y: 1, z: 0 };
      harness.stepMany(5);
      expect(hitBelow(harness, 0, 0)).toBeNull();
      expect(hitBelow(harness, 4, 0)).toBe("Hero");
      expect(hero.transform.position.y).toBe(1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("builds every other body when one collider cannot be built, and reports it once", async () => {
    const harness = await createPhysicsApp({ editMode: true });
    try {
      const reports: unknown[] = [];
      harness.app.onError.connect((report) => {
        if (report.entity?.name === "Broken") {
          reports.push(report.error);
        }
      });
      const broken = harness.world.createEntity("Broken");
      broken.transform.position = { x: -3, y: 0, z: 0 };
      const bad = broken.addComponent(BoxCollider, { layerOverride: "nope" });
      harness.world.createEntity("Fine").addComponent(BoxCollider);
      // The query builds the bodies itself, and does not throw for the broken one.
      expect(hitBelow(harness, 0, 0)).toBe("Fine");
      harness.stepMany(5);
      expect(hitBelow(harness, -3, 0)).toBeNull();
      expect(reports).toHaveLength(1);
      expect(String(reports[0])).toMatch(/IGX-0905/u);

      bad.layerOverride = "";
      bad.onValidate(["layerOverride"]);
      expect(hitBelow(harness, -3, 0)).toBe("Broken");
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("leaves a game app as it was: a query before the first step is still refused", async () => {
    const harness = await createPhysicsApp();
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      expect(() => hitBelow(harness, 0, 0)).toThrow(/IGX-0902/u);
      harness.step();
      expect(hitBelow(harness, 0, 0)).toBe("Floor");
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
