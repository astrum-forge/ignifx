import { describe, expect, it } from "vitest";
import { AnimatorAsset } from "../../src/animator/animator-asset.js";
import { Animator } from "../../src/animator/animator.js";
import { ANIMATOR_ASSET_TYPE } from "../../src/animator/definition.js";
import { heroAnimator } from "../support/animator-fixture.js";
import { createThreeDApp } from "../support/harness.js";
import type { ThreeDAppHarness } from "../support/harness.js";
import type { AssetHandle } from "@ignifx/core";

/**
 * The `Animator` component, headless.
 *
 * A headless app poses nothing — there is no model and no Babylon Lite manager — but it runs the
 * whole state machine, which is the point: a game's animation *logic* is testable in CI without a
 * GPU (`docs/architecture/12-3d-toolkit.md` §3).
 */

/**
 * Publishes the hero document as an in-memory asset handle.
 *
 * @param harness - The app harness.
 * @returns The handle, already retained.
 */
function heroHandle(harness: ThreeDAppHarness): AssetHandle<AnimatorAsset> {
  const asset = new AnimatorAsset("memory:hero.animator.json", heroAnimator());
  return harness.app.assets.register(asset, { type: ANIMATOR_ASSET_TYPE }).retain();
}

describe("Animator", () => {
  it("builds its state machine when the document arrives", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const animator = entity.addComponent(Animator);
    expect(animator.isReady).toBe(false);
    expect(animator.currentState()).toBe("");
    expect(animator.normalizedTime()).toBe(0);

    const handle = heroHandle(harness);
    animator.animator = handle;
    harness.step();
    expect(animator.isReady).toBe(true);
    expect(animator.currentState()).toBe("locomotion");
    handle.release();
    harness.dispose();
  });

  it("advances on the app clock and reports state changes and events", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const handle = heroHandle(harness);
    const animator = entity.addComponent(Animator, { animator: handle });
    const entered: string[] = [];
    const exited: string[] = [];
    const events: string[] = [];
    animator.onStateEntered.connect((name) => entered.push(name));
    animator.onStateExited.connect((name) => exited.push(name));
    animator.onEvent.connect((name) => events.push(name));

    harness.step();
    expect(entered).toEqual(["locomotion"]);

    animator.setTrigger("jump");
    harness.stepMany(2);
    expect(animator.currentState()).toBe("jump");

    // The jump clip is one second by default; the `landed` event sits at 0.75.
    harness.stepMany(50);
    expect(events).toContain("landed");
    expect(exited).toContain("locomotion");
    handle.release();
    harness.dispose();
  });

  it("respects time.timeScale and freezes under app.pause()", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const handle = heroHandle(harness);
    const animator = entity.addComponent(Animator, { animator: handle });
    harness.step();

    harness.app.time.timeScale = 0.5;
    harness.stepMany(30);
    // Thirty steps of 1/60 s at half speed is a quarter of the one-second clip; the extra frame is
    // the `harness.step()` above, which ran at the full rate.
    expect(animator.normalizedTime()).toBeCloseTo(0.267, 2);

    harness.app.pause();
    const frozen = animator.normalizedTime();
    harness.stepMany(30);
    expect(animator.normalizedTime()).toBe(frozen);

    harness.app.resume();
    harness.stepMany(30);
    expect(animator.normalizedTime()).toBeGreaterThan(frozen);
    handle.release();
    harness.dispose();
  });

  it("keeps advancing while paused when it opts in", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const handle = heroHandle(harness);
    const animator = entity.addComponent(Animator, { animator: handle, updateWhenPaused: true });
    harness.step();
    harness.app.pause();
    const before = animator.normalizedTime();
    harness.stepMany(30);
    expect(animator.normalizedTime()).toBeGreaterThan(before);
    handle.release();
    harness.dispose();
  });

  it("forwards parameters, play, and crossFade to the machine", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const handle = heroHandle(harness);
    const animator = entity.addComponent(Animator, { animator: handle });
    harness.step();

    animator.setFloat("speed", 4);
    expect(animator.getFloat("speed")).toBe(4);
    animator.setBool("grounded", false);
    expect(animator.getBool("grounded")).toBe(false);

    animator.play("jump");
    expect(animator.currentState()).toBe("jump");
    animator.crossFade("locomotion", 0.3);
    expect(animator.stateMachine?.isInTransition()).toBe(true);
    handle.release();
    harness.dispose();
  });

  it("does nothing at all before its document loads", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const animator = entity.addComponent(Animator);
    // Every one of these is a no-op rather than a throw: a scripted animator that runs a frame
    // early must not take the scene down.
    animator.setFloat("speed", 1);
    animator.setInt("combo", 1);
    animator.setBool("grounded", true);
    animator.setTrigger("jump");
    animator.play("idle");
    animator.crossFade("idle", 0.2);
    expect(animator.getFloat("speed")).toBe(0);
    expect(animator.getBool("grounded")).toBe(false);
    expect(animator.stateMachine).toBeNull();
    expect(animator.lite.manager).toBeNull();
    harness.step();
    harness.dispose();
  });

  it("drops its machine when the handle is cleared", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const handle = heroHandle(harness);
    const animator = entity.addComponent(Animator, { animator: handle });
    harness.step();
    expect(animator.isReady).toBe(true);
    animator.animator = null;
    harness.step();
    expect(animator.isReady).toBe(false);
    handle.release();
    harness.dispose();
  });

  it("takes its speed multiplier from the field", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const handle = heroHandle(harness);
    const animator = entity.addComponent(Animator, { animator: handle, speed: 2 });
    harness.step();
    harness.stepMany(14);
    expect(animator.normalizedTime()).toBeCloseTo(0.5, 2);
    handle.release();
    harness.dispose();
  });

  it("does not advance while disabled", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Hero");
    const handle = heroHandle(harness);
    const animator = entity.addComponent(Animator, { animator: handle });
    harness.stepMany(10);
    const before = animator.normalizedTime();
    animator.enabled = false;
    harness.stepMany(30);
    expect(animator.normalizedTime()).toBe(before);
    handle.release();
    harness.dispose();
  });
});
