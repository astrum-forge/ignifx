import { Animator, f32, Model, Script } from "ignifx";
import type { AnimatorStateMachine, ScriptCallbacks } from "ignifx";

/**
 * Seeking a clip: the one thing the panel asks for that `Animator` has no single call for, and the
 * script that puts the opening pose on screen before the first capture.
 *
 * @remarks
 * `Animator` is a thin shell over two halves (`packages/3d/src/animator/animator.ts` says so at
 * length): a pure {@link AnimatorStateMachine}, which turns parameters and a delta into per-clip
 * weights and a cursor, and a mixer, which is the only part that knows Babylon Lite exists. Every
 * frame, in `PostUpdate`, the component copies its `speed` onto the machine, advances the machine
 * by the frame's delta, and writes the resulting cursor into every weighted clip — so **the pose is
 * a pure function of the machine's cursor**, recomputed from scratch each frame.
 *
 * That is what makes a seek possible with no new engine API: move the cursor, and the next
 * `PostUpdate` poses the skeleton from wherever it now is. `animator.stateMachine` is the public
 * handle on it and `advance(seconds)` is a public method, so a seek is one signed `advance` of the
 * difference between where the cursor is and where the slider wants it.
 *
 * Two details are load bearing, and both are in {@link seek}: the machine's `speed` has to be one
 * for the call (the component overwrites it on the very next frame, so nothing has to be restored),
 * and the delta is in **seconds**, which means the length of whatever the current state plays. A
 * `seek(animator, model, t)` in the engine would spare a reader all of this; until there is one,
 * this file is what it costs.
 */

/** What the machine assumes a clip is worth when nothing has declared its length, in seconds. */
const FALLBACK_LENGTH_SECONDS = 1;

/**
 * How long the state a layer is currently in runs for, in seconds.
 *
 * @remarks
 * The clip lengths come from `Model.animations` — Babylon Lite's own animation groups, which
 * `ModelAsset` strips off the loaded glTF and the `Animator` hands to its mixer. A state that names
 * one clip is that clip long. A state that names a **blend tree** is as long as its longest child,
 * which is the machine's own rule (`state-machine.ts`, `#lengthOf`) and is what stops the cursor
 * jumping when the blend parameter crosses between clips of different lengths.
 *
 * @param animator - The animator whose current state is measured.
 * @param model - The model whose clips it plays.
 * @returns The length in seconds, or {@link FALLBACK_LENGTH_SECONDS} before the model has loaded.
 */
export function stateLengthSeconds(animator: Animator, model: Model): number {
  const asset = animator.animator?.value ?? null;
  const state = asset === null ? null : asset.state(animator.currentState());
  if (asset === null || state === null) {
    return FALLBACK_LENGTH_SECONDS;
  }
  const lengths = new Map<string, number>();
  for (const clip of model.animations) {
    lengths.set(clip.name, clip.duration);
  }
  if (state.clip !== "") {
    return lengths.get(state.clip) ?? FALLBACK_LENGTH_SECONDS;
  }
  const tree = asset.definition.blendTrees1D.find((candidate) => candidate.name === state.blendTree);
  let longest = 0;
  for (const child of tree?.children ?? []) {
    longest = Math.max(longest, lengths.get(child.clip) ?? 0);
  }
  return longest > 0 ? longest : FALLBACK_LENGTH_SECONDS;
}

/**
 * Moves the playhead to a fraction of the current state.
 *
 * @remarks
 * Seeking while the clip is running does what scrubbing a playing video does: the pose jumps to
 * where you dropped it and carries on from there. Set the speed to zero first to hold a pose.
 *
 * @param animator - The animator to seek.
 * @param model - The model whose clip lengths say how long a fraction is.
 * @param target - Where the playhead should sit, in `[0, 1]`.
 */
export function seek(animator: Animator, model: Model, target: number): void {
  const machine: AnimatorStateMachine | null = animator.stateMachine;
  if (machine === null) {
    return;
  }
  const seconds = (target - machine.normalizedTime()) * stateLengthSeconds(animator, model);
  // The component assigns `machine.speed = this.speed` at the top of every `PostUpdate`, so this
  // write only affects the `advance` below and nothing has to put it back. Without it a seek does
  // nothing at all whenever the animator is stopped, which is exactly when a seek is wanted.
  machine.speed = 1;
  machine.advance(seconds);
}

/**
 * Puts the opening pose on screen: one seek, on the first frame that has a state machine to seek.
 *
 * @remarks
 * The machine does not exist until the animator's first `PostUpdate`, which is after `app.start()`
 * has returned, so the opening pose cannot be set while the world is being built. `lateUpdate` is
 * the phase that runs **after** `PostUpdate` — the same reason `ThirdPersonCamera` frames a
 * character there — so the first `lateUpdate` is the earliest moment a cursor can be written, and
 * the pose it produces is drawn from the next frame on. Sixteen settling frames later the capture
 * is taken, and `?static=1` has held the clock at zero throughout, so the frozen pose is exactly
 * this one.
 */
export class OpeningPose extends Script.define({ playhead: f32(0, { min: 0, max: 1 }) }) implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "skinned-animation/OpeningPose";

  /** Whether the seek has happened. The script does nothing at all afterwards. */
  #posed = false;

  /** Seeks once, as soon as there is a state machine. */
  lateUpdate(): void {
    if (this.#posed) {
      return;
    }
    const animator = this.entity.getComponent(Animator);
    const model = this.entity.getComponent(Model);
    if (animator === null || model === null || animator.stateMachine === null) {
      return;
    }
    this.#posed = true;
    seek(animator, model, this.playhead);
  }
}
