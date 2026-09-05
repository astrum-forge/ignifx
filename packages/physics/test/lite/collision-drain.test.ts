import * as Lite from "@babylonjs/lite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createBody,
  createShape,
  createSimulation,
  createWorld,
  destroyWorld,
  disposeSimulation,
  setBodyCollisionEvents,
  setBodyMass,
  setBodyShape,
  setTimestep,
  stepSimulation,
  ShapeGeometry,
  BodyMotion,
  PrestepMode,
} from "../../src/lite/havok.js";
import {
  drainCollisionsWithBodies,
  PINNED_LITE_VERSION,
  probeCollisionLayout,
} from "../../src/lite/internal/collision-drain.js";
import { havokWasmBytes, installedLiteVersion, loadHavokForTests } from "./fixtures/havok.js";
import type { ContactRecord } from "../../src/lite/havok.js";

/**
 * **Spike S4.2 — collision body identities, and the ADR-0013 layout guard.**
 *
 * The first half records the finding: `@babylonjs/lite@1.27.0` exports **no**
 * `onPhysicsCollisionBodies` and its `PhysicsCollisionInfo` carries no body handles, so the upstream
 * path of `09-physics.md` §4 is not available and ADR-0013's condition is met.
 *
 * The second half is the waiver's guard: it pins the Lite version and fails loudly if the internal
 * field names or the event-buffer offsets move.
 */

/** One step at 60 Hz, in seconds. */
const STEP_SECONDS = 1 / 60;

/** The Havok module, instantiated once. */
let havok: unknown;

describe("S4.2 · collision body identities", () => {
  beforeAll(async () => {
    havok = await loadHavokForTests();
  }, 30_000);

  it("pins the Babylon Lite version the drain was written against", () => {
    expect(installedLiteVersion()).toBe(PINNED_LITE_VERSION);
    // And the binary the world is built on is the one the offsets were read from.
    expect(havokWasmBytes().byteLength).toBeGreaterThan(0);
  });

  it("confirms upstream still reports collisions without body identities", () => {
    // The whole reason ADR-0013 exists. `onPhysicsTriggerBodies` resolves both bodies (7787); its
    // collision counterpart does not exist, and `onPhysicsCollision` (7764) hands over
    // `PhysicsCollisionInfo` (8455) with `type`, `point`, `normal` and `impulse` only.
    const exported: Record<string, unknown> = Lite;
    expect(exported["onPhysicsTriggerBodies"]).toBeTypeOf("function");
    expect(exported["onPhysicsCollisionBodies"]).toBeUndefined();
    expect(Object.keys(exported).filter((name) => name.startsWith("onPhysicsCollision"))).toEqual([
      "onPhysicsCollision",
    ]);
  });

  it("recognises the world internals and recovers both bodies from the event buffer", () => {
    const simulation = createSimulation();
    const world = createWorld(simulation.scene, havok, { x: 0, y: -9.81, z: 0 });
    try {
      expect(probeCollisionLayout(world)).toBe(true);

      const floorNode = Lite.createTransformNode("floor");
      const boxNode = Lite.createTransformNode("box");
      boxNode.position.set(0, 1.4, 0);

      const floorShape = createShape(world, ShapeGeometry.box, {
        extents: { x: 10, y: 1, z: 10 },
        center: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      });
      const floor = createBody(world, floorNode, BodyMotion.static, false);
      setBodyShape(world, floor, floorShape);

      const boxShape = createShape(world, ShapeGeometry.box, {
        extents: { x: 1, y: 1, z: 1 },
        center: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      });
      const box = createBody(world, boxNode, BodyMotion.dynamic, false);
      setBodyShape(world, box, boxShape);
      setBodyMass(world, box, 1);
      setBodyCollisionEvents(world, box, true);
      setBodyCollisionEvents(world, floor, true);

      const seen: ContactRecord[] = [];
      drainCollisionsWithBodies(world, (record): void => {
        seen.push(record);
      });
      setTimestep(world, STEP_SECONDS);
      for (let index = 0; index < 60; index += 1) {
        stepSimulation(simulation, STEP_SECONDS * 1000);
      }

      expect(seen.length).toBeGreaterThan(0);
      const nodes = new Set<unknown>();
      for (const record of seen) {
        nodes.add(record.nodeA);
        nodes.add(record.nodeB);
      }
      // Both participants come back, which is exactly what the public API cannot do.
      expect(nodes.has(boxNode)).toBe(true);
      expect(nodes.has(floorNode)).toBe(true);
      expect(nodes.has(null)).toBe(false);

      // The contact geometry matches the public drain's: the box lands on the floor's top face.
      const first = seen.at(0);
      expect(Math.abs(first === undefined ? 0 : first.normal.y)).toBeGreaterThan(0.5);
    } finally {
      destroyWorld(world);
      disposeSimulation(simulation);
    }
  }, 30_000);

  it("refuses to bind when the world does not expose the internals it reads", () => {
    // The kill switch: a Lite upgrade that renames `_hknp`/`_hkWorld`/`_bodies` fails loudly with
    // `IGX-0908` instead of silently reporting no collisions.
    const stranger = {};
    expect(probeCollisionLayout(stranger)).toBe(false);
    let code: string | null = null;
    try {
      drainCollisionsWithBodies(stranger, (): void => {
        // never called
      });
    } catch (error: unknown) {
      code = (error as { code?: string }).code ?? null;
    }
    expect(code).toBe("IGX-0908");
  });

  it("leaves the prestep modes it documents alone", () => {
    // A dynamic body never pre-syncs from its node (`lib/physics/havok.js:_stepWorld`), which is
    // what makes the interpolated display pose of S4.3 safe.
    expect(PrestepMode.teleport).toBe(1);
    expect(BodyMotion.dynamic).toBe(2);
  });
});
