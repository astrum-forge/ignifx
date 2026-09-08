import { Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController2D } from "../../src/components/character-controller.js";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp, FIXED_STEP } from "../support/harness.js";
import type { Physics2DAppHarness } from "../support/harness.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * **Which pose each phase reads** (`docs/architecture/01-lifecycle-and-time.md` §3,
 * `09-physics.md` §1, identical in 2D). `Systems(Update, -900)` writes
 * `lerp(prev, cur, time.fixedStepAlpha)` at the top of `Update`, so `update`, `lateUpdate`,
 * animation, `Camera2DFollow` and the render sync all read the pose the frame presents;
 * `Systems(FixedUpdate, -100)` restores the authoritative pose in front of `scripts.fixedUpdate`, so
 * Rapier never sees a display pose.
 */

/** A frame that is exactly half a fixed step, so `time.fixedStepAlpha` lands on 0.5. */
const HALF_STEP = FIXED_STEP / 2;

/** Metres along +X a driven `CharacterController2D` covers per fixed step. */
const WALK_PER_STEP = 0.05;

/** Samples its entity's pose in `fixedUpdate` and in `lateUpdate`, and optionally walks it. */
class PoseProbe extends Script implements ScriptCallbacks {
  static typeId = "test/PoseProbe2D";

  /** Metres along +X handed to a `CharacterController2D` each step; `0` drives nothing. */
  walk = 0;

  /** What `fixedUpdate` saw, in order. */
  readonly fixedSamples: number[] = [];

  /** What `lateUpdate` saw, in order. */
  readonly lateSamples: number[] = [];

  fixedUpdate(): void {
    this.fixedSamples.push(this.transform.position.x);
    if (this.walk !== 0) {
      this.entity.requireComponent(CharacterController2D).move({ x: this.walk, y: 0 });
    }
  }

  lateUpdate(): void {
    this.lateSamples.push(this.transform.position.x);
  }
}

/** What one {@link measureHalfFrame} run observed. */
interface HalfFrameMeasurement {
  /** The authoritative pose `fixedUpdate` read on the frame before the half-frame. */
  readonly previousFixed: number;
  /** The pose `lateUpdate` read during the half-frame. */
  readonly displayed: number;
  /** The authoritative pose `fixedUpdate` read on the frame after it. */
  readonly currentFixed: number;
  /** `time.fixedStepAlpha` at the end of the half-frame. */
  readonly alpha: number;
  /** How many fixed steps the half-frame ran; `0` is what makes the alpha meaningful. */
  readonly stepsInHalfFrame: number;
}

/**
 * Runs a whole fixed step, then a frame of half a step, then another whole step, recording what the
 * probe saw at each. The middle frame is the one that matters: no fixed step runs in it, so the two
 * authoritative poses either side of it are exactly the `prev` and `cur` the interpolation lerps.
 *
 * @param harness - The app.
 * @param probe - The probe attached to the body under test.
 * @returns The three poses, the alpha, and the step count of the half-frame.
 */
function measureHalfFrame(harness: Physics2DAppHarness, probe: PoseProbe): HalfFrameMeasurement {
  harness.stepMany(10);
  harness.step();
  const previousFixed = probe.fixedSamples.at(-1) ?? Number.NaN;
  const fixedBefore = probe.fixedSamples.length;
  harness.step(HALF_STEP);
  const displayed = probe.lateSamples.at(-1) ?? Number.NaN;
  const alpha = harness.app.time.fixedStepAlpha;
  const stepsInHalfFrame = probe.fixedSamples.length - fixedBefore;
  harness.step();
  return {
    previousFixed,
    displayed,
    currentFixed: probe.fixedSamples.at(-1) ?? Number.NaN,
    alpha,
    stepsInHalfFrame,
  };
}

/**
 * Asserts the shape every {@link measureHalfFrame} run must have: `lateUpdate` sees the display
 * pose, `fixedUpdate` sees the authoritative one.
 *
 * @param measurement - What the run observed.
 */
function expectDisplayPoseBetweenFixedPoses(measurement: HalfFrameMeasurement): void {
  expect(measurement.stepsInHalfFrame).toBe(0);
  expect(measurement.alpha).toBeCloseTo(0.5, 6);
  const low = Math.min(measurement.previousFixed, measurement.currentFixed);
  const high = Math.max(measurement.previousFixed, measurement.currentFixed);
  // (a) the display pose is strictly inside the step, and is exactly its midpoint at alpha 0.5.
  expect(measurement.displayed).toBeGreaterThan(low);
  expect(measurement.displayed).toBeLessThan(high);
  expect(measurement.displayed).toBeCloseTo((measurement.previousFixed + measurement.currentFixed) / 2, 4);
  // (b) the next fixed step reads the authoritative pose, not the display pose left on the entity.
  expect(measurement.currentFixed).not.toBeCloseTo(measurement.displayed, 4);
}

/**
 * **The display pose is written at the top of `Update`, not in `PreRender`** (2026-09-08).
 *
 * `Camera2DFollow` and every hand-written follow camera run in `update`/`lateUpdate`. While the
 * display pose was written in `PreRender` they framed the character where the last fixed step left
 * it, while the renderer drew it at `lerp(prev, cur, alpha)` — up to a fixed step of relative judder
 * every frame, which the pixel-perfect camera turns into a visibly shaking sprite. `fixedUpdate`
 * still sees the authoritative pose, because the restore system at `FixedUpdate −100` runs in front
 * of it.
 */
describe("2D display poses in update and lateUpdate", () => {
  it("gives lateUpdate the interpolated pose and fixedUpdate the authoritative one", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.transform.position = { x: 0, y: 10, z: 0 };
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, { gravityScale: 0, interpolation: "interpolate" });
      const probe = body.addComponent(PoseProbe);
      // Bodies are built at the start of the next fixed step, so the velocity is set after one.
      harness.step();
      rigidbody.linearVelocity = { x: 6, y: 0 };

      expectDisplayPoseBetweenFixedPoses(measureHalfFrame(harness, probe));
    } finally {
      harness.dispose();
    }
  });

  it("does the same for a character controller", async () => {
    const harness = await createPhysics2DApp();
    try {
      const hero = harness.world.createEntity("Hero");
      hero.transform.position = { x: 0, y: 1, z: 0 };
      hero.addComponent(CharacterController2D, { interpolation: "interpolate" });
      const probe = hero.addComponent(PoseProbe);
      probe.walk = WALK_PER_STEP;

      expectDisplayPoseBetweenFixedPoses(measureHalfFrame(harness, probe));
    } finally {
      harness.dispose();
    }
  });

  it("leaves lateUpdate on the last fixed pose when interpolation is off", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.transform.position = { x: 0, y: 10, z: 0 };
      body.addComponent(BoxCollider2D);
      const rigidbody = body.addComponent(Rigidbody2D, { gravityScale: 0, interpolation: "none" });
      const probe = body.addComponent(PoseProbe);
      // Bodies are built at the start of the next fixed step, so the velocity is set after one.
      harness.step();
      rigidbody.linearVelocity = { x: 6, y: 0 };

      const measurement = measureHalfFrame(harness, probe);
      expect(measurement.stepsInHalfFrame).toBe(0);
      // Nothing is written between steps, so the half-frame shows the pose the last step produced.
      expect(measurement.displayed).toBeCloseTo(measurement.currentFixed, 6);
    } finally {
      harness.dispose();
    }
  });
});
