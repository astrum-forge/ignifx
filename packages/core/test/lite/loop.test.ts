import { describe, expect, it } from "vitest";
import {
  registerFrameCallback,
  runFrame,
  unregisterFrameCallback,
  type FrameCallbackHandle,
} from "../../src/lite/loop.js";
import { createHeadlessScene, disposeSceneOnly } from "../../src/lite/scene.js";

/**
 * Spike S1.2 — the single-callback loop (`docs/plan/engineering-plan.md` Phase 1). The Havok half
 * of the spike lives in `havok-order.test.ts`.
 */

/** One frame at 60 Hz, in seconds. */
const FIXED_STEP_SECONDS = 1 / 60;

/** The same frame in the milliseconds Lite works in. */
const FIXED_STEP_MS = 1000 / 60;

describe("S1.2 · the ignifx frame callback", () => {
  it("runs callbacks in reverse registration order", () => {
    // `docs/architecture/00-overview.md` §3.1: Lite unshifts, so the last registration runs first.
    // This is why the world registers its callback after every extension has registered.
    const { engine, scene } = createHeadlessScene();
    try {
      const order: string[] = [];
      registerFrameCallback(scene, () => {
        order.push("A");
      });
      registerFrameCallback(scene, () => {
        order.push("B");
      });

      runFrame(engine, scene, FIXED_STEP_SECONDS);

      expect(order).toEqual(["B", "A"]);
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("delivers exactly the delta the step was given, converted from seconds to milliseconds", () => {
    const { engine, scene } = createHeadlessScene();
    try {
      const deltas: number[] = [];
      registerFrameCallback(scene, (deltaMs) => {
        deltas.push(deltaMs);
      });

      runFrame(engine, scene, FIXED_STEP_SECONDS);
      runFrame(engine, scene, 0.25);

      // Not "approximately": `(1 / 60) * 1000` and `1000 / 60` are the same double, and Lite
      // hands `engine._currentDelta` to the callback untouched.
      expect(deltas).toEqual([FIXED_STEP_MS, 250]);
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("ignores the step delta once scene.fixedDeltaMs is set", () => {
    // Recorded as a trap, not as behaviour ignifx uses: `scene._update` prefers `fixedDeltaMs` over
    // the engine's current delta, so the adapter must leave it at its default of 0.
    const { engine, scene } = createHeadlessScene();
    try {
      const deltas: number[] = [];
      registerFrameCallback(scene, (deltaMs) => {
        deltas.push(deltaMs);
      });
      expect(scene.fixedDeltaMs).toBe(0);

      scene.fixedDeltaMs = 8;
      runFrame(engine, scene, FIXED_STEP_SECONDS);

      expect(deltas).toEqual([8]);
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("stops calling through once the handle is deactivated", () => {
    // ADR-0003: Lite has no unregister, so the wrapper stays in `_beforeRender` forever and the
    // handle is what makes it inert.
    const { engine, scene } = createHeadlessScene();
    try {
      let calls = 0;
      const handle = registerFrameCallback(scene, () => {
        calls += 1;
      });
      expect(handle.isActive).toBe(true);

      runFrame(engine, scene, FIXED_STEP_SECONDS);
      expect(calls).toBe(1);

      unregisterFrameCallback(handle);
      expect(handle.isActive).toBe(false);

      runFrame(engine, scene, FIXED_STEP_SECONDS);
      runFrame(engine, scene, FIXED_STEP_SECONDS);
      expect(calls).toBe(1);

      // Deactivating twice is a no-op.
      unregisterFrameCallback(handle);
      expect(handle.isActive).toBe(false);
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("deactivates one callback without touching the others", () => {
    const { engine, scene } = createHeadlessScene();
    try {
      const order: string[] = [];
      const first: FrameCallbackHandle = registerFrameCallback(scene, () => {
        order.push("first");
      });
      registerFrameCallback(scene, () => {
        order.push("second");
      });

      unregisterFrameCallback(first);
      runFrame(engine, scene, FIXED_STEP_SECONDS);

      expect(order).toEqual(["second"]);
    } finally {
      disposeSceneOnly(scene);
    }
  });

  it("keeps two scenes in one process independent", () => {
    // CONSTITUTION.md §3.6.
    const first = createHeadlessScene();
    const second = createHeadlessScene();
    try {
      let firstCalls = 0;
      let secondCalls = 0;
      registerFrameCallback(first.scene, () => {
        firstCalls += 1;
      });
      registerFrameCallback(second.scene, () => {
        secondCalls += 1;
      });

      runFrame(first.engine, first.scene, FIXED_STEP_SECONDS);
      runFrame(first.engine, first.scene, FIXED_STEP_SECONDS);
      runFrame(second.engine, second.scene, FIXED_STEP_SECONDS);

      expect(firstCalls).toBe(2);
      expect(secondCalls).toBe(1);
      expect(first.engine).not.toBe(second.engine);
    } finally {
      disposeSceneOnly(first.scene);
      disposeSceneOnly(second.scene);
    }
  });

  it("runs a callback exactly once per step, with no hidden accumulator", () => {
    const { engine, scene } = createHeadlessScene();
    try {
      let calls = 0;
      registerFrameCallback(scene, () => {
        calls += 1;
      });
      for (let index = 0; index < 600; index += 1) {
        runFrame(engine, scene, FIXED_STEP_SECONDS);
      }
      expect(calls).toBe(600);
    } finally {
      disposeSceneOnly(scene);
    }
  });
});
