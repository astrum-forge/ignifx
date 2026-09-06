import { Camera, Quat } from "@ignifx/core";
import { BoxCollider, CharacterController, Rigidbody, SphereCollider } from "@ignifx/physics";
import { describe, expect, it } from "vitest";
import { PlatformMover, Projectile, RigidbodyMover } from "../../src/character/movers.js";
import { characterActions } from "../support/actions.js";
import { createThreeDApp } from "../support/harness.js";
import type { ThreeDAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * The `Rigidbody`-based movers of `docs/architecture/12-3d-toolkit.md` §1.3.
 */

/**
 * Adds a large static floor.
 *
 * @param harness - The app harness.
 * @returns The floor entity.
 */
function addFloor(harness: ThreeDAppHarness): Entity {
  const floor = harness.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } });
  floor.addComponent(BoxCollider, { size: { x: 60, y: 1, z: 60 } });
  floor.addComponent(Rigidbody, { bodyType: "static" });
  return floor;
}

describe("RigidbodyMover", () => {
  it("pushes its body along the stick, camera-relative", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    harness.world.createEntity("Camera").addComponent(Camera);
    const ball = harness.world.createEntity("Ball", { position: { x: 0, y: 1, z: 0 } });
    ball.addComponent(SphereCollider, { radius: 0.5 });
    const body = ball.addComponent(Rigidbody, { mass: 1 });
    ball.addComponent(RigidbodyMover, { force: 40, maxSpeed: 10 });

    harness.stepMany(20);
    harness.app.input.simulate({ "<Keyboard>/w": 1 });
    harness.stepMany(40);
    expect(body.linearVelocity.z).toBeGreaterThan(1);
    expect(ball.transform.position.z).toBeGreaterThan(0.5);
    harness.dispose();
  });

  it("stops adding force at its speed limit", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    harness.world.createEntity("Camera").addComponent(Camera);
    const ball = harness.world.createEntity("Ball", { position: { x: 0, y: 1, z: 0 } });
    ball.addComponent(SphereCollider, { radius: 0.5 });
    const body = ball.addComponent(Rigidbody, { mass: 1 });
    ball.addComponent(RigidbodyMover, { force: 200, maxSpeed: 3 });
    harness.stepMany(10);
    harness.app.input.simulate({ "<Keyboard>/w": 1 });
    harness.stepMany(120);
    expect(Math.hypot(body.linearVelocity.x, body.linearVelocity.z)).toBeLessThan(5);
    harness.dispose();
  });

  it("steers by torque when asked", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const car = harness.world.createEntity("Car", { position: { x: 0, y: 1, z: 0 } });
    car.addComponent(BoxCollider, { size: { x: 1, y: 0.5, z: 2 } });
    const body = car.addComponent(Rigidbody, { mass: 1 });
    car.addComponent(RigidbodyMover, { torqueSteering: true, force: 40, cameraRelative: false });
    harness.stepMany(10);
    harness.app.input.simulate({ "<Keyboard>/d": 1 });
    harness.stepMany(20);
    expect(Math.abs(body.angularVelocity.y)).toBeGreaterThan(0);
    harness.dispose();
  });

  it("does nothing with a centred stick", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const ball = harness.world.createEntity("Ball", { position: { x: 0, y: 1, z: 0 } });
    ball.addComponent(SphereCollider, { radius: 0.5 });
    ball.addComponent(Rigidbody, { mass: 1 });
    ball.addComponent(RigidbodyMover);
    harness.stepMany(40);
    expect(Math.abs(ball.transform.position.x)).toBeLessThan(0.05);
    expect(Math.abs(ball.transform.position.z)).toBeLessThan(0.05);
    harness.dispose();
  });
});

