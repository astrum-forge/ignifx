import { DeviceKind } from "@ignifx/input";
import { ActionSlot } from "./actions.js";
import type { Component, Vec2Like } from "@ignifx/core";
import type { InputService } from "@ignifx/input";

/**
 * The look half of a rig, shared by `FirstPersonController` and `ThirdPersonCamera`
 * (`docs/architecture/12-3d-toolkit.md` §1.2 and §2.1). Both rigs answer the same three questions
 * every frame and used to answer them twice:
 *
 * - **Should this frame ask for pointer lock?** Yes, whenever the game wants click-to-lock, the
 *   pointer is not locked, and the frame carries a `pointerdown` — every time, not only the first.
 *   A browser drops the lock on Escape, on a focus change, and on any navigation, and a game whose
 *   first request was its only one leaves the player with an unlocked mouse for the rest of the
 *   session.
 * - **Should this frame's look be ignored?** Yes, for a mouse or the unified pointer while
 *   click-to-lock is on and the lock is not held. An unlocked mouse crossing the canvas on its way
 *   to a menu button is not a look gesture, and a cursor that leaves the window stops sending
 *   motion mid-turn. Gamepad, touch, and virtual sticks are never gated: they have no cursor to
 *   lose.
 * - **What does one unit of look input mean?** A pointer delta is a **displacement** already
 *   measured in CSS pixels, so it is multiplied by `sensitivity` (degrees per pixel) and nothing
 *   else. A stick is a **deflection**, which is a rate: it is multiplied by `stickLookSpeed` and
 *   the frame delta, so 60 fps and 144 fps turn through the same angle in the same second.
 *
 * It also settles the one thing the two device families genuinely disagree about: **which way is
 * up**. A stick reports `+y` when it is pushed up; a pointer's `movementY` grows *downward*, because
 * that is how screens are measured. The helper normalises that here, so the vector it hands back
 * always means "`+y` is up", and each rig applies one sign of its own.
 *
 * The whole path is allocation-free: one reused output vector, one reused settle callback, and no
 * closure per frame (coding standards §7).
 */

/** What {@link LookInput} reads off the component that owns it. */
export interface LookRig extends Component {
  /** Whether a click asks for pointer lock, and mouse look waits until it is held. */
  readonly lockPointerOnClick: boolean;
  /** Degrees of rotation per unit of look input; for a mouse, degrees per CSS pixel. */
  readonly sensitivity: number;
  /** Degrees of rotation per second at full stick deflection. */
  readonly stickLookSpeed: number;
}

/**
 * One rig's look action: resolution, pointer-lock gating, and the conversion to degrees.
 *
 * @internal
 */
export class LookInput {
  readonly #slot = new ActionSlot("");

  /** The reused output of {@link LookInput.step}: degrees of yaw and of raw pitch input. */
  readonly #step = { x: 0, y: 0 };

  /** Whether a lock request is in flight, so one click does not queue several. */
  #requesting = false;

  readonly #settle = (): void => {
    this.#requesting = false;
  };

  /**
   * The action name this rig looks with.
   *
   * @returns The action name this rig looks with.
   */
  get name(): string {
    return this.#slot.name;
  }

  /**
   * Points the slot at the owner's current `lookAction` field, and re-resolves it either way.
   *
   * @param name - The action name from the field.
   */
  rebind(name: string): void {
    if (this.#slot.name !== name) {
      this.#slot.retarget(name);
      return;
    }
    this.#slot.invalidate();
  }

  /**
   * Runs one frame of look: asks for pointer lock when the frame calls for it, then reads the look
   * action and converts it to degrees.
   *
   * @param owner - The rig, for its action set, its app, and its three look fields.
   * @param dt - The frame delta in seconds, as `update`/`lateUpdate` received it: the **scaled**
   * delta, so slow motion slows a stick look with everything else. A paused app does not call
   * `update` on a rig at all unless it declares `updateWhenPaused`, and one that does keeps turning,
   * because `dt` is not zeroed for it (`01-lifecycle-and-time.md` §7).
   * @returns The reused step: `x` is degrees of yaw, `y` is degrees of pitch with `+y` meaning
   * "look up" whatever the device — before the rig applies its own `-look.y` and `invertY`. Both are
   * `0` when the look is at rest or gated.
   */
  step(owner: LookRig, dt: number): Vec2Like {
    const out = this.#step;
    out.x = 0;
    out.y = 0;
    const input = owner.app.input;
    const locked = input.pointerLock.locked;
    const gated = owner.lockPointerOnClick && !locked;
    if (gated) {
      this.#requestLock(owner, input);
    }
    const action = this.#slot.resolve(owner);
    const device = action?.activeDevice ?? null;
    if (action === null || device === null) {
      return out;
    }
    const isPointer = device === DeviceKind.mouse || device === DeviceKind.pointer;
    if (gated && isPointer) {
      return out;
    }
    const isStick = device === DeviceKind.gamepad || device === DeviceKind.virtual;
    const gain = isStick ? owner.stickLookSpeed * dt : owner.sensitivity;
    // A screen's y grows downward and a stick's grows upward, so a mouse, a pointer, and a touch
    // drag are flipped here and every device leaves this method meaning "`+y` is up". Without it one
    // `invertY` cannot serve both families: whichever one it suits, the other is inverted.
    const pitchSign = isPointer || device === DeviceKind.touch ? -1 : 1;
    const value = action.vector;
    out.x = value.x * gain;
    out.y = value.y * gain * pitchSign;
    return out;
  }

  /**
   * Asks for pointer lock when this frame carries a pointer press.
   *
   * @remarks
   * `app.input.events` is the frame's raw event log, and a pointer press is the gesture browsers
   * accept as user activation for `requestPointerLock`. A refusal — including the `IGX-0809` a
   * headless app rejects with, which has no canvas to lock — is logged and dropped: a game that
   * threw here would take the frame down over a browser policy the player controls.
   *
   * @param owner - The rig, for its log.
   * @param input - The app's input service.
   */
  #requestLock(owner: LookRig, input: InputService): void {
    if (this.#requesting) {
      return;
    }
    const events = input.events;
    let pressed = false;
    for (let index = 0; index < events.length; index += 1) {
      if (events[index]?.type === "pointerdown") {
        pressed = true;
        break;
      }
    }
    if (!pressed) {
      return;
    }
    this.#requesting = true;
    void input.pointerLock.request().then(this.#settle, (error: unknown): void => {
      this.#settle();
      owner.app.log.warn("Pointer lock was refused.", error);
    });
  }
}
