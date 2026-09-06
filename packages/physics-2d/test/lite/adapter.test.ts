import { version } from "@dimforge/rapier2d-compat";
import { Vec2 } from "@ignifx/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createController,
  computeControllerMovement,
  destroyController,
  tuneController,
} from "../../src/lite/rapier/character.js";
import { loadRapier } from "../../src/lite/rapier/module.js";
import {
  castRay,
  colliderHandle,
  createBody,
  createCollider,
  createEventQueue,
  createWorld,
  destroyEventQueue,
  destroyWorld,
  drainCollisions,
  interactionGroups,
  primeWorld,
  RAPIER_LAYER_LIMIT,
  readColliderTranslation,
  setTimestep,
  stepWorld,
  toDegrees,
  toRadians,
} from "../../src/lite/rapier/world.js";
import type { BodyOptions2D, ColliderOptions2D, RayResult2D } from "../../src/lite/rapier/world.js";

/**
 * The adapter compatibility suite: it pins the `@dimforge/rapier2d-compat@0.20.0` behaviour the
 * runtime is written against, so a version bump that changes any of it fails here rather than in a
 * game (`docs/architecture/00-overview.md` §3, coding standards §4).
 *
 * This is one of the two directories allowed to import the backend directly (`test/lite/**`).
 */

/** The fixed step every case uses. */
const STEP = 1 / 60;

/** A plain solid collider on layer 0 that collides with everything. */
const SOLID: ColliderOptions2D = {
  offset: { x: 0, y: 0 },
  rotation: 0,
  sensor: false,
  groups: interactionGroups(1, 0xff_ff),
  friction: 0.6,
  restitution: 0,
  frictionCombine: "average",
  restitutionCombine: "average",
  events: false,
};

/** A static body at the origin. */
const STATIC: BodyOptions2D = {
  motion: "static",
  position: { x: 0, y: 0 },
  rotation: 0,
  gravityScale: 1,
  linearDamping: 0,
  angularDamping: 0,
  freezeRotation: false,
  additionalMass: 0,
  startAsleep: false,
};

beforeAll(async () => {
  await loadRapier();
});

