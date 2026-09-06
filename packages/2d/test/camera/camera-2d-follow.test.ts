import { Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Camera2DFollow } from "../../src/camera/camera-2d-follow.js";
import { Camera2D } from "../../src/camera/camera-2d.js";
import { createTwoDApp } from "../support/app.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { Entity } from "@ignifx/core";

/**
 * `Camera2DFollow` (`docs/architecture/11-2d-toolkit.md` §2.1): the reference damped, dead-zoned
 * follow. It is a `Script` so a game can replace the policy without touching the camera, and it
 * moves in `lateUpdate` so it sees the frame's final player position rather than last frame's.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** One sixtieth of a second. */
const FRAME = 1 / 60;

/** A camera rigged to follow a target. */
interface Rig {
  readonly camera: Camera2D;
  readonly cameraEntity: Entity;
  readonly target: Entity;
  readonly step: (deltaSeconds?: number) => void;
  readonly settle: (seconds: number) => void;
}

/** Builds the rig with the follow script attached. */
async function createRig(): Promise<Rig> {
  const created = await createTwoDApp();
  harness = created;
  const world = created.app.world;
  const target = world.createEntity("player");
  const cameraEntity = world.createEntity("camera");
  const camera = cameraEntity.addComponent(Camera2D);
  camera.follow = target;
  camera.followDamping = 0;
  cameraEntity.addComponent(Camera2DFollow);
  const settle = (seconds: number): void => {
    const frames = Math.round(seconds / FRAME);
    for (let index = 0; index < frames; index += 1) {
      created.step(FRAME);
    }
  };
  return { camera, cameraEntity, target, step: created.step, settle };
}

/** The camera's world position. */
function positionOf(entity: Entity): Vec2 {
  const matrix = entity.transform.worldMatrix;
  return new Vec2(matrix[12] ?? 0, matrix[13] ?? 0);
}

describe("snapping", () => {
  it("lands on the target in one frame with no damping and no dead zone", async () => {
    const rig = await createRig();
    rig.target.transform.position2D = new Vec2(4, -3);
    rig.step(FRAME);
    const place = positionOf(rig.cameraEntity);
    expect(place.x).toBeCloseTo(4, 6);
    expect(place.y).toBeCloseTo(-3, 6);
  });

  it("adds the follow offset", async () => {
    const rig = await createRig();
    rig.camera.followOffset = { x: 1, y: 2 };
    rig.target.transform.position2D = new Vec2(4, -3);
    rig.step(FRAME);
    const place = positionOf(rig.cameraEntity);
    expect(place.x).toBeCloseTo(5, 6);
    expect(place.y).toBeCloseTo(-1, 6);
  });
});

describe("the dead zone", () => {
  it("does not move while the target is inside it", async () => {
    const rig = await createRig();
    rig.camera.deadZone = { x: 2, y: 2 };
    rig.target.transform.position2D = new Vec2(1.5, -1.5);
    rig.settle(0.5);
    const place = positionOf(rig.cameraEntity);
    expect(place.x).toBeCloseTo(0, 6);
    expect(place.y).toBeCloseTo(0, 6);
  });

  it("rides the zone's edge once the target leaves it", async () => {
    const rig = await createRig();
    rig.camera.deadZone = { x: 2, y: 0 };
    rig.target.transform.position2D = new Vec2(5, 0);
    rig.settle(0.5);
    // The camera chases only the part of the distance beyond the zone: 5 - 2 = 3.
    expect(positionOf(rig.cameraEntity).x).toBeCloseTo(3, 6);
  });

  it("works in the negative direction too", async () => {
    const rig = await createRig();
    rig.camera.deadZone = { x: 2, y: 0 };
    rig.target.transform.position2D = new Vec2(-5, 0);
    rig.settle(0.5);
    expect(positionOf(rig.cameraEntity).x).toBeCloseTo(-3, 6);
  });
});

describe("damping", () => {
  it("approaches the target without overshooting", async () => {
    const rig = await createRig();
    rig.camera.followDamping = 0.2;
    rig.target.transform.position2D = new Vec2(10, 0);
    rig.step(FRAME);
    const first = positionOf(rig.cameraEntity).x;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(10);
    rig.settle(2);
    expect(positionOf(rig.cameraEntity).x).toBeCloseTo(10, 3);
  });

  it("is frame-rate independent", async () => {
    // The camera covers the same fraction of the remaining distance per *second*, not per frame,
    // so a 30 fps machine and a 120 fps machine see the same motion.
    const coarse = await createRig();
    coarse.camera.followDamping = 0.25;
    coarse.target.transform.position2D = new Vec2(10, 0);
    for (let index = 0; index < 15; index += 1) {
      coarse.step(1 / 30);
    }
    const coarseX = positionOf(coarse.cameraEntity).x;
    coarse.step(0);
    harness?.dispose();
    harness = null;

    const fine = await createRig();
    fine.camera.followDamping = 0.25;
    fine.target.transform.position2D = new Vec2(10, 0);
    for (let index = 0; index < 60; index += 1) {
      fine.step(1 / 120);
    }
    expect(positionOf(fine.cameraEntity).x).toBeCloseTo(coarseX, 2);
  });
});

describe("degenerate rigs", () => {
  it("does nothing without a target", async () => {
    const rig = await createRig();
    rig.camera.follow = null;
    rig.settle(0.5);
    expect(positionOf(rig.cameraEntity).x).toBe(0);
  });

  it("stops following a destroyed target", async () => {
    const rig = await createRig();
    rig.target.transform.position2D = new Vec2(5, 0);
    rig.step(FRAME);
    expect(positionOf(rig.cameraEntity).x).toBeCloseTo(5, 6);
    rig.target.destroy();
    rig.step(FRAME);
    rig.settle(0.5);
    expect(positionOf(rig.cameraEntity).x).toBeCloseTo(5, 6);
  });

  it("does nothing on an entity with no Camera2D", async () => {
    const created = await createTwoDApp();
    harness = created;
    const lonely = created.app.world.createEntity("lonely");
    lonely.addComponent(Camera2DFollow);
    expect(() => {
      created.step(FRAME);
      created.step(FRAME);
    }).not.toThrow();
  });
});
