import { describe, expect, it } from "vitest";
import { createPhysicsApp } from "../support/harness.js";
import { EXPECTED_PHYSICS_HASH } from "./fixtures/expected.js";
import { buildPhysicsDeterminismScene, hashPoses, STEP_COUNT } from "./fixtures/physics-scene.js";
import type { PhysicsAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * Physics determinism (`docs/architecture/09-physics.md` §8, exit criterion of Phase 4): the same
 * scene, the same number of fixed steps, the same poses — across two apps in one process, across
 * interleaved runs, and against a **committed** hash, which is what makes consecutive process runs
 * comparable at all (each `vitest run` is a fresh process, so the committed constant is the
 * cross-run assertion).
 */

/** One prepared determinism run. */
interface Run {
  /** The harness, so the caller disposes it. */
  readonly harness: PhysicsAppHarness;
  /** The dynamic bodies, in creation order. */
  readonly bodies: readonly Entity[];
}

/**
 * Builds a headless app with the determinism scene in it.
 *
 * @returns The run.
 */
async function createRun(): Promise<Run> {
  const harness = await createPhysicsApp();
  return { harness, bodies: buildPhysicsDeterminismScene(harness.world) };
}

describe("physics determinism", () => {
  it("reproduces the committed baseline hash after 600 fixed steps", async () => {
    const run = await createRun();
    try {
      run.harness.stepMany(STEP_COUNT);
      expect(hashPoses(run.bodies)).toBe(EXPECTED_PHYSICS_HASH);
    } finally {
      run.harness.dispose();
    }
  }, 60_000);

  it("produces the same hash from two apps, interleaved or not", async () => {
    const first = await createRun();
    const second = await createRun();
    try {
      for (let index = 0; index < STEP_COUNT; index += 1) {
        first.harness.step();
        second.harness.step();
      }
      const interleaved = hashPoses(first.bodies);
      expect(hashPoses(second.bodies)).toBe(interleaved);
      expect(interleaved).toBe(EXPECTED_PHYSICS_HASH);
    } finally {
      first.harness.dispose();
      second.harness.dispose();
    }
  }, 60_000);

  it("settles the pile, so the hash is of a real simulation rather than of free fall", async () => {
    const run = await createRun();
    try {
      run.harness.stepMany(STEP_COUNT);
      for (const body of run.bodies) {
        // Everything has landed on the floor (top at y = 0.5) and nothing has escaped sideways.
        expect(body.transform.position.y).toBeGreaterThan(0.4);
        expect(body.transform.position.y).toBeLessThan(12);
        expect(Math.abs(body.transform.position.x)).toBeLessThan(10);
      }
    } finally {
      run.harness.dispose();
    }
  }, 60_000);
});
