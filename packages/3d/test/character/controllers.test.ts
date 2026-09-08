import { Camera, Quat } from "@ignifx/core";
import { BoxCollider, CharacterController, Rigidbody } from "@ignifx/physics";
import { describe, expect, it } from "vitest";
import { FirstPersonController } from "../../src/character/first-person-controller.js";
import { ThirdPersonController } from "../../src/character/third-person-controller.js";
import { characterActions } from "../support/actions.js";
import { createThreeDApp } from "../support/harness.js";
import type { ThreeDAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * The character controllers on a real headless `CharacterController`, mirroring the physics
 * package's own character tests: walk on a floor, jump, and refuse a slope the controller calls too
 * steep (`docs/architecture/09-physics.md` §2.3, `12-3d-toolkit.md` §1).
 */

/**
 * Adds a large static floor, optionally tilted.
 *
 * @param harness - The app harness.
 * @param tiltDegrees - How far to rotate the floor around X.
 * @returns The floor entity.
 */
function addFloor(harness: ThreeDAppHarness, tiltDegrees: number = 0): Entity {
  const floor = harness.world.createEntity("Floor", {
    position: { x: 0, y: -0.5, z: 0 },
    rotation: Quat.fromEulerDegrees(tiltDegrees, 0, 0),
  });
  floor.addComponent(BoxCollider, { size: { x: 60, y: 1, z: 60 } });
  floor.addComponent(Rigidbody, { bodyType: "static" });
  return floor;
}

/**
 * Adds a camera facing world forward, so camera-relative movement is the identity.
 *
 * @param harness - The app harness.
 */
function addCamera(harness: ThreeDAppHarness): void {
  harness.world.createEntity("Camera").addComponent(Camera);
}

/**
 * Adds a character with a third-person controller.
 *
 * @param harness - The app harness.
 * @param y - Where to drop it in.
 * @returns The entity and the controller.
 */
function addHero(harness: ThreeDAppHarness, y: number = 1): { entity: Entity; controller: ThirdPersonController } {
  const entity = harness.world.createEntity("Hero", { position: { x: 0, y, z: 0 } });
  entity.addComponent(CharacterController, { height: 1.8, radius: 0.35, slopeLimit: 45 });
  const controller = entity.addComponent(ThirdPersonController, {
    walkSpeed: 4,
    sprintSpeed: 8,
    turnSpeed: 3600,
    jumpHeight: 1.2,
  });
  return { entity, controller };
}

describe("ThirdPersonController", () => {
  it("walks forward on a floor, camera-relative", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    addCamera(harness);
    const { entity, controller } = addHero(harness);

    harness.stepMany(30);
    expect(controller.isGrounded).toBe(true);
    const startZ = entity.transform.position.z;

    harness.app.input.simulate({ "<Keyboard>/w": 1 });
    harness.stepMany(60);
    expect(entity.transform.position.z).toBeGreaterThan(startZ + 2);
    expect(controller.speed).toBeCloseTo(4, 1);
    expect(controller.isSprinting).toBe(false);
    harness.dispose();
  });

  it("sprints when the sprint action is held", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    addCamera(harness);
    const { controller } = addHero(harness);
    harness.stepMany(20);
    harness.app.input.simulate({ "<Keyboard>/w": 1, "<Keyboard>/shiftLeft": 1 });
    harness.stepMany(10);
    expect(controller.isSprinting).toBe(true);
    expect(controller.speed).toBeCloseTo(8, 1);
    harness.dispose();
  });

  it("turns to face the direction it is moving", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    addCamera(harness);
    const { entity } = addHero(harness);
    harness.stepMany(20);
    harness.app.input.simulate({ "<Keyboard>/d": 1 });
    harness.stepMany(20);
    // Moving along +X means facing +X.
    expect(entity.transform.forward.x).toBeGreaterThan(0.95);
    harness.dispose();
  });

  it("jumps, and lands again", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    addCamera(harness);
    const { entity, controller } = addHero(harness);
    harness.stepMany(40);
    const groundY = entity.transform.position.y;

    harness.app.input.simulate({ "<Keyboard>/space": 1 });
    harness.step();
    harness.app.input.simulate({ "<Keyboard>/space": 0 });
    harness.stepMany(10);
    expect(controller.verticalVelocity).toBeGreaterThan(0);
    expect(entity.transform.position.y).toBeGreaterThan(groundY + 0.2);

    harness.stepMany(120);
    expect(entity.transform.position.y).toBeCloseTo(groundY, 0);
    expect(controller.isGrounded).toBe(true);
    harness.dispose();
  });

  it("lifts over a low step when stepHeight allows it, and not when it does not", async () => {
    // The probe sweeps from inside the character's own capsule, so before 2026-09-08 both of its
    // sweeps reported the capsule at fraction zero and `stepHeight` never lifted anything.
    const climbStep = async (stepHeight: number): Promise<number> => {
      const harness = await createThreeDApp();
      harness.app.input.loadActions(characterActions());
      addFloor(harness);
      addCamera(harness);
      // A 0.3 m ledge across the character's path, one metre ahead.
      const ledge = harness.world.createEntity("Ledge", { position: { x: 0, y: 0.15, z: 2.5 } });
      ledge.addComponent(BoxCollider, { size: { x: 10, y: 0.3, z: 3 } });
      ledge.addComponent(Rigidbody, { bodyType: "static" });
      const entity = harness.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
      entity.addComponent(CharacterController, { height: 1.8, radius: 0.35, slopeLimit: 45 });
      entity.addComponent(ThirdPersonController, { walkSpeed: 3, turnSpeed: 3600, stepHeight });
      harness.stepMany(20);
      harness.app.input.simulate({ "<Keyboard>/w": 1 });
      harness.stepMany(120);
      harness.dispose();
      return entity.transform.position.z;
    };
    // The camera looks down +Z, so W walks towards the ledge; with the probe the character is on it.
    expect(await climbStep(0.35)).toBeGreaterThan(2);
    expect(await climbStep(0)).toBeLessThan(1.2);
  }, 60_000);

  it("cancels its momentum on request", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    addCamera(harness);
    const { controller } = addHero(harness, 6);
    harness.stepMany(10);
    expect(controller.verticalVelocity).toBeLessThan(0);
    controller.resetMomentum();
    expect(controller.verticalVelocity).toBe(0);
    harness.dispose();
  });

  it("walks up a 30-degree ramp and is stopped by a 60-degree one", async () => {
    // Lite classifies *any* incline as `sliding` because its character controller has no static
    // friction (`@ignifx/physics`'s own character suite says so in as many words), so the toolkit
    // decides walkability from the slope angle against `CharacterController.slopeLimit`. This test
    // is what proves that decision reaches the ground.
    expect(await climb(30)).toBeGreaterThan(0.15);
    expect(await climb(60)).toBeLessThan(0.05);
  }, 30_000);

  it("reports IGX-1212 once for an action the maps do not declare", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const errors: unknown[] = [];
    harness.app.onError.connect((report) => {
      errors.push(report.error);
    });
    const { controller } = addHero(harness);
    controller.moveAction = "Waltz";
    controller.rebind();
    harness.stepMany(5);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "IGX-1212" });
    harness.dispose();
  });

  it("stands still with no actions loaded at all", async () => {
    const harness = await createThreeDApp();
    addFloor(harness);
    const { entity } = addHero(harness);
    harness.stepMany(30);
    expect(entity.transform.position.x).toBeCloseTo(0, 3);
    expect(entity.transform.position.z).toBeCloseTo(0, 3);
    harness.dispose();
  });
});

