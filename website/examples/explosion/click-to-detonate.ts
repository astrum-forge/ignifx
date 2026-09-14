/**
 * The click: an action map, and the `Script` that turns a press-and-release on the canvas into one
 * detonation.
 *
 * @remarks
 * A script on `@ignifx/input` actions rather than a DOM listener, because that is what a game
 * writes: the same class works with a mouse, with a finger and with a gamepad-driven cursor, and
 * `<Pointer>/position` already reports **backing-store pixels**, which is the space
 * `Camera.screenToRay` takes. `app.input.uiHasPointer` is checked on the press so a drag that
 * starts on the parameter panel never fires, and the press position is remembered so the orbit
 * camera's own drag is not read as a click.
 *
 * It is `picking/click-to-pick.ts`'s script with one call changed; the comment there explains the
 * two details at greater length.
 */

import { defineInputActions, Script } from "ignifx";
import type { InputActionsDefinition, ScriptCallbacks } from "ignifx";

/** How far the pointer may travel between press and release and still count as a click, in pixels. */
const CLICK_SLOP_PIXELS = 6;

/** The two actions the click needs. Its own map, so the kit camera's map is untouched. */
export const BLAST_ACTIONS: InputActionsDefinition = defineInputActions({
  maps: [
    {
      name: "Explosion",
      actions: [
        { name: "blastPress", type: "button", bindings: [{ path: "<Pointer>/press" }] },
        { name: "blastPosition", type: "vector2", bindings: [{ path: "<Pointer>/position" }] },
      ],
    },
  ],
});

/** What a click is handed to. `main.ts` implements it; the script only calls it. */
export interface Detonator {
  /**
   * Sets off a blast under one pixel.
   *
   * @param x - The backing-store pixel x, from the canvas's left edge.
   * @param y - The backing-store pixel y, from the canvas's top edge.
   */
  detonateAt(x: number, y: number): void;
}

/** Detonates on a click that did not drag. */
export class ClickToDetonate extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "explosion/ClickToDetonate";

  /** What a click is handed to. A closure over the scene, so it is assigned rather than declared. */
  detonator: Detonator | null = null;

  /** Where the pointer went down, in backing-store pixels. */
  #pressX = 0;

  /** Where the pointer went down, in backing-store pixels. */
  #pressY = 0;

  /** Whether the press in flight started on the canvas rather than on the parameter panel. */
  #onCanvas = false;

  /** Reads the frame's pointer state and detonates on a release that stayed put. */
  update(): void {
    const press = this.app.input.actions.find("blastPress");
    const at = this.app.input.actions.find("blastPosition");
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
      this.detonator?.detonateAt(at.vector.x, at.vector.y);
    }
  }
}
