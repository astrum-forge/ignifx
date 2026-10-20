import { Model, ModelAsset } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { AnimatorAsset } from "../../src/animator/animator-asset.js";
import { Animator } from "../../src/animator/animator.js";
import { ANIMATOR_ASSET_TYPE } from "../../src/animator/definition.js";
import { AnimatorStateMachine } from "../../src/animator/state-machine.js";
import { ThreeDErrorCode } from "../../src/errors.js";
import { heroAnimator } from "../support/animator-fixture.js";
import { createThreeDApp } from "../support/harness.js";
import type { ClipSample, StateChange } from "../../src/animator/state-machine.js";
import type { ThreeDAppHarness } from "../support/harness.js";
import type { AssetHandle, Entity } from "@ignifx/core";

/**
 * `Animator.sample` and `AnimatorStateMachine.sample`, headless (ADR-0028, amendment 2026-10-20).
 *
 * A headless app has no clips to pose, so the pose itself is asserted from the machine's sample:
 * which clips, at what weight, with the playhead where. The browser suite checks the frame.
 */

/**
 * Builds a hero machine with every clip one second long, its first state entries drained.
 *
 * @returns The machine.
 */
function heroMachine(): AnimatorStateMachine {
  const machine = new AnimatorStateMachine(heroAnimator());
  for (const clip of ["idle", "walk", "run", "jump"]) {
    machine.setClipLength(clip, 1);
  }
  machine.drainStateChanges([]);
  return machine;
}

/**
 * The clips of a sample as `clip@weight/time` strings, rounded, for compact comparison.
 *
 * @param clips - The sample.
 * @returns One string per clip.
 */
function summary(clips: readonly ClipSample[]): string[] {
  return clips.map((clip) => `${clip.clip}@${clip.weight.toFixed(2)}/${clip.normalizedTime.toFixed(2)}`);
}

/**
 * Expects a call to throw an `IgnifxError` with a code.
 *
 * @param call - The call.
 * @param code - The code.
 */
function expectCode(call: () => unknown, code: string): void {
  expect(call).toThrow(expect.objectContaining({ code }));
}