/**
 * Walks a third-person character up a ramp and reports how much height it gained.
 *
 * @param degrees - The ramp's inclination; it rises along +X, like the physics suite's.
 * @returns The height gained, in metres.
 */
async function climb(degrees: number): Promise<number> {
  const harness = await createThreeDApp();
  try {
    harness.app.input.loadActions(characterActions());
    const ramp = harness.world.createEntity("Ramp", { rotation: Quat.fromEulerDegrees(0, 0, degrees) });
    ramp.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 10 } });
    addCamera(harness);
    const hero = addHero(harness, 1.6);
    harness.stepMany(45);
    const start = hero.entity.transform.position.y;
    harness.app.input.simulate({ "<Keyboard>/d": 1 });
    harness.stepMany(90);
    return hero.entity.transform.position.y - start;
  } finally {
    harness.dispose();
  }
}

/**
 * Counts the pointer-lock refusals the controller logged. A headless app has no canvas, so every
 * request rejects with `IGX-0809` and the controller swallows it as a warning — which is what makes
 * the re-arming visible without a DOM.
 *
 * @param harness - The app harness.
 * @returns How many refusals have been logged so far.
 */
function lockRefusals(harness: ThreeDAppHarness): number {
  return harness.sink.toArray().filter((record) => record.message.includes("Pointer lock was refused.")).length;
}

