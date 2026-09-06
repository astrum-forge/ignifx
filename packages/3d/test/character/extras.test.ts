import { Camera } from "@ignifx/core";
import { BoxCollider, CharacterController, Rigidbody } from "@ignifx/physics";
import { describe, expect, it } from "vitest";
import { FirstPersonController } from "../../src/character/first-person-controller.js";
import { ThirdPersonController } from "../../src/character/third-person-controller.js";
import { characterActions } from "../support/actions.js";
import { createThreeDApp } from "../support/harness.js";
import type { ThreeDAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * The optional flourishes of `docs/architecture/12-3d-toolkit.md` §1.1 and §1.2: the step probe,
 * head bob, and the sprint FOV kick. All three default to off, so all three need a test that turns
 * them on.
 */

/**
 * Adds a large static floor.
 *
 * @param harness - The app harness.
 */
function addFloor(harness: ThreeDAppHarness): void {
  const floor = harness.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } });
  floor.addComponent(BoxCollider, { size: { x: 60, y: 1, z: 60 } });
  floor.addComponent(Rigidbody, { bodyType: "static" });
}

/**
 * Adds a low kerb the character can be asked to step over.
 *
 * @param harness - The app harness.
 * @param height - How tall the kerb is.
 * @param z - Where to put it.
 * @returns The kerb entity.
 */
function addStep(harness: ThreeDAppHarness, height: number, z: number): Entity {
  const step = harness.world.createEntity("Step", { position: { x: 0, y: height / 2, z } });
  step.addComponent(BoxCollider, { size: { x: 10, y: height, z: 1 } });
  step.addComponent(Rigidbody, { bodyType: "static" });
  return step;
}

describe("ThirdPersonController step probe", () => {
  it("lifts the character over a kerb it would otherwise stop at", async () => {
    const climbed = async (stepHeight: number): Promise<number> => {
      const harness = await createThreeDApp();
      try {
        harness.app.input.loadActions(characterActions());
        addFloor(harness);
        addStep(harness, 0.3, 2);
        harness.world.createEntity("Camera").addComponent(Camera);
        const hero = harness.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
        hero.addComponent(CharacterController, { height: 1.8, radius: 0.35, slopeLimit: 45 });
        hero.addComponent(ThirdPersonController, { walkSpeed: 3, stepHeight });
        harness.stepMany(40);
        harness.app.input.simulate({ "<Keyboard>/w": 1 });
        harness.stepMany(120);
        return hero.transform.position.z;
      } finally {
        harness.dispose();
      }
    };
    const withProbe = await climbed(0.4);
    const withoutProbe = await climbed(0);
    expect(withProbe).toBeGreaterThan(withoutProbe);
  }, 30_000);

  it("leaves the character alone when there is nothing in front of it", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    harness.world.createEntity("Camera").addComponent(Camera);
    const hero = harness.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
    hero.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    hero.addComponent(ThirdPersonController, { walkSpeed: 3, stepHeight: 0.4 });
    harness.stepMany(40);
    const restingY = hero.transform.position.y;
    harness.app.input.simulate({ "<Keyboard>/w": 1 });
    harness.stepMany(40);
    expect(hero.transform.position.y).toBeCloseTo(restingY, 1);
    harness.dispose();
  });

  it("refuses to step when the space above the obstacle is blocked", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    // A tall wall: the forward probe hits it at both heights, so the probe must decline.
    addStep(harness, 4, 2);
    harness.world.createEntity("Camera").addComponent(Camera);
    const hero = harness.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
    hero.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    hero.addComponent(ThirdPersonController, { walkSpeed: 3, stepHeight: 0.4 });
    harness.stepMany(40);
    harness.app.input.simulate({ "<Keyboard>/w": 1 });
    harness.stepMany(60);
    expect(hero.transform.position.y).toBeLessThan(2);
    expect(hero.transform.position.z).toBeLessThan(2);
    harness.dispose();
  });

  it("does not turn when rotateToMovement is off", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    harness.world.createEntity("Camera").addComponent(Camera);
    const hero = harness.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
    hero.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const controller = hero.addComponent(ThirdPersonController, { rotateToMovement: false });
    harness.stepMany(20);
    harness.app.input.simulate({ "<Keyboard>/d": 1 });
    harness.stepMany(20);
    expect(hero.transform.forward.z).toBeGreaterThan(0.99);
    expect(controller.moveDirection.x).toBeGreaterThan(0.9);
    harness.dispose();
  });

  it("does nothing at all without a CharacterController", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    const orphan = harness.world.createEntity("Orphan");
    // `requires` is enforced by the engine, so the controller can only be orphaned by removing the
    // character afterwards; either way it must not throw on the next step.
    orphan.addComponent(CharacterController);
    const controller = orphan.addComponent(ThirdPersonController);
    orphan.getComponent(CharacterController)?.destroy();
    harness.stepMany(3);
    expect(controller.speed).toBe(0);
    harness.dispose();
  });
});

describe("FirstPersonController flourishes", () => {
  it("bobs the head while walking and stops while airborne", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
    player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const head = harness.world.createEntity("Head", { parent: player, position: { x: 0, y: 1.6, z: 0 } });
    head.addComponent(Camera);
    player.addComponent(FirstPersonController, {
      cameraPivot: head,
      lockPointerOnClick: false,
      headBobAmplitude: 0.1,
      headBobFrequency: 2,
      sprintFovKick: 8,
    });

    harness.stepMany(30);
    harness.app.input.simulate({ "<Keyboard>/w": 1 });
    const heights = new Set<number>();
    for (let frame = 0; frame < 60; frame += 1) {
      harness.step();
      heights.add(Number(head.transform.localPosition.y.toFixed(3)));
    }
    expect(heights.size).toBeGreaterThan(5);
    harness.dispose();
  });

  it("widens the field of view while sprinting and lets it back down", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
    player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const head = harness.world.createEntity("Head", { parent: player, position: { x: 0, y: 1.6, z: 0 } });
    const camera = head.addComponent(Camera);
    player.addComponent(FirstPersonController, {
      cameraPivot: head,
      lockPointerOnClick: false,
      sprintFovKick: 10,
    });
    harness.stepMany(30);
    const base = camera.fov;

    harness.app.input.simulate({ "<Keyboard>/w": 1, "<Keyboard>/shiftLeft": 1 });
    harness.stepMany(60);
    expect(camera.fov).toBeGreaterThan(base + 5);

    harness.app.input.simulate({ "<Keyboard>/shiftLeft": 0 });
    harness.stepMany(120);
    expect(camera.fov).toBeCloseTo(base, 1);
    harness.dispose();
  });

  it("inverts the look axis when asked", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
    player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const controller = player.addComponent(FirstPersonController, {
      lockPointerOnClick: false,
      sensitivity: 1,
      invertY: true,
    });
    harness.step();
    harness.app.input.simulate({ "<Mouse>/delta": { x: 0, y: 10 } });
    harness.step();
    expect(controller.pitch).toBeGreaterThan(0);
    harness.dispose();
  });

  it("does not jump while crouched", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
    player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const controller = player.addComponent(FirstPersonController, { lockPointerOnClick: false });
    harness.stepMany(40);
    harness.app.input.simulate({ "<Keyboard>/c": 1 });
    harness.stepMany(5);
    harness.app.input.simulate({ "<Keyboard>/c": 1, "<Keyboard>/space": 1 });
    harness.step();
    harness.app.input.simulate({ "<Keyboard>/c": 1, "<Keyboard>/space": 0 });
    harness.stepMany(5);
    expect(controller.verticalVelocity).toBeLessThanOrEqual(0);
    harness.dispose();
  });
});