describe("AnimatorStateMachine.sample", () => {
  it("poses a one-shot state at 0, 0.5 and 1", () => {
    const machine = heroMachine();
    expect(summary(machine.sample("jump", 0))).toEqual(["jump@1.00/0.00"]);
    expect(summary(machine.sample("jump", 0.5))).toEqual(["jump@1.00/0.50"]);
    expect(summary(machine.sample("jump", 1))).toEqual(["jump@1.00/1.00"]);
  });

  it("clamps a one-shot state's time and wraps a looping state's", () => {
    const machine = heroMachine();
    expect(machine.sample("jump", -0.5)[0]?.normalizedTime).toBe(0);
    expect(machine.sample("jump", 1.5)[0]?.normalizedTime).toBe(1);
    expect(machine.sample("locomotion", 1)[0]?.normalizedTime).toBe(1);
    expect(machine.sample("locomotion", 1.25)[0]?.normalizedTime).toBeCloseTo(0.25, 9);
    expect(machine.sample("locomotion", -0.25)[0]?.normalizedTime).toBeCloseTo(0.75, 9);
    expect(machine.sample("locomotion", 3)[0]?.normalizedTime).toBe(0);
  });

  it("splits a blend tree by the current parameter, or by an override for this sample only", () => {
    const machine = heroMachine();
    expect(summary(machine.sample("locomotion", 0.5))).toEqual(["idle@1.00/0.50"]);

    machine.setFloat("speed", 4);
    expect(summary(machine.sample("locomotion", 0.5))).toEqual(["walk@0.50/0.50", "run@0.50/0.50"]);

    expect(summary(machine.sample("locomotion", 0.5, { parameters: { speed: 1 } }))).toEqual([
      "idle@0.50/0.50",
      "walk@0.50/0.50",
    ]);
    expect(machine.getFloat("speed")).toBe(4);
    expect(summary(machine.sample("locomotion", 0.5))).toEqual(["walk@0.50/0.50", "run@0.50/0.50"]);
  });

  it("changes nothing in the machine and queues no event or state change", () => {
    const machine = heroMachine();
    machine.advance(0.25);
    const clips = [...machine.clips];
    const time = machine.normalizedTime();

    machine.sample("jump", 0.9);
    machine.sample("jump", 0.1, { parameters: { grounded: false } });

    expect(machine.currentState()).toBe("locomotion");
    expect(machine.normalizedTime()).toBe(time);
    expect(machine.clips).toEqual(clips);
    expect(machine.getBool("grounded")).toBe(true);
    const events: string[] = [];
    const changes: StateChange[] = [];
    machine.drainEvents(events);
    machine.drainStateChanges(changes);
    expect(events).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("refuses a non-finite time, an unknown state and a bad parameter value", () => {
    const machine = heroMachine();
    expectCode(() => machine.sample("jump", Number.NaN), ThreeDErrorCode.invalidSample);
    expectCode(() => machine.sample("jump", Number.POSITIVE_INFINITY), ThreeDErrorCode.invalidSample);
    expectCode(() => machine.sample("fly", 0), ThreeDErrorCode.unknownState);
    expectCode(() => machine.sample("locomotion", 0, { parameters: { ghost: 1 } }), ThreeDErrorCode.unknownParameter);
    expectCode(
      () => machine.sample("locomotion", 0, { parameters: { jump: true } }),
      ThreeDErrorCode.parameterKindMismatch,
    );
    expectCode(
      () => machine.sample("locomotion", 0, { parameters: { grounded: 1 } }),
      ThreeDErrorCode.parameterKindMismatch,
    );
    expectCode(
      () => machine.sample("locomotion", 0, { parameters: { speed: true } }),
      ThreeDErrorCode.parameterKindMismatch,
    );
    expectCode(
      () => machine.sample("locomotion", 0, { parameters: { speed: Number.NaN } }),
      ThreeDErrorCode.invalidSample,
    );
  });
});

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

/**
 * Publishes a headless model asset, which carries no clips.
 *
 * @param harness - The app harness.
 * @returns The handle, already retained.
 */
function modelHandle(harness: ThreeDAppHarness): AssetHandle<ModelAsset> {
  const asset = new ModelAsset("memory:hero.glb", null, [], [], null);
  return harness.app.assets.register(asset, { type: "model" }).retain();
}

/**
 * Builds a hero entity with a model and an animator.
 *
 * @param harness - The app harness.
 * @returns The entity and its animator.
 */
function hero(harness: ThreeDAppHarness): { entity: Entity; animator: Animator } {
  const entity = harness.world.createEntity("Hero");
  entity.addComponent(Model, { model: modelHandle(harness) });
  const animator = entity.addComponent(Animator, { animator: heroHandle(harness) });
  return { entity, animator };
}

describe("Animator.sample", () => {
  it("checks its arguments and leaves the machine alone in an edit-mode app", async () => {
    const harness = await createThreeDApp({ editMode: true });
    const { animator } = hero(harness);
    const entered: string[] = [];
    animator.onStateEntered.connect((name) => entered.push(name));
    harness.step();

    // Headless: nothing to pose, so `false`, but the document is bound and the call is checked.
    expect(animator.sample("jump", 0.5)).toBe(false);
    expect(animator.isReady).toBe(true);
    expect(animator.currentState()).toBe("locomotion");
    expect(animator.normalizedTime()).toBe(0);
    expectCode(() => animator.sample("fly", 0.5), ThreeDErrorCode.unknownState);
    expectCode(() => animator.sample("jump", Number.NaN), ThreeDErrorCode.invalidSample);
    expectCode(
      () => animator.sample("locomotion", 0.5, { parameters: { ghost: 1 } }),
      ThreeDErrorCode.unknownParameter,
    );
    harness.stepMany(3);
    expect(entered).toEqual([]);
    harness.dispose();
  });

  it("is a pose-only override in a playing app: the machine plays on as before", async () => {
    const harness = await createThreeDApp();
    const { animator } = hero(harness);
    harness.stepMany(6);
    const entered: string[] = [];
    animator.onStateEntered.connect((name) => entered.push(name));
    const time = animator.normalizedTime();

    expect(animator.sample("jump", 0.9)).toBe(false);

    expect(animator.currentState()).toBe("locomotion");
    expect(animator.normalizedTime()).toBe(time);
    harness.step();
    expect(animator.normalizedTime()).toBeGreaterThan(time);
    expect(entered).toEqual([]);
    harness.dispose();
  });

  it("returns false before its document loads, and still refuses a non-finite time", async () => {
    const harness = await createThreeDApp({ editMode: true });
    const entity = harness.world.createEntity("Hero");
    entity.addComponent(Model, { model: modelHandle(harness) });
    const animator = entity.addComponent(Animator);
    expect(animator.sample("jump", 0.5)).toBe(false);
    expectCode(() => animator.sample("jump", Number.NaN), ThreeDErrorCode.invalidSample);
    harness.dispose();
  });

  it("refuses an animator with no model to pose", async () => {
    const harness = await createThreeDApp({ editMode: true });
    const bare = harness.world.createEntity("Bare").addComponent(Animator, { animator: heroHandle(harness) });
    expectCode(() => bare.sample("jump", 0.5), ThreeDErrorCode.nothingToPose);

    const empty = harness.world.createEntity("Empty");
    empty.addComponent(Model);
    const animator = empty.addComponent(Animator, { animator: heroHandle(harness) });
    expectCode(() => animator.sample("jump", 0.5), ThreeDErrorCode.nothingToPose);

    // A Model added after the Animator is found too.
    const late = harness.world.createEntity("Late");
    const lateAnimator = late.addComponent(Animator, { animator: heroHandle(harness) });
    late.addComponent(Model, { model: modelHandle(harness) });
    expect(lateAnimator.sample("jump", 0.5)).toBe(false);
    harness.dispose();
  });
});