/**
 * Builds a player with a first-person controller and a head pivot.
 *
 * @param harness - The app harness.
 * @param fields - Overrides for the controller's fields.
 * @returns The controller.
 */
function addFirstPerson(harness: ThreeDAppHarness, fields: Record<string, unknown>): FirstPersonController {
  const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
  player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
  const head = harness.world.createEntity("Head", { parent: player, position: { x: 0, y: 1.6, z: 0 } });
  head.addComponent(Camera);
  return player.addComponent(FirstPersonController, { cameraPivot: head, ...fields });
}

describe("FirstPersonController", () => {
  it("looks with the mouse, clamping pitch", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
    player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const head = harness.world.createEntity("Head", { parent: player, position: { x: 0, y: 1.6, z: 0 } });
    head.addComponent(Camera);
    const controller = player.addComponent(FirstPersonController, {
      cameraPivot: head,
      sensitivity: 1,
      lockPointerOnClick: false,
    });

    harness.step();
    harness.app.input.simulate({ "<Mouse>/delta": { x: 90, y: 0 } });
    harness.step();
    expect(controller.yaw).toBeCloseTo(90, 0);

    harness.app.input.simulate({ "<Mouse>/delta": { x: 0, y: 1000 } });
    harness.step();
    expect(controller.pitch).toBeGreaterThanOrEqual(-89);
    expect(controller.pitch).toBeLessThanOrEqual(89);
    harness.dispose();
  });

  it("crouches and stands back up", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
    const character = player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const controller = player.addComponent(FirstPersonController, {
      lockPointerOnClick: false,
      standHeight: 1.8,
      crouchHeight: 1,
    });

    harness.stepMany(20);
    expect(controller.isCrouched).toBe(false);
    harness.app.input.simulate({ "<Keyboard>/c": 1 });
    harness.stepMany(3);
    expect(controller.isCrouched).toBe(true);
    expect(character.height).toBeCloseTo(1, 3);

    harness.app.input.simulate({ "<Keyboard>/c": 0 });
    harness.stepMany(3);
    expect(controller.isCrouched).toBe(false);
    expect(character.height).toBeCloseTo(1.8, 3);

    controller.enabled = false;
    harness.step();
    expect(controller.isCrouched).toBe(false);
    harness.dispose();
  });

  it("walks along its own facing rather than the camera's", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
    player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const controller = player.addComponent(FirstPersonController, {
      lockPointerOnClick: false,
      sensitivity: 1,
      walkSpeed: 5,
    });
    harness.stepMany(20);

    // Face +X, then walk forward.
    harness.app.input.simulate({ "<Mouse>/delta": { x: 90, y: 0 } });
    harness.step();
    harness.app.input.simulate({ "<Mouse>/delta": { x: 0, y: 0 }, "<Keyboard>/w": 1 });
    harness.stepMany(40);
    expect(player.transform.position.x).toBeGreaterThan(1);
    expect(controller.speed).toBeCloseTo(5, 1);
    harness.dispose();
  });

  it("jumps", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const player = harness.world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
    player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
    const controller = player.addComponent(FirstPersonController, { lockPointerOnClick: false });
    harness.stepMany(40);
    const groundY = player.transform.position.y;
    harness.app.input.simulate({ "<Keyboard>/space": 1 });
    harness.step();
    harness.app.input.simulate({ "<Keyboard>/space": 0 });
    harness.stepMany(8);
    expect(controller.verticalVelocity).toBeGreaterThan(0);
    expect(player.transform.position.y).toBeGreaterThan(groundY + 0.1);
    harness.dispose();
  });

  it("ignores mouse look until the pointer is locked", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    // The default: click to lock. A headless app never grants the lock, which is the same state a
    // browser is in between the click and the grant — and the state a menu leaves it in.
    const controller = addFirstPerson(harness, { sensitivity: 1 });
    harness.step();
    harness.app.input.simulate({ "<Mouse>/delta": { x: 90, y: 0 } });
    harness.step();
    expect(controller.yaw).toBeCloseTo(0, 5);

    // A drag-to-look game switches the gate off and gets unconditional mouse look back. The delta
    // is a per-frame reading, so it has to be simulated again for the second frame.
    controller.lockPointerOnClick = false;
    harness.app.input.simulate({ "<Mouse>/delta": { x: 90, y: 0 } });
    harness.step();
    expect(controller.yaw).toBeCloseTo(90, 0);
    harness.dispose();
  });

  it("looks up when the mouse moves forward and when the stick is pushed up", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const controller = addFirstPerson(harness, { sensitivity: 1, stickLookSpeed: 180, lockPointerOnClick: false });
    harness.step();

    // A mouse moved forward reports a negative `movementY`; a stick pushed up reports `+y`. Both
    // mean "look up", which is a negative pitch, and one `invertY` flips both.
    harness.app.input.simulate({ "<Mouse>/delta": { x: 0, y: -10 } });
    harness.step();
    expect(controller.pitch).toBeCloseTo(-10, 3);

    harness.app.input.simulate({ "<Mouse>/delta": { x: 0, y: 0 }, "<Gamepad>/rightStick": { x: 0, y: 1 } });
    harness.step(1 / 60);
    expect(controller.pitch).toBeCloseTo(-13, 3);
    harness.dispose();
  });

  it("keeps looking with a gamepad stick while the pointer is unlocked", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const controller = addFirstPerson(harness, { stickLookSpeed: 180 });
    harness.step();
    harness.app.input.simulate({ "<Gamepad>/rightStick": { x: 1, y: 0 } });
    harness.step(1 / 60);
    // A stick has no cursor to lose, so the lock gate does not apply to it: 180 deg/s for 1/60 s.
    expect(controller.yaw).toBeCloseTo(3, 3);
    harness.dispose();
  });

  it("reads a stick as a rate, so the frame rate does not change the turn", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    const controller = addFirstPerson(harness, { stickLookSpeed: 180 });
    harness.step();
    harness.app.input.simulate({ "<Gamepad>/rightStick": { x: 1, y: 0 } });
    const start = controller.yaw;
    harness.step(1 / 60);
    expect(controller.yaw - start).toBeCloseTo(3, 3);
    const halfway = controller.yaw;
    harness.step(1 / 120);
    harness.step(1 / 120);
    expect(controller.yaw - halfway).toBeCloseTo(3, 3);
    harness.dispose();
  });

  it("asks for pointer lock again every time the player clicks without it", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    addFirstPerson(harness, {});
    harness.step();
    expect(lockRefusals(harness)).toBe(0);

    harness.app.input.simulateEvent({ type: "pointerdown", button: 0 });
    harness.step();
    // The rejection, and the warning it logs, arrive on the microtask queue.
    await Promise.resolve();
    expect(lockRefusals(harness)).toBe(1);

    // The old one-shot latch stopped here, and a player who pressed Escape never got the lock back.
    harness.app.input.simulateEvent({ type: "pointerdown", button: 0 });
    harness.step();
    await Promise.resolve();
    expect(lockRefusals(harness)).toBe(2);

    // A frame without a press asks for nothing.
    harness.step();
    await Promise.resolve();
    expect(lockRefusals(harness)).toBe(2);
    harness.dispose();
  });

  it("asks for nothing when the game does not want the lock", async () => {
    const harness = await createThreeDApp();
    harness.app.input.loadActions(characterActions());
    addFloor(harness);
    addFirstPerson(harness, { lockPointerOnClick: false });
    harness.app.input.simulateEvent({ type: "pointerdown", button: 0 });
    harness.step();
    await Promise.resolve();
    expect(lockRefusals(harness)).toBe(0);
    harness.dispose();
  });
});
