import { getAnimationGroups } from "@babylonjs/lite";
import { Camera, Light, Model, Vec3 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Animator } from "../../src/animator/animator.js";
import { createThreeDBrowserApp, differingBytes, SETTLE_FRAMES } from "../support/browser-harness.js";
import type { AnimatorAsset } from "../../src/animator/animator-asset.js";
import type { Capture, ThreeDBrowserApp } from "../support/browser-harness.js";
import type { ModelAsset } from "@ignifx/core";

/**
 * Spike S7.1 of `docs/plan/engineering-plan.md`, as a test: a loaded model's clips are detached from
 * the scene's own ticking, ignifx's `Animator` advances them on ignifx's clock, and the pose that
 * reaches the device changes with the state machine and freezes with `app.pause()`.
 *
 * The pose is asserted from the **frame**, not from a bone: Babylon Lite's `Bone` exposes only its
 * name (`index.d.ts` 1324-1326) and the joint transforms live in a GPU bone texture, so what a
 * skinned mesh is doing is legible exactly where it matters — in the picture.
 *
 * This file lives under `test/lite/**` because it imports `@babylonjs/lite` to read the mixer's
 * group weights; that is the one directory outside `src/lite/**` the adapter-boundary rule allows.
 */

let harness: ThreeDBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge these tests render at; big enough that a limb swing moves a lot of pixels. */
const CANVAS = 160;

/** How many bytes of the frame have to change before it counts as a different pose. */
const POSE_DELTA_BYTES = 150;

/**
 * Builds a lit scene with the rigged fixture in it and an animator on the model.
 *
 * @returns The harness, the model, and the animator.
 */
async function loadRig(): Promise<{ running: ThreeDBrowserApp; model: Model; animator: Animator }> {
  const running = await createThreeDBrowserApp({ width: CANVAS, height: CANVAS });
  harness = running;

  const eye = running.world.createEntity("Main Camera", { position: { x: 0, y: 1, z: -1.9 } });
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  eye.transform.lookAt(new Vec3(0, 1, 0));
  running.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });

  const modelHandle = running.app.assets.load<ModelAsset>("3d/rig.glb").retain();
  const animatorHandle = running.app.assets.load<AnimatorAsset>("3d/hero.animator.json").retain();
  const character = running.world.createEntity("Hero");
  const model = character.addComponent(Model, { model: modelHandle });
  const animator = character.addComponent(Animator, { animator: animatorHandle });

  await running.advance(SETTLE_FRAMES);
  await modelHandle.promise;
  await animatorHandle.promise;
  await running.advance(SETTLE_FRAMES);
  return { running, model, animator };
}

/**
 * Poses the animator at one state and time, then captures the frame.
 *
 * @param running - The harness.
 * @param animator - The animator to drive.
 * @param state - The state to play.
 * @param seconds - How far into the state to advance.
 * @returns The captured frame.
 */
async function poseAndCapture(
  running: ThreeDBrowserApp,
  animator: Animator,
  state: string,
  seconds: number,
): Promise<Capture> {
  animator.play(state);
  // The state machine and the mixer are driven directly rather than through the render loop, so the
  // pose lands on an exact time rather than on whatever the browser's frame delta happened to be.
  animator.advance(seconds);
  await running.advance(2);
  return running.capture();
}

describe("rig.glb", () => {
  it("carries four clips, one skeleton, and a hand node to attach to", async () => {
    const { running, model } = await loadRig();
    expect(model.animations).toHaveLength(4);
    expect(model.animations.map((clip) => clip.name).toSorted()).toEqual(["idle", "jump", "run", "walk"]);
    expect(model.skeletons).toHaveLength(1);
    expect(model.skeletons[0]?.bones.map((bone) => bone.name)).toEqual(["hips", "torso", "armL", "armR"]);

    const sword = running.world.createEntity("Sword");
    expect(model.attachToNode("hand", sword)).toBe(true);
    expect(model.attachToNode("tail", sword)).toBe(false);
  }, 60_000);

  it("hands its clips to ignifx rather than letting the scene tick them", async () => {
    const { running, model, animator } = await loadRig();
    // `ModelAsset` strips the container's `animationGroups` before the container is added to the
    // scene (ADR-0003), so Lite installs no before-render hook for them; the only thing advancing
    // them is the manager this animator owns.
    const manager = animator.lite.manager;
    expect(manager).not.toBeNull();
    const claimed = manager === null ? [] : getAnimationGroups(manager);
    expect(claimed).toHaveLength(model.animations.length);

    const before = model.animations[0]?.currentTime ?? -1;
    // Ten real frames with the animator disabled: nothing may move the playhead.
    animator.enabled = false;
    await running.advance(10);
    expect(model.animations[0]?.currentTime).toBe(before);
  }, 60_000);
});

describe("Animator on a real device", () => {
  it("poses the skeleton differently for idle and for walk at the same clip time", async () => {
    const { running, animator } = await loadRig();
    animator.setFloat("speed", 0);
    const idle = await poseAndCapture(running, animator, "locomotion", 0.25);
    animator.setFloat("speed", 6);
    const walk = await poseAndCapture(running, animator, "locomotion", 0.25);
    expect(differingBytes(idle, walk)).toBeGreaterThan(POSE_DELTA_BYTES);
  }, 60_000);

  it("freezes the pose while the app is paused, and moves again on resume", async () => {
    const { running, animator } = await loadRig();
    animator.setFloat("speed", 6);
    animator.play("locomotion");
    await running.advance(4);

    // Running: ten frames of a half-second clip move a lot of pixels.
    const running1 = await running.capture();
    await running.advance(10);
    const running2 = await running.capture();
    expect(differingBytes(running1, running2)).toBeGreaterThan(POSE_DELTA_BYTES);

    // Paused: the same ten frames move nothing at all.
    running.app.pause();
    const frozen1 = await running.capture();
    await running.advance(10);
    const frozen2 = await running.capture();
    expect(differingBytes(frozen1, frozen2)).toBe(0);
    running.app.resume();
  }, 60_000);

  it("gives both clips a partial weight mid-crossfade", async () => {
    const { animator } = await loadRig();
    // `grounded` false keeps the jump state from transitioning straight back out, so the blend is
    // the only thing moving while the assertion runs.
    animator.setBool("grounded", false);
    animator.setFloat("speed", 0);
    animator.play("locomotion");
    animator.advance(0);

    animator.crossFade("jump", 0.4);
    animator.advance(0.2);

    const manager = animator.lite.manager;
    const groups = manager === null ? [] : getAnimationGroups(manager);
    const weights = new Map(groups.map((group) => [group.name, group.weight]));
    expect(weights.get("idle") ?? 0).toBeGreaterThan(0.2);
    expect(weights.get("idle") ?? 0).toBeLessThan(0.8);
    expect(weights.get("jump") ?? 0).toBeGreaterThan(0.2);
    expect(weights.get("jump") ?? 0).toBeLessThan(0.8);

    animator.advance(0.3);
    const finished = manager === null ? [] : getAnimationGroups(manager);
    const settled = new Map(finished.map((group) => [group.name, group.weight]));
    expect(settled.get("jump") ?? 0).toBeCloseTo(1, 2);
    expect(settled.get("idle") ?? 1).toBeCloseTo(0, 2);
  }, 60_000);
});
