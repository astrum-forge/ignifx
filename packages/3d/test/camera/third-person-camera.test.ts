import { Camera } from "@ignifx/core";
import { BoxCollider, CharacterController, Rigidbody } from "@ignifx/physics";
import { describe, expect, it } from "vitest";
import { ThirdPersonCamera } from "../../src/camera/third-person-camera.js";
import { characterActions } from "../support/actions.js";
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

/**
 * Counts the pointer-lock refusals the rig logged. A headless app has no canvas, so every request
 * rejects with `IGX-0809` and the rig swallows it as a warning — which is what makes the re-arming
 * visible without a DOM.
 *
 * @param harness - The app harness.
 * @returns How many refusals have been logged so far.
 */
function refusals(harness: ThreeDAppHarness): number {
  return harness.sink.toArray().filter((record) => record.message.includes("Pointer lock was refused.")).length;
}

describe("ThirdPersonCamera", () => {
  it("orbits about the vertical at a non-zero pitch: no roll, and a constant height all the way round", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    const target = harness.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
    const cameraEntity = harness.world.createEntity("Camera");
    cameraEntity.addComponent(Camera);
    // Authored the way the template authors it: a downward tilt on the entity, read at awake.
    cameraEntity.transform.localEulerAngles = { x: 20, y: 0, z: 0 };
    const rig = cameraEntity.addComponent(ThirdPersonCamera, {
      target,
      distance: 5,
      damping: 0,
      shoulderOffset: { x: 0, y: 0, z: 0 },
      collisionEnabled: false,
    });
    harness.stepMany(2);
    expect(rig.pitch).toBeCloseTo(20, 3);
    expect(rig.yaw).toBeCloseTo(0, 3);
    const height = cameraEntity.transform.position.y;
    // Five metres back and 20 degrees up puts the camera 5·sin(20°) above the pivot.
    expect(height).toBeCloseTo(1 + 5 * Math.sin((20 * Math.PI) / 180), 3);

    // Before 2026-09-08 the rotation was one intrinsic-XYZ Euler call, so yawing at a pitch rolled
    // the horizon and the camera's height followed cos(yaw). A horizontal mouse motion must be a
    // turn about the vertical: the camera's right axis stays level, its up stays up, its height
    // stays put, and it keeps looking at the pivot.
    const pixelsPerStep = 30 / rig.sensitivity;
    for (let step = 1; step <= 12; step += 1) {
      harness.app.input.simulate({ "<Mouse>/delta": { x: pixelsPerStep, y: 0 } });
      harness.step();
      harness.step();
      const transform = cameraEntity.transform;
      const label = `yaw ${String(30 * step)}`;
      expect(rig.pitch, label).toBeCloseTo(20, 3);
      expect(transform.right.y, label).toBeCloseTo(0, 4);
      expect(transform.up.y, label).toBeGreaterThan(0.9);
      expect(transform.position.y, label).toBeCloseTo(height, 3);
      const toPivot = {
        x: rig.pivot.x - transform.position.x,
        y: rig.pivot.y - transform.position.y,
        z: rig.pivot.z - transform.position.z,
      };
      const length = Math.hypot(toPivot.x, toPivot.y, toPivot.z);
      const forward = transform.forward;
      const facing = (forward.x * toPivot.x + forward.y * toPivot.y + forward.z * toPivot.z) / length;
      expect(facing, label).toBeCloseTo(1, 4);
    }
    harness.dispose();
  }, 30_000);

  it("sweeps past the target's own capsule, so a pivot inside the character never collapses the boom", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    // A floor under the character, so the capsule has something to stand on; nothing else in the world.
    const floor = harness.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } });
    floor.addComponent(BoxCollider, { size: { x: 60, y: 1, z: 60 } });
    floor.addComponent(Rigidbody, { bodyType: "static" });
    const target = harness.world.createEntity("Hero", { position: { x: 0, y: 0.9, z: 0 } });
    target.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const cameraEntity = harness.world.createEntity("Camera");
    cameraEntity.addComponent(Camera);
    // A shoulder pivot: inside the capsule, as every third-person rig's is. A level boom (pitch 0)
    // keeps the sweep 1.45 m above a floor whose top is at 0.5, so the capsule is the only body it
    // could ever meet.
    const rig = cameraEntity.addComponent(ThirdPersonCamera, {
      target,
      distance: 4.5,
      damping: 0,
      minPitch: 0,
      maxPitch: 0,
      shoulderOffset: { x: 0.4, y: 0.55, z: 0 },
      collisionRadius: 0.25,
      collisionLayers: [],
    });
    harness.stepMany(4);
    expect(rig.currentDistance).toBeCloseTo(4.5, 2);

    // Orbit a full turn in 30-degree steps through the rig's own look input. Before 2026-09-08 the
    // sweep found the capsule at fraction zero for every yaw whose boom crossed it, and
    // `currentDistance` read 0 — the camera sat inside the character's head.
    const pixelsPerStep = 30 / rig.sensitivity;
    for (let step = 1; step <= 12; step += 1) {
      harness.app.input.simulate({ "<Mouse>/delta": { x: pixelsPerStep, y: 0 } });
      harness.step();
      harness.step();
      expect(rig.yaw, `step ${String(step)}`).toBeCloseTo(30 * step, 3);
      expect(rig.currentDistance, `yaw ${String(30 * step)}`).toBeCloseTo(4.5, 2);
    }
    harness.dispose();
  }, 30_000);

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

  it("does not query physics on a frame before the first fixed step", async () => {
    const harness = await createThreeDApp();
    const reports: unknown[] = [];
    harness.app.onError.connect((report) => {
      reports.push(report);
    });
    buildRig(harness);
    // A frame shorter than a fixed step: `lateUpdate` runs, `fixedUpdate` does not, Havok has not
    // stepped. Before the guard this threw `IGX-0902` into the lifecycle boundary every start-up.
    harness.step(1 / 600);
    expect(harness.app.physics.hasStepped).toBe(false);
    expect(reports).toEqual([]);
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

  it("orbits with an unlocked mouse, because click-to-lock is off by default", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    const { rig } = buildRig(harness);
    rig.sensitivity = 1;
    harness.step();
    expect(rig.lockPointerOnClick).toBe(false);
    const yaw = rig.yaw;
    // A drag-to-orbit game keeps the cursor, so nothing waits for a lock it never asks for.
    harness.app.input.simulate({ "<Mouse>/delta": { x: 10, y: 0 } });
    harness.step();
    expect(rig.yaw).toBeCloseTo(yaw + 10, 3);
    harness.dispose();
  });

  it("ignores mouse look and re-asks for the lock once click-to-lock is on", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    const { rig } = buildRig(harness);
    rig.sensitivity = 1;
    rig.lockPointerOnClick = true;
    harness.step();
    const yaw = rig.yaw;

    harness.app.input.simulate({ "<Mouse>/delta": { x: 10, y: 0 } });
    harness.app.input.simulateEvent({ type: "pointerdown", button: 0 });
    harness.step();
    // The headless app has no canvas, so the request rejects and is logged rather than thrown.
    await Promise.resolve();
    expect(rig.yaw).toBeCloseTo(yaw, 5);
    expect(refusals(harness)).toBe(1);

    // Every further click asks again: a browser drops the lock on Escape and on focus loss.
    harness.app.input.simulateEvent({ type: "pointerdown", button: 0 });
    harness.step();
    await Promise.resolve();
    expect(refusals(harness)).toBe(2);
    harness.dispose();
  });

  it("aims up when the mouse moves forward and when the stick is pushed up", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    const { rig } = buildRig(harness);
    rig.sensitivity = 1;
    rig.stickLookSpeed = 180;
    harness.step();
    const start = rig.pitch;

    // The same two gestures as the first-person suite, and the same answer: both lower the pitch,
    // which drops the boom and aims the camera up past the target.
    harness.app.input.simulate({ "<Mouse>/delta": { x: 0, y: -10 } });
    harness.step();
    expect(rig.pitch).toBeCloseTo(start - 10, 3);

    harness.app.input.simulate({ "<Mouse>/delta": { x: 0, y: 0 }, "<Gamepad>/rightStick": { x: 0, y: 1 } });
    harness.step(1 / 60);
    expect(rig.pitch).toBeCloseTo(start - 13, 3);
    harness.dispose();
  });

  it("orbits with a gamepad stick at a rate the frame rate does not change", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    const { rig } = buildRig(harness);
    rig.lockPointerOnClick = true;
    rig.stickLookSpeed = 180;
    harness.step();
    const start = rig.yaw;
    // A stick is a deflection, so it is a rate: 180 deg/s for 1/60 s is three degrees, and the lock
    // gate does not apply to a device with no cursor to lose.
    harness.app.input.simulate({ "<Gamepad>/rightStick": { x: 1, y: 0 } });
    harness.step(1 / 60);
    expect(rig.yaw - start).toBeCloseTo(3, 3);
    const halfway = rig.yaw;
    harness.step(1 / 120);
    harness.step(1 / 120);
    expect(rig.yaw - halfway).toBeCloseTo(3, 3);
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