describe("Rapier 2D facts the adapter relies on", () => {
  it("packs interaction groups as membership in the high 16 bits and filter in the low 16", () => {
    expect(interactionGroups(0b1, 0xff_ff)).toBe(0x1_ff_ff);
    expect(interactionGroups(1 << 15, 1) >>> 0).toBe(0x8000_0001);
    // Which is why only sixteen layers can be filtered by.
    expect(RAPIER_LAYER_LIMIT).toBe(16);
  });

  it("builds no broadphase until the world has stepped", () => {
    const world = createWorld({ x: 0, y: -9.81 });
    const queue = createEventQueue();
    try {
      const floor = createBody(world, STATIC);
      createCollider(world, floor, { kind: "box", halfWidth: 5, halfHeight: 0.5 }, SOLID);
      const before: RayResult2D = { hit: false, collider: null, distance: 0 };
      castRay(world, { x: 0, y: 5 }, { x: 0, y: -1 }, 20, SOLID.groups, false, new Vec2(), new Vec2(), before);
      expect(before.hit).toBe(false);

      primeWorld(world, queue);
      const after: RayResult2D = { hit: false, collider: null, distance: 0 };
      castRay(world, { x: 0, y: 5 }, { x: 0, y: -1 }, 20, SOLID.groups, false, new Vec2(), new Vec2(), after);
      expect(after.hit).toBe(true);
      expect(after.distance).toBeCloseTo(4.5, 3);
    } finally {
      destroyEventQueue(queue);
      destroyWorld(world);
    }
  });

  it("hides a collider created since the last step until the next one", () => {
    const world = createWorld({ x: 0, y: 0 });
    const queue = createEventQueue();
    try {
      primeWorld(world, queue);
      const wall = createBody(world, { ...STATIC, position: { x: 3, y: 0 } });
      createCollider(world, wall, { kind: "box", halfWidth: 0.5, halfHeight: 5 }, SOLID);
      const result: RayResult2D = { hit: false, collider: null, distance: 0 };
      castRay(world, { x: 0, y: 0 }, { x: 1, y: 0 }, 20, SOLID.groups, false, new Vec2(), new Vec2(), result);
      expect(result.hit).toBe(false);
      primeWorld(world, queue);
      castRay(world, { x: 0, y: 0 }, { x: 1, y: 0 }, 20, SOLID.groups, false, new Vec2(), new Vec2(), result);
      expect(result.hit).toBe(true);
    } finally {
      destroyEventQueue(queue);
      destroyWorld(world);
    }
  });

  it("reports both collider handles and the enter/exit flag for every event", () => {
    const world = createWorld({ x: 0, y: -9.81 });
    const queue = createEventQueue();
    try {
      setTimestep(world, STEP);
      const floor = createBody(world, { ...STATIC, position: { x: 0, y: -0.5 } });
      const floorCollider = createCollider(
        world,
        floor,
        { kind: "box", halfWidth: 5, halfHeight: 0.5 },
        { ...SOLID, events: true },
      );
      const box = createBody(world, { ...STATIC, motion: "dynamic", position: { x: 0, y: 2 } });
      const boxCollider = createCollider(
        world,
        box,
        { kind: "box", halfWidth: 0.5, halfHeight: 0.5 },
        {
          ...SOLID,
          events: true,
        },
      );
      if (floorCollider === null || boxCollider === null) {
        throw new Error("a collider was refused");
      }
      const floorHandle = colliderHandle(floorCollider);
      const boxHandle = colliderHandle(boxCollider);

      const seen: string[] = [];
      for (let index = 0; index < 90; index += 1) {
        stepWorld(world, queue);
        drainCollisions(queue, (event): void => {
          seen.push(
            `${event.started ? "start" : "stop"} ${String(event.first === floorHandle)}` +
              `/${String(event.second === boxHandle)}`,
          );
        });
      }
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]).toBe("start true/true");
    } finally {
      destroyEventQueue(queue);
      destroyWorld(world);
    }
  });

  it("refuses a convex hull it cannot build and returns null", () => {
    const world = createWorld({ x: 0, y: 0 });
    try {
      const body = createBody(world, STATIC);
      const degenerate = createCollider(world, body, { kind: "polygon", points: new Float32Array([0, 0]) }, SOLID);
      expect(degenerate).toBeNull();
    } finally {
      destroyWorld(world);
    }
  });

  it("reads a collider's world translation without allocating", () => {
    const world = createWorld({ x: 0, y: 0 });
    try {
      const body = createBody(world, { ...STATIC, position: { x: 2, y: 3 } });
      const collider = createCollider(
        world,
        body,
        { kind: "circle", radius: 0.5 },
        {
          ...SOLID,
          offset: { x: 1, y: 0 },
        },
      );
      if (collider === null) {
        throw new Error("the collider was refused");
      }
      const out = new Vec2();
      readColliderTranslation(collider, out);
      expect(out.x).toBeCloseTo(3, 5);
      expect(out.y).toBeCloseTo(3, 5);
    } finally {
      destroyWorld(world);
    }
  });

  it("converts between ignifx degrees and Rapier radians", () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 10);
    expect(toDegrees(Math.PI / 2)).toBeCloseTo(90, 10);
  });

  it("excludes an obstacle for a move filter that stays in JavaScript", () => {
    // The character controller's `filterPredicate` runs inside WebAssembly, so it must touch only
    // plain JavaScript state. Calling Rapier back from it — `collider.translation()`, say — is a
    // re-entrant call: the obstacle is then *not* excluded even though the predicate returned
    // `false`, and the world's WebAssembly state is left corrupted (`world.free()` afterwards
    // throws "attempted to take ownership of Rust value while it was borrowed"). That is why the
    // runtime caches every one-way platform's world top *before* the move; the corrupt-state half
    // of the measurement is deliberately not reproduced here, because it cannot be cleaned up.
    const world = createWorld({ x: 0, y: 0 });
    const queue = createEventQueue();
    try {
      setTimestep(world, STEP);
      const wall = createBody(world, { ...STATIC, position: { x: 1, y: 0 } });
      const wallCollider = createCollider(world, wall, { kind: "box", halfWidth: 0.2, halfHeight: 5 }, SOLID);
      const character = createBody(world, { ...STATIC, motion: "kinematic", position: { x: -1, y: 0 } });
      const characterCollider = createCollider(world, character, { kind: "circle", radius: 0.2 }, SOLID);
      expect(wallCollider).not.toBeNull();
      if (characterCollider === null) {
        throw new Error("the character collider was refused");
      }
      primeWorld(world, queue);

      const controller = createController(world, 0.01);
      tuneController(controller, {
        slopeLimit: toRadians(45),
        slideLimit: toRadians(45),
        stepOffset: 0,
        stepMinWidth: 0.05,
        snapToGround: 0,
        pushBodies: false,
      });
      const movement = new Vec2();
      try {
        computeControllerMovement(controller, characterCollider, { x: 5, y: 0 }, SOLID.groups, null, movement);
        expect(movement.x).toBeLessThan(2);
        computeControllerMovement(
          controller,
          characterCollider,
          { x: 5, y: 0 },
          SOLID.groups,
          (): boolean => false,
          movement,
        );
        expect(movement.x).toBeCloseTo(5, 3);
      } finally {
        destroyController(world, controller);
      }
    } finally {
      destroyEventQueue(queue);
      destroyWorld(world);
    }
  });

  it("is the main Rapier build, which promises local determinism only", () => {
    // `@dimforge/rapier2d-deterministic-compat` is the cross-platform build; this one is not it.
    expect(version()).toBe("0.20.0");
  });
});
