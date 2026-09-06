import { Camera } from "@ignifx/core";
import { BoxCollider, Rigidbody } from "@ignifx/physics";
import { describe, expect, it } from "vitest";
import { ThirdPersonCamera } from "../../src/camera/third-person-camera.js";
import { createThreeDApp } from "../support/harness.js";
import type { ThreeDAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * The `ThirdPersonCamera` collision test that `docs/plan/engineering-plan.md` names as a Phase 7
 * exit criterion: headless, with a wall between the target and the camera, the boom shrinks; with
 * the wall gone, it eases back out.
 *
 * Physics runs on the real Havok backend under the null engine, so the sweep is the same code the
 * browser runs.
 */

/**
 * Builds a rig: a target at the origin and a camera behind it.
 *
 * @param harness - The app harness.
 * @returns The target, the camera entity, and the rig.
 */
function buildRig(harness: ThreeDAppHarness): { target: Entity; rig: ThirdPersonCamera } {
  const target = harness.world.createEntity("Hero");
  const cameraEntity = harness.world.createEntity("Camera");
  cameraEntity.addComponent(Camera);
  const rig = cameraEntity.addComponent(ThirdPersonCamera, {
    target,
    distance: 5,
    damping: 0,
    shoulderOffset: { x: 0, y: 1, z: 0 },
    collisionRadius: 0.2,
    collisionRecoverySpeed: 4,
  });
  return { target, rig };
}

describe("ThirdPersonCamera", () => {
  it("pulls in when a wall stands between the target and the camera, and eases back out", async () => {
    const harness = await createThreeDApp();
    const { rig } = buildRig(harness);
    harness.step();
    expect(rig.currentDistance).toBeCloseTo(5, 3);

    // The rig looks along -Z by default, so the camera sits at z = -5. Put a wall at z = -2.
    const wall = harness.world.createEntity("Wall", { position: { x: 0, y: 1, z: -2 } });
    wall.addComponent(BoxCollider, { size: { x: 10, y: 4, z: 0.4 } });
    wall.addComponent(Rigidbody, { bodyType: "static" });
    harness.stepMany(3);
    expect(rig.currentDistance).toBeLessThan(3);

    const pulled = rig.currentDistance;
    wall.destroy();
    harness.stepMany(3);
    expect(rig.currentDistance).toBeGreaterThan(pulled);
    // Recovery is eased, so three frames of 1/60 s at 4 m/s do not get all the way back.
    expect(rig.currentDistance).toBeLessThan(5);

    harness.stepMany(120);
    expect(rig.currentDistance).toBeCloseTo(5, 3);
    harness.dispose();
  });

  it("keeps the full boom when collision is switched off", async () => {
    const harness = await createThreeDApp();
    const { rig } = buildRig(harness);
    rig.collisionEnabled = false;
    const wall = harness.world.createEntity("Wall", { position: { x: 0, y: 1, z: -2 } });
    wall.addComponent(BoxCollider, { size: { x: 10, y: 4, z: 0.4 } });
    wall.addComponent(Rigidbody, { bodyType: "static" });
    harness.stepMany(5);
    expect(rig.currentDistance).toBeCloseTo(5, 3);
    harness.dispose();
  });

  it("orbits the shoulder offset and follows its target", async () => {
    const harness = await createThreeDApp();
    const { target, rig } = buildRig(harness);
    harness.step();
    const cameraEntity = rig.entity;
    expect(cameraEntity.transform.position.z).toBeCloseTo(-5, 3);
    expect(cameraEntity.transform.position.y).toBeCloseTo(1, 3);

    target.transform.position = { x: 10, y: 0, z: 0 };
    harness.step();
    expect(cameraEntity.transform.position.x).toBeCloseTo(10, 3);
    expect(rig.pivot.x).toBeCloseTo(10, 3);
    harness.dispose();
  });

  it("does nothing without a target", async () => {
    const harness = await createThreeDApp();
    const cameraEntity = harness.world.createEntity("Camera");
    cameraEntity.addComponent(Camera);
    const rig = cameraEntity.addComponent(ThirdPersonCamera, { damping: 0 });
    harness.stepMany(3);
    expect(cameraEntity.transform.position.x).toBe(0);
    expect(rig.currentDistance).toBeCloseTo(4.5, 3);
    harness.dispose();
  });

  it("clamps its pitch between the declared limits", async () => {
    const harness = await createThreeDApp();
    const { rig } = buildRig(harness);
    rig.minPitch = -10;
    rig.maxPitch = 40;
    harness.stepMany(3);
    expect(rig.pitch).toBeGreaterThanOrEqual(-10);
    expect(rig.pitch).toBeLessThanOrEqual(40);
    harness.dispose();
  });

  it("snaps on request", async () => {
    const harness = await createThreeDApp();
    const { target, rig } = buildRig(harness);
    rig.damping = 1;
    target.transform.position = { x: 50, y: 0, z: 0 };
    rig.snap();
    expect(rig.entity.transform.position.x).toBeCloseTo(50, 3);
    harness.dispose();
  });
});
