import {
  addAnimationGroup,
  AnimationGroupMaskMode,
  createAnimationGroupMask,
  createAnimationManager,
  enableAnimationBlending,
  playAnimation,
  removeAnimationGroup,
  setAnimationAdditive,
  setAnimationWeight,
  stopAnimation,
  updateAnimationManager,
} from "@babylonjs/lite";
import type { AnimationGroup, AnimationGroupMask, AnimationManager, EngineContext } from "@babylonjs/lite";

/**
 * The Babylon Lite half of `Animator` (`docs/architecture/12-3d-toolkit.md` §3, coding standards §4
 * — this file and the navigation adapter next door are the only places in the package that may
 * import `@babylonjs/lite`).
 *
 * It sits under `src/lite/gpu/` rather than beside the navigation adapter because everything it
 * touches only exists once a model has been uploaded: the `AnimationGroup`s it weights are the ones
 * `ModelAsset` stripped off a loaded glTF container, and the pose it computes is written into
 * skeleton buffers on the device. A headless app therefore never constructs one, which is why the
 * node suites cover the state machine and the browser suite covers this.
 *
 * ## What Lite gives us, verified against `@babylonjs/lite@1.27.0`
 *
 * - `createAnimationManager(options?)` (`index.d.ts` 2071) makes an empty manager. It has its own
 *   `requestAnimationFrame` loop available through `startAnimationManager`, which ignifx never
 *   calls: `updateAnimationManager(manager, deltaMs)` (`index.d.ts` 13222) is the manual pump, and
 *   ADR-0003 says ignifx owns every clock. The `engine` option (`index.d.ts` 440) is **required**
 *   in practice, not optional: a skeletal clip's controller throws *"AnimationController.tick
 *   requires an EngineContext for skeleton or morph animation"* without it, because uploading bone
 *   matrices needs the device. Measured against 1.27.0 in the browser suite.
 * - `enableAnimationBlending(manager)` (`index.d.ts` 4306) installs the weighted glTF mixer as the
 *   manager's task-category handler (`lib/animation/weighted-gltf-mixer.js` 22-24). Without it
 *   every group ticks on its own and `group.weight` is stored but never mixed, so blending is
 *   switched on for every animator rather than only for the blending ones.
 * - `addAnimationGroup(manager, group)` (`index.d.ts` 21) binds a group to exactly one manager and
 *   **throws** when the group already belongs to a different one
 *   (`lib/animation/animation-group-task.js` 21-26). See {@link AnimatorMixer} for what that means
 *   when two `Model`s share one asset.
 * - `setAnimationWeight(group, weight)` (`index.d.ts` 10329) refuses anything outside `[0, 1]`
 *   (`lib/animation/animation-weight.js` 3-8), so the mixer clamps before it writes.
 * - `setAnimationAdditive(group, options?)` (`index.d.ts` 10322) marks a group additive and turns
 *   blending on for its owner as a side effect (`lib/animation/weighted-gltf-mixer.js` 34-37).
 * - `createAnimationGroupMask(names?, mode?)` (`index.d.ts` 2062) builds the include/exclude filter
 *   assigned to `group.mask` (`index.d.ts` 371). Lite re-resolves a mask only when its `mode`,
 *   `disabled`, or the `names` array *reference* changes (`index.d.ts` 366-371), so a mask is built
 *   once per layer and never edited in place.
 *
 * ## What Lite does not give us
 *
 * There are no animation events: nothing in `index.d.ts` fires on a keyframe. ignifx derives them
 * from the state machine's own cursor instead (`12-3d-toolkit.md` §3), which is why events work
 * identically under a headless app where no group is ticked at all.
 */

/** Milliseconds in one second: `updateAnimationManager` takes milliseconds. */
const MILLISECONDS_PER_SECOND = 1000;

/** Lite refuses a weight above this. */
const MAX_WEIGHT = 1;

/**
 * The Lite objects one `Animator` owns.
 *
 * @remarks
 * One manager per animator, as `docs/architecture/12-3d-toolkit.md` §3 specifies. The groups are
 * **the asset's**, not copies: `ModelAsset` strips them off the container at load and every `Model`
 * of that asset hands out the same array. Because `addAnimationGroup` binds a group to one manager,
 * and because a cloned skinned mesh shares the template's skeleton
 * (`lib/scene/transform-node.js` 38-53), two `Model`s of one asset cannot be animated
 * independently: the second animator to claim the clips is refused, and both instances would show
 * one pose in any case. Instanced animated characters are a post-Phase-7 problem, and the mixer
 * reports the refusal rather than throwing mid-frame.
 *
 * @internal
 */
export class AnimatorMixer {
  readonly #manager: AnimationManager;

  readonly #groups = new Map<string, AnimationGroup>();

  readonly #claimed: AnimationGroup[] = [];

  readonly #masks = new Map<string, AnimationGroupMask>();

  #disposed = false;

