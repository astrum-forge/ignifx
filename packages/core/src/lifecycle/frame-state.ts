import type { FrameState } from "../app/types.js";

/**
 * The writable half of {@link FrameState}. The scheduler owns one per app and hands it to the
 * world; the lifecycle queue brackets every callback with it, so `destroyImmediate` can refuse to
 * run inside a callback (`IGX-0102`) and so `awake` knows to run nested and synchronously
 * (`docs/architecture/01-lifecycle-and-time.md` §4, §6).
 *
 * @internal
 */
export interface FrameStateController {
  /** The read-only view handed to the world and to game-facing code. */
  readonly state: FrameState;
  /**
   * Marks the fixed loop as entered or left.
   *
   * @param value - `true` while `fixedUpdate` and physics run.
   */
  setInsideFixedStep(value: boolean): void;
  /** Enters a callback. Nests: the depth is what makes a callback inside a callback still count. */
  beginCallback(): void;
  /** Leaves a callback. */
  endCallback(): void;
}

/** The controller and the state it exposes, in one object so no closure is allocated per call. */
class FrameStateImpl implements FrameStateController, FrameState {
  #callbackDepth = 0;

  #insideFixedStep = false;

  get state(): FrameState {
    return this;
  }

  get isInsideCallback(): boolean {
    return this.#callbackDepth > 0;
  }

  get isInsideFixedStep(): boolean {
    return this.#insideFixedStep;
  }

  setInsideFixedStep(value: boolean): void {
    this.#insideFixedStep = value;
  }

  beginCallback(): void {
    this.#callbackDepth += 1;
  }

  endCallback(): void {
    if (this.#callbackDepth > 0) {
      this.#callbackDepth -= 1;
    }
  }
}

/**
 * Creates the frame-state controller for one app.
 *
 * @returns A controller whose `state` reports "outside any callback, outside the fixed loop".
 *
 * @example
 * ```ts
 * const frameState = createFrameState();
 * const world = createWorld({ app, scene, frameState, layers });
 * ```
 *
 * @internal
 */
export function createFrameState(): FrameStateController {
  return new FrameStateImpl();
}
