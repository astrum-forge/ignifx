import { describe, expect, it } from "vitest";
import { createPhysics2DApp } from "../support/harness.js";
import { EXPECTED_PHYSICS_2D_HASH } from "./fixtures/expected.js";
import { build2DDeterminismScene, hash2DPoses, STEP_COUNT } from "./fixtures/physics-2d-scene.js";
import type { Physics2DAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * 2D physics determinism (`docs/architecture/09-physics.md` §8, ADR-0006, Phase 6 exit criterion):
 * the same scene, the same number of fixed steps, the same poses — across two apps in one process,
 * across interleaved runs, and against a **committed** hash, which is what makes consecutive process
 * runs comparable at all (each `vitest run` is a fresh process).
 */

/** One prepared determinism run. */
interface Run {
  /** The harness, so the caller disposes it. */
  readonly harness: Physics2DAppHarness;
  /** The dynamic bodies, in creation order. */
  readonly bodies: readonly Entity[];
}

/**
 * Builds a headless app with the determinism scene in it.
 *
 * @returns The run.
 */
async function createRun(): Promise<Run> {
  const harness = await createPhysics2DApp();
  return { harness, bodies: build2DDeterminismScene(harness.world) };
}

describe("2D physics determinism", () => {
  it("reproduces the committed baseline hash after 600 fixed steps", async () => {
    const run = await createRun();
    try {
      run.harness.stepMany(STEP_COUNT);
      expect(hash2DPoses(run.bodies)).toBe(EXPECTED_PHYSICS_2D_HASH);
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
      const interleaved = hash2DPoses(first.bodies);
      expect(hash2DPoses(second.bodies)).toBe(interleaved);
      expect(interleaved).toBe(EXPECTED_PHYSICS_2D_HASH);
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
        // Everything has landed on the floor (top at y = 0) and nothing has escaped sideways.
        expect(body.transform.position.y).toBeGreaterThan(0.4);
        expect(body.transform.position.y).toBeLessThan(12);
        expect(Math.abs(body.transform.position.x)).toBeLessThan(10);
      }
    } finally {
      run.harness.dispose();
    }
  }, 60_000);
});