  /**
   * Builds a manager and claims every clip it can.
   *
   * @param groups - The animation groups of the model this animator drives.
   * @param engine - The engine whose device the bone matrices are uploaded to.
   * @param onRefused - Called with a clip's name when Lite refuses to hand it over.
   */
  constructor(
    groups: readonly AnimationGroup[],
    engine: EngineContext,
    onRefused: (clip: string, error: unknown) => void,
  ) {
    this.#manager = createAnimationManager({ engine });
    enableAnimationBlending(this.#manager);
    for (const group of groups) {
      try {
        addAnimationGroup(this.#manager, group);
      } catch (error) {
        onRefused(group.name, error);
        continue;
      }
      // `playAnimation` (`index.d.ts` 8923) is not a nicety: a glTF load marks *only the first*
      // clip as started and every other one as stopped (`lib/animation/animation-group.js` 81), and
      // a stopped group is skipped by both the weighted mixer and the plain tick (same file, 26).
      // Setting `isPlaying` alone leaves the internal stopped flag set, and every clip but the
      // first is silently never posed. Measured against 1.27.0 in the browser suite.
      playAnimation(group);
      group.loopAnimation = true;
      group.weight = 0;
      this.#groups.set(group.name, group);
      this.#claimed.push(group);
    }
  }

  /**
   * The Lite manager, for the escape hatch.
   *
   * @returns The Lite manager, for the escape hatch.
   */
  get manager(): AnimationManager {
    return this.#manager;
  }

  /**
   * Every clip name the model declared and this mixer claimed, in load order.
   *
   * @returns Every clip name the model declared and this mixer claimed, in load order.
   */
  get clipNames(): readonly string[] {
    return [...this.#groups.keys()];
  }

  /**
   * The length of one clip, in seconds.
   *
   * @param clip - The animation-group name.
   * @returns Its duration, or `0` when the model declares no such clip.
   */
  lengthOf(clip: string): number {
    return this.#groups.get(clip)?.duration ?? 0;
  }

  /**
   * Installs a layer's bone mask on a clip.
   *
   * @param clip - The animation-group name.
   * @param layer - The layer whose mask this is, so one mask is built per layer.
   * @param bones - The bone names the mask lists.
   * @param exclude - Whether the names are the bones that do **not** animate.
   */
  setMask(clip: string, layer: string, bones: readonly string[], exclude: boolean): void {
    const group = this.#groups.get(clip);
    if (group === undefined) {
      return;
    }
    if (bones.length === 0) {
      // `exactOptionalPropertyTypes` forbids writing `undefined` into an optional property, and
      // Lite reads `group.mask === undefined` as "no mask" (`index.d.ts` 371).
      delete group.mask;
      return;
    }
    const key = `${layer} ${exclude ? "x" : "i"}`;
    let mask = this.#masks.get(key);
    if (mask === undefined) {
      mask = createAnimationGroupMask(
        [...bones],
        exclude ? AnimationGroupMaskMode.Exclude : AnimationGroupMaskMode.Include,
      );
      this.#masks.set(key, mask);
    }
    group.mask = mask;
  }

  /**
   * Marks a clip additive.
   *
   * @param clip - The animation-group name.
   */
  setAdditive(clip: string): void {
    const group = this.#groups.get(clip);
    if (group !== undefined) {
      setAnimationAdditive(group);
    }
  }

  /** Zeroes every claimed clip's weight, ready for this frame's contributions. */
  clearWeights(): void {
    for (let index = 0; index < this.#claimed.length; index += 1) {
      const group = this.#claimed[index];
      if (group !== undefined) {
        group.weight = 0;
      }
    }
  }

  /**
   * Writes one clip's weight, rate, and playhead.
   *
   * @param clip - The animation-group name.
   * @param weight - Its share of the pose; clamped into `[0, 1]` for Lite.
   * @param speed - Its playback rate.
   * @param normalizedTime - Where the playhead should sit, in `[0, 1]`.
   */
  apply(clip: string, weight: number, speed: number, normalizedTime: number): void {
    const group = this.#groups.get(clip);
    if (group === undefined) {
      return;
    }
    setAnimationWeight(group, Math.min(MAX_WEIGHT, Math.max(0, weight)));
    group.speedRatio = speed;
    // ignifx's state machine owns the playhead, so the group's time is written rather than
    // advanced: that is what keeps a crossfade's two clips phase-locked to the machine's cursors
    // and what makes `app.pause()` freeze the pose exactly.
    group.currentTime = normalizedTime * group.duration;
  }

  /**
   * Advances the manager by one frame.
   *
   * @param deltaSeconds - The frame delta in seconds; Lite wants milliseconds.
   */
  tick(deltaSeconds: number): void {
    updateAnimationManager(this.#manager, deltaSeconds * MILLISECONDS_PER_SECOND);
  }

  /** Hands every claimed clip back, so another animator can take the model over. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const group of this.#claimed) {
      group.weight = 0;
      stopAnimation(group);
      removeAnimationGroup(this.#manager, group);
    }
    this.#claimed.length = 0;
    this.#groups.clear();
    this.#masks.clear();
  }
}
