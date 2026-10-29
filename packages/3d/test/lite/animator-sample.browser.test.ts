import { Camera, Light, Model, Vec3 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { AnimatorAsset } from "../../src/animator/animator-asset.js";
import { Animator } from "../../src/animator/animator.js";
import { ANIMATOR_ASSET_TYPE, defineAnimator } from "../../src/animator/definition.js";
import { createThreeDBrowserApp, differingBytes, SETTLE_FRAMES } from "../support/browser-harness.js";
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

/** A two-layer document: `run` on the base layer, and arm states on an upper layer masked to the arms. */
const LAYERED = defineAnimator(
  {
    layers: [
      { name: "Base", weight: 1, defaultState: "run" },
      { name: "Arms", weight: 1, mask: ["armL", "armR"], maskMode: "include", defaultState: "armsIdle" },
    ],
    states: [
      { name: "run", clip: "run", layer: "Base" },
      { name: "armsIdle", clip: "idle", layer: "Arms" },
      { name: "armsJump", clip: "jump", layer: "Arms" },
      { name: "armsWave", clip: "wave", layer: "Arms" },
    ],
  },
  "memory:layered.animator.json",
);

/**
 * Builds a lit scene with the rigged fixture and an animator on it.
 *
 * @param editMode - Whether the app is an edit-mode app.
 * @param layered - Whether the animator runs {@link LAYERED} rather than the hero document.
 * @returns The harness, the model, and the animator.
 */
async function loadRig(
  editMode: boolean,
  layered = false,
): Promise<{ running: ThreeDBrowserApp; model: Model; animator: Animator }> {
  const running = await createThreeDBrowserApp({ width: CANVAS, height: CANVAS, editMode });
  harness = running;
  const eye = running.world.createEntity("Main Camera", { position: { x: 0, y: 1, z: -1.9 } });
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  eye.transform.lookAt(new Vec3(0, 1, 0));
  running.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });
  const modelHandle = running.app.assets.load<ModelAsset>("3d/rig.glb").retain();
  const animatorHandle = layered
    ? running.app.assets
        .register(new AnimatorAsset("memory:layered.animator.json", LAYERED), { type: ANIMATOR_ASSET_TYPE })
        .retain()
    : running.app.assets.load<AnimatorAsset>("3d/hero.animator.json").retain();
  const character = running.world.createEntity("Hero");
  const model = character.addComponent(Model, { model: modelHandle });
  const animator = character.addComponent(Animator, { animator: animatorHandle });
  await running.advance(SETTLE_FRAMES);
  await modelHandle.promise;
  await animatorHandle.promise;
  // The model's rebuild runs between frames for as long as the machine takes: wait for it, not for
  // a frame count, or the first capture can show the renderables from before it landed.
  await running.settle();
  return { running, model, animator };
}

/**
 * Samples a pose and captures the frame that shows it, once the frame has stopped changing.
 *
 * @param running - The harness.
 * @param pose - The call that samples.
 * @returns The frame.
 */
async function sampled(running: ThreeDBrowserApp, pose: () => boolean): Promise<Capture> {
  expect(pose()).toBe(true);
  await running.advance(2);
  return running.stableCapture();
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

  it("shows a one-shot state's last key at 1, also when clamped from beyond it", async () => {
    const { running, model, animator } = await loadRig(true);
    const jump = model.animations.find((clip) => clip.name === "jump");
    expect(jump).toBeDefined();
    // The rig's clips start and end on the same key, so the playhead Lite evaluated is the
    // evidence: a looping group would have wrapped a playhead at the end back to 0.
    expect(animator.sample("jump", 0)).toBe(true);
    expect(jump?.currentTime).toBe(0);
    const end = await sampled(running, () => animator.sample("jump", 1));
    expect(jump?.currentTime).toBeCloseTo(jump?.duration ?? -1, 6);
    expect(jump?.currentTime).toBeGreaterThan(0);
    const clamped = await sampled(running, () => animator.sample("jump", 1.25));
    expect(jump?.currentTime).toBeCloseTo(jump?.duration ?? -1, 6);
    expect(differingBytes(end, clamped)).toBe(0);
  }, 60_000);

  it("keeps looping a looping state in play", async () => {
    const { running, model, animator } = await loadRig(false);
    running.app.pause();
    animator.setFloat("speed", 6);
    animator.play("locomotion");
    const run = model.animations.find((clip) => clip.name === "run");
    // A blend tree lasts as long as its longest child, the one-second idle.
    animator.advance(0.25);
    await running.advance(2);
    const quarter = await running.capture();
    // One and a quarter cycles: the machine wraps, and so does the pose.
    animator.advance(1);
    await running.advance(2);
    expect(animator.normalizedTime()).toBeCloseTo(0.25, 6);
    expect(run?.currentTime).toBeCloseTo(0.125, 6);
    expect(differingBytes(quarter, await running.capture())).toBe(0);
    animator.advance(0.5);
    await running.advance(2);
    expect(differingBytes(quarter, await running.capture())).toBeGreaterThan(POSE_DELTA_BYTES);
  }, 60_000);

  it("keeps the other layers' pose when it samples a masked layer's state", async () => {
    const { running, animator } = await loadRig(true, true);
    // The base layer's run at a quarter, then at three quarters: opposite swings of the hips.
    animator.advance(0.125);
    const early = await sampled(running, () => animator.sample("armsJump", 0.5));
    animator.advance(0.25);
    const late = await sampled(running, () => animator.sample("armsJump", 0.5));
    expect(animator.currentState("Base")).toBe("run");
    // Were the base layer dropped, both frames would show the hips at rest and be identical.
    expect(differingBytes(early, late)).toBeGreaterThan(POSE_DELTA_BYTES);
  }, 60_000);

  it("answers false for a state whose clip the model lacks, and still poses the rest", async () => {
    const { running, animator } = await loadRig(true, true);
    animator.advance(0.125);
    const base = await sampled(running, () => animator.sample("armsJump", 0.5));
    expect(animator.sample("armsWave", 0.5)).toBe(false);
    await running.advance(2);
    // The base layer's run is still written; only the arms lose the jump.
    expect(differingBytes(base, await running.capture())).toBeGreaterThan(0);
    expect(animator.sample("run", 0.25)).toBe(true);
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