describe("PlatformMover", () => {
  it("shuttles between its two ends", async () => {
    const harness = await createThreeDApp();
    const lift = harness.world.createEntity("Lift", { position: { x: 0, y: 0, z: 0 } });
    lift.addComponent(BoxCollider, { size: { x: 4, y: 0.4, z: 4 } });
    lift.addComponent(Rigidbody, { bodyType: "kinematic" });
    const mover = lift.addComponent(PlatformMover, {
      offset: { x: 0, y: 4, z: 0 },
      duration: 1,
      waitSeconds: 0,
      carryRiders: false,
    });

    harness.stepMany(30);
    expect(lift.transform.position.y).toBeGreaterThan(0.5);
    harness.stepMany(30);
    expect(lift.transform.position.y).toBeGreaterThan(3.5);
    harness.stepMany(60);
    expect(lift.transform.position.y).toBeLessThan(0.5);
    expect(mover.deltaThisStep.y).toBeDefined();
    harness.dispose();
  });

  it("carries a character standing on it", async () => {
    const harness = await createThreeDApp();
    const lift = harness.world.createEntity("Lift", { position: { x: 0, y: 0, z: 0 } });
    lift.addComponent(BoxCollider, { size: { x: 6, y: 0.4, z: 6 } });
    lift.addComponent(Rigidbody, { bodyType: "kinematic" });
    const rider = harness.world.createEntity("Rider", { position: { x: 0, y: 1.2, z: 0 } });
    rider.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    lift.addComponent(PlatformMover, { offset: { x: 6, y: 0, z: 0 }, duration: 2, waitSeconds: 0 });

    harness.stepMany(60);
    // The rider has to have moved with the platform rather than being left behind at x = 0.
    expect(lift.transform.position.x).toBeGreaterThan(1);
    expect(rider.transform.position.x).toBeGreaterThan(0.2);
    harness.dispose();
  });
});

describe("Projectile", () => {
  it("flies along its forward vector and dies of old age", async () => {
    const harness = await createThreeDApp();
    const bullet = harness.world.createEntity("Bullet", {
      position: { x: 0, y: 5, z: 0 },
      rotation: Quat.fromEulerDegrees(0, 90, 0),
    });
    bullet.addComponent(SphereCollider, { radius: 0.05 });
    bullet.addComponent(Rigidbody, { mass: 0.02 });
    const projectile = bullet.addComponent(Projectile, { speed: 30, gravityScale: 0, lifetimeSeconds: 0.5 });

    harness.stepMany(10);
    expect(bullet.transform.position.x).toBeGreaterThan(3);
    expect(Math.abs(bullet.transform.position.y - 5)).toBeLessThan(0.2);
    expect(projectile.age).toBeGreaterThan(0);

    harness.stepMany(30);
    expect(bullet.isDestroyed).toBe(true);
    harness.dispose();
  });

  it("drops under gravity when its scale is one", async () => {
    const harness = await createThreeDApp();
    const bullet = harness.world.createEntity("Bullet", {
      position: { x: 0, y: 20, z: 0 },
      rotation: Quat.fromEulerDegrees(0, 90, 0),
    });
    bullet.addComponent(SphereCollider, { radius: 0.05 });
    bullet.addComponent(Rigidbody, { mass: 0.02 });
    bullet.addComponent(Projectile, { speed: 10, gravityScale: 1, lifetimeSeconds: 0 });
    harness.stepMany(60);
    expect(bullet.transform.position.y).toBeLessThan(19);
    expect(bullet.isDestroyed).toBe(false);
    harness.dispose();
  });

  it("destroys itself on its first contact, but not with its owner", async () => {
    const harness = await createThreeDApp();
    addFloor(harness);
    const shooter = harness.world.createEntity("Shooter");
    const bullet = harness.world.createEntity("Bullet", { position: { x: 0, y: 1, z: 0 } });
    bullet.addComponent(SphereCollider, { radius: 0.1 });
    bullet.addComponent(Rigidbody, { mass: 0.02, collisionEvents: "on" });
    bullet.addComponent(Projectile, { speed: 0, gravityScale: 1, lifetimeSeconds: 0, owner: shooter });
    harness.stepMany(60);
    expect(bullet.isDestroyed).toBe(true);
    harness.dispose();
  });
});
