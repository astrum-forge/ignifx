import { describe, expect, it } from "vitest";
import { registerFrameCallback, runFrame } from "../../src/lite/loop.js";
import { createHeadlessScene, disposeSceneOnly, type HeadlessScene } from "../../src/lite/scene.js";
import { EXPECTED_HASH } from "./fixtures/determinism-expected.js";
import {
  createDeterminismScene,
  FIXED_STEP_SECONDS,
  hashWorldMatrices,
  NODE_COUNT,
  STEP_COUNT,
  type DeterminismScene,
} from "./fixtures/determinism-scene.js";

/**
 * Spike S1.3 — headless determinism (`docs/plan/engineering-plan.md` Phase 1). The Chromium half of
 * the same comparison lives in `determinism.browser.test.ts` and asserts the same constant.
 */

/** One complete run: a null-engine scene driving one ignifx callback over 50 transform nodes. */
interface Run {
  /** The Lite engine and scene. */
  readonly runtime: HeadlessScene;
  /** The animated node graph. */
  readonly scene: DeterminismScene;
}

/**
 * Builds a run and wires the one ignifx frame callback that drives it.
 *
 * @returns The run.
 */
function createRun(): Run {
  const runtime = createHeadlessScene();
  const scene = createDeterminismScene();
  registerFrameCallback(runtime.scene, (deltaMs) => {
    scene.advance(deltaMs);
  });
  return { runtime, scene };
}

/**
 * Advances a run.
 *
 * @param run - The run to advance.
 * @param steps - How many fixed steps to take.
 */
function step(run: Run, steps: number): void {
  for (let index = 0; index < steps; index += 1) {
    runFrame(run.runtime.engine, run.runtime.scene, FIXED_STEP_SECONDS);
  }
}

/**
 * Releases a run.
 *
 * @param run - The run to release.
 */
function dispose(run: Run): void {
  run.scene.dispose();
  disposeSceneOnly(run.runtime.scene);
}

describe("S1.3 · headless determinism", () => {
  it("produces identical hashes from two independent runs in one process", () => {
    const first = createRun();
    const second = createRun();
    try {
      expect(first.scene.nodes).toHaveLength(NODE_COUNT);
      step(first, STEP_COUNT);
      step(second, STEP_COUNT);
      expect(hashWorldMatrices(first.scene.nodes)).toBe(hashWorldMatrices(second.scene.nodes));
    } finally {
      dispose(first);
      dispose(second);
    }
  });

  it("matches the committed baseline hash", () => {
    const run = createRun();
    try {
      step(run, STEP_COUNT);
      expect(hashWorldMatrices(run.scene.nodes)).toBe(EXPECTED_HASH);
    } finally {
      dispose(run);
    }
  });

  it("does not let two interleaved scenes interfere", () => {
    // CONSTITUTION.md §3.6: two apps in one process are independent, even when their frames are
    // interleaved rather than run to completion one after the other.
    const reference = createRun();
    const first = createRun();
    const second = createRun();
    try {
      step(reference, STEP_COUNT);
      for (let index = 0; index < STEP_COUNT; index += 1) {
        step(first, 1);
        step(second, 1);
      }
      const expected = hashWorldMatrices(reference.scene.nodes);
      expect(hashWorldMatrices(first.scene.nodes)).toBe(expected);
      expect(hashWorldMatrices(second.scene.nodes)).toBe(expected);
    } finally {
      dispose(reference);
      dispose(first);
      dispose(second);
    }
  });

  it("diverges when the step count differs, so the hash really is sensitive", () => {
    const short = createRun();
    const long = createRun();
    try {
      step(short, STEP_COUNT - 1);
      step(long, STEP_COUNT);
      expect(hashWorldMatrices(short.scene.nodes)).not.toBe(hashWorldMatrices(long.scene.nodes));
    } finally {
      dispose(short);
      dispose(long);
    }
  });
});
