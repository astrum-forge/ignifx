import { Camera, Light, Model, Vec3 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Animator } from "../../src/animator/animator.js";
import { createThreeDBrowserApp, differingBytes, SETTLE_FRAMES } from "../support/browser-harness.js";
import type { AnimatorAsset } from "../../src/animator/animator-asset.js";
import type { Capture, ThreeDBrowserApp } from "../support/browser-harness.js";
import type { ModelAsset } from "@ignifx/core";

/**
 * `Animator.sample` on a real device (ADR-0028, amendment 2026-10-20): the pose reaches the frame at
 * once, holds in an edit-mode app, and lasts only until the next advance in a playing one. The pose
 * is read from the frame, as in `animator.browser.test.ts`, because Lite keeps joint transforms in a
 * GPU bone texture.
 */

let harness: ThreeDBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge; big enough that a limb swing moves a lot of pixels. */
const CANVAS = 160;

/** How many bytes of the frame have to change before it counts as a different pose. */
const POSE_DELTA_BYTES = 150;

/**
 * Builds a lit scene with the rigged fixture and an animator on it.
 *
 * @param editMode - Whether the app is an edit-mode app.
 * @returns The harness and the animator.
 */
async function loadRig(editMode: boolean): Promise<{ running: ThreeDBrowserApp; animator: Animator }> {
  const running = await createThreeDBrowserApp({ width: CANVAS, height: CANVAS, editMode });
  harness = running;
  const eye = running.world.createEntity("Main Camera", { position: { x: 0, y: 1, z: -1.9 } });
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  eye.transform.lookAt(new Vec3(0, 1, 0));
  running.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });
  const modelHandle = running.app.assets.load<ModelAsset>("3d/rig.glb").retain();
  const animatorHandle = running.app.assets.load<AnimatorAsset>("3d/hero.animator.json").retain();
  const character = running.world.createEntity("Hero");
  character.addComponent(Model, { model: modelHandle });
  const animator = character.addComponent(Animator, { animator: animatorHandle });
  await running.advance(SETTLE_FRAMES);
  await modelHandle.promise;
  await animatorHandle.promise;
  await running.advance(SETTLE_FRAMES);
  return { running, animator };
}

/**
 * Samples a pose and captures the frame that shows it.
 *
 * @param running - The harness.
 * @param pose - The call that samples.
 * @returns The frame.
 */
async function sampled(running: ThreeDBrowserApp, pose: () => boolean): Promise<Capture> {
  expect(pose()).toBe(true);
  await running.advance(2);
  return running.capture();
}

describe("Animator.sample on a real device", () => {
  it("poses a state at a chosen time in an edit-mode app, and the pose holds", async () => {
    const { running, animator } = await loadRig(true);
    const quarter = await sampled(running, () => animator.sample("locomotion", 0.25, { parameters: { speed: 6 } }));
    const threeQuarters = await sampled(running, () =>
      animator.sample("locomotion", 0.75, { parameters: { speed: 6 } }),
    );
    expect(differingBytes(quarter, threeQuarters)).toBeGreaterThan(POSE_DELTA_BYTES);

    const again = await sampled(running, () => animator.sample("locomotion", 0.25, { parameters: { speed: 6 } }));
    expect(differingBytes(quarter, again)).toBe(0);
    // Nothing advances an animator in edit mode, so the sampled pose stays.
    await running.advance(10);
    expect(differingBytes(quarter, await running.capture())).toBe(0);
    expect(animator.normalizedTime()).toBe(0);
  }, 60_000);

  it("reads a blend tree's parameter from the override, else from the animator", async () => {
    const { running, animator } = await loadRig(true);
    const idle = await sampled(running, () => animator.sample("locomotion", 0.25));
    const run = await sampled(running, () => animator.sample("locomotion", 0.25, { parameters: { speed: 6 } }));
    expect(differingBytes(idle, run)).toBeGreaterThan(POSE_DELTA_BYTES);
    animator.setFloat("speed", 6);
    const current = await sampled(running, () => animator.sample("locomotion", 0.25));
    expect(differingBytes(run, current)).toBe(0);
  }, 60_000);

  it("lasts until the next advance in a playing app", async () => {
    const { running, animator } = await loadRig(false);
    running.app.pause();
    animator.play("locomotion");
    animator.advance(0.25);
    await running.advance(2);
    const own = await running.capture();

    const jump = await sampled(running, () => animator.sample("jump", 0.5));
    expect(differingBytes(own, jump)).toBeGreaterThan(POSE_DELTA_BYTES);
    // Paused, the animation system skips this animator, so the sample stays on screen.
    await running.advance(4);
    expect(differingBytes(jump, await running.capture())).toBe(0);

    animator.advance(0);
    await running.advance(2);
    expect(differingBytes(own, await running.capture())).toBe(0);
    expect(animator.currentState()).toBe("locomotion");
  }, 60_000);
});
