/**
 * The click: an action map, and the `Script` that turns a press-and-release on the canvas into one
 * pick.
 *
 * @remarks
 * A script on `@ignifx/input` actions rather than a DOM listener, because that is what a game
 * writes: the same class works with a mouse, with a finger and with a gamepad-driven cursor, and
 * `<Pointer>/position` already reports **backing-store pixels**, which is the space both pick
 * calls take. A DOM `pointerup` would have to be multiplied by the device pixel ratio first.
 *
 * Two details are what make it feel right rather than nearly right. `app.input.uiHasPointer` is
 * checked on the press, so a drag that starts on the parameter panel never picks. And the press
 * position is remembered, so the orbit camera's own gesture — a drag across the canvas — is not
 * read as a click on whatever happens to be under the release.
 */

import { Script } from "ignifx";
import type { InputActionsInput, ScriptCallbacks } from "ignifx";

/** The action map this example loads. Its own map, so the orbit camera's is untouched. */
export const PICK_ACTION_MAP = "Picking";

/** How far the pointer may travel between press and release and still count as a click, in pixels. */
export const CLICK_SLOP_PIXELS = 6;

/** The two actions the click needs, as a document `app.input.loadActions` takes. */
export const PICK_ACTIONS: InputActionsInput = {
  maps: [
    {
      name: PICK_ACTION_MAP,
      actions: [
        { name: "pickPress", type: "button", bindings: [{ path: "<Pointer>/press" }] },
        { name: "pickPosition", type: "vector2", bindings: [{ path: "<Pointer>/position" }] },
      ],
    },
  ],
};

/** Runs both picks at one pixel. `main.ts` implements it; the script only calls it. */
export interface Picker {
  /**
   * Picks the pixel twice and updates the readouts and the highlight.
   *
   * @param x - The backing-store pixel x, from the canvas's left edge.
   * @param y - The backing-store pixel y, from the canvas's top edge.
   */
  pickAt(x: number, y: number): void;
}

/**
 * Picks on a click that did not drag.
 *
 * @example
 * ```ts
 * app.registerComponents([ClickToPick]);
 * app.world.createEntity("Pointer").addComponent(ClickToPick).picker = picker;
 * ```
 */
export class ClickToPick extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "picking/ClickToPick";

  /**
   * What a click is handed to. Assigned in code rather than declared as a schema field, because a
   * picker is a closure over the scene and not something a scene file could carry.
   */
  picker: Picker | null = null;

  /** Where the pointer went down, in backing-store pixels. */
  #pressX = 0;

  /** Where the pointer went down, in backing-store pixels. */
  #pressY = 0;

  /** Whether the press in flight started on the canvas rather than on the parameter panel. */
  #onCanvas = false;

  /** Reads the frame's pointer state and picks on a release that stayed put. */
  update(): void {
    const press = this.app.input.actions.find("pickPress");
    const at = this.app.input.actions.find("pickPosition");
    if (press === null || at === null) {
      return;
    }
    if (press.wasPressedThisFrame) {
      this.#pressX = at.vector.x;
      this.#pressY = at.vector.y;
      this.#onCanvas = !this.app.input.uiHasPointer;
    }
    if (!press.wasReleasedThisFrame || !this.#onCanvas) {
      return;
    }
    this.#onCanvas = false;
    if (Math.hypot(at.vector.x - this.#pressX, at.vector.y - this.#pressY) <= CLICK_SLOP_PIXELS) {
      this.picker?.pickAt(at.vector.x, at.vector.y);
    }
  }
}
