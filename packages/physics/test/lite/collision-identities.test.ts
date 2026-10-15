import * as Lite from "@babylonjs/lite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BodyMotion,
  CONTACT_STARTED,
  createBody,
  createShape,
  createSimulation,
  createWorld,
  destroyWorld,
  disposeSimulation,
  onCollisionEvents,
  setBodyCollisionEvents,
  setBodyMass,
  setBodyShape,
  setTimestep,
  ShapeGeometry,
  stepSimulation,
} from "../../src/lite/havok.js";
import { loadHavokForTests } from "./fixtures/havok.js";
import type { ContactRecord } from "../../src/lite/havok.js";

/**
 * Collision body identities through Babylon Lite's public `onPhysicsCollision`. Lite reports both
 * bodies as `collider` and `collidedAgainst` (`index.d.ts` 10030), which is what retired the
 * ADR-0013 drain. These tests drive real Havok bodies into contact, with no mock in between.
 */

/** One step at 60 Hz, in seconds. */
const STEP_SECONDS = 1 / 60;

/** The Havok module, instantiated once. */
let havok: unknown;

describe("collision body identities", () => {
  beforeAll(async () => {
    havok = await loadHavokForTests();
  }, 30_000);

  it("uses the one public collision API Lite exports", () => {
    const exported: Record<string, unknown> = Lite;
    expect(Object.keys(exported).filter((name) => name.startsWith("onPhysicsCollision"))).toEqual([
      "onPhysicsCollision",
    ]);
  });

  it("reports both bodies of a real contact through the public drain", () => {
    const simulation = createSimulation();
    const world = createWorld(simulation.scene, havok, { x: 0, y: -9.81, z: 0 });
    try {
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
      onCollisionEvents(world, (record): void => {
        seen.push(record);
      });
      setTimestep(world, STEP_SECONDS);
      for (let index = 0; index < 60; index += 1) {
        stepSimulation(simulation, STEP_SECONDS * 1000);
      }

      expect(seen.length).toBeGreaterThan(0);
      for (const record of seen) {
        // Every event names exactly this pair, in one order or the other.
        expect(new Set([record.nodeA, record.nodeB])).toEqual(new Set([boxNode, floorNode]));
      }
      const first = seen.at(0);
      expect(first?.phase).toBe(CONTACT_STARTED);
      // The box lands on the floor's top face.
      expect(Math.abs(first === undefined ? 0 : first.normal.y)).toBeGreaterThan(0.5);
    } finally {
      destroyWorld(world);
      disposeSimulation(simulation);
    }
  }, 30_000);
});
