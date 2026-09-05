import { Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { createPhysicsApp } from "../support/harness.js";
import type { InterpolationMode } from "../../src/components/rigidbody.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * **Spike S4.3 — interpolation never leaks into Havok.**
 *
 * `PreRender` writes `lerp(prev, cur, alpha)` into the entity's node, and `Systems(FixedUpdate, -100)`
 * puts the authoritative pose back before anything reads it. A script's `fixedUpdate` runs *after*
 * that restore, so what it observes is the authoritative pose — which is what these tests record and
 * compare between an interpolated app and one with interpolation switched off.
 */

/** A frame delta that is not a whole number of fixed steps, so `fixedStepAlpha` is rarely zero. */
const IRREGULAR_DELTA = 1 / 40;

/** Records the authoritative Y of its entity on every fixed step. */
class TrackY extends Script implements ScriptCallbacks {
  static typeId = "test/TrackY";

  /** Every authoritative Y this script has seen. */
  readonly samples: number[] = [];

  fixedUpdate(): void {
    this.samples.push(this.transform.position.y);
  }
}

/** Drives a kinematic body along X, one centimetre per fixed step. */
class DriveX extends Script implements ScriptCallbacks {
  static typeId = "test/DriveX";

  /** Every authoritative X this script has seen at the top of a step. */
  readonly samples: number[] = [];

  #steps = 0;

  fixedUpdate(): void {
    this.samples.push(this.transform.position.x);
    this.#steps += 1;
    this.transform.position = { x: this.#steps * 0.01, y: 2, z: 0 };
  }
}

describe("S4.3 · interpolation", () => {
  it("gives a dynamic body the same simulation with and without a display pose", async () => {
    const interpolated = await run("interpolate");
    const plain = await run("none");
    // Bit-identical: a display pose written into the node between steps must never reach Havok,
    // and a DYNAMIC body never pre-syncs from its node (`lib/physics/havok.js:_stepWorld`).
    expect(interpolated.samples).toEqual(plain.samples);
    expect(interpolated.samples.length).toBeGreaterThan(20);
  }, 30_000);

  it("writes a display pose that differs from the authoritative one between steps", async () => {
    const harness = await createPhysicsApp();
    try {
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 10, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "interpolate" });
      const tracker = box.addComponent(TrackY);

      // Five frames of 1/40 s cover 7.5 fixed steps, so the app ends half-way through a step and
      // the node holds a genuinely interpolated pose. (Four frames would land on 6.0 steps exactly,
      // where alpha is 0 and interpolation is the identity.)
      for (let index = 0; index < 5; index += 1) {
        harness.step(IRREGULAR_DELTA);
      }
      expect(harness.app.time.fixedStepAlpha).toBeGreaterThan(0);
      const authoritative = tracker.samples.at(-1) ?? 0;
      const displayed = box.transform.position.y;
      expect(displayed).not.toBe(authoritative);
      // The display pose is between the two snapshots, never beyond them.
      expect(displayed).toBeLessThanOrEqual(tracker.samples.at(-1) ?? 0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("restores a kinematic body's authoritative pose before fixedUpdate", async () => {
    const interpolated = await runKinematic("interpolate");
    const plain = await runKinematic("none");
    // The interpolated app sees exactly the poses it wrote, not the display poses `PreRender` left
    // on the node — otherwise the kinematic body would drift and Havok would be dragged with it.
    expect(interpolated).toEqual(plain);
    expect(interpolated.at(-1)).toBeGreaterThan(0);
  }, 30_000);
});

/**
 * Drops a box for 40 irregular frames and returns the tracker that recorded its authoritative pose.
 *
 * @param interpolation - Which interpolation mode the body uses.
 * @returns The tracking script.
 */
async function run(interpolation: InterpolationMode): Promise<TrackY> {
  const harness = await createPhysicsApp();
  try {
    const box = harness.world.createEntity("Box");
    box.transform.position = { x: 0, y: 10, z: 0 };
    box.addComponent(BoxCollider);
    box.addComponent(Rigidbody, { interpolation });
    const tracker = box.addComponent(TrackY);
    for (let index = 0; index < 40; index += 1) {
      harness.step(IRREGULAR_DELTA);
    }
    return tracker;
  } finally {
    harness.dispose();
  }
}

/**
 * Drives a kinematic body for 40 irregular frames and returns the poses its script observed.
 *
 * @param interpolation - Which interpolation mode the body uses.
 * @returns The authoritative X at the top of each step.
 */
async function runKinematic(interpolation: InterpolationMode): Promise<readonly number[]> {
  const harness = await createPhysicsApp();
  try {
    const platform = harness.world.createEntity("Platform");
    platform.transform.position = { x: 0, y: 2, z: 0 };
    platform.addComponent(BoxCollider, { size: { x: 2, y: 0.5, z: 2 } });
    platform.addComponent(Rigidbody, { bodyType: "kinematic", interpolation });
    const driver = platform.addComponent(DriveX);
    for (let index = 0; index < 40; index += 1) {
      harness.step(IRREGULAR_DELTA);
    }
    return [...driver.samples];
  } finally {
    harness.dispose();
  }
}
