import { Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * Shows the "click to look" line while the game is running and the browser has not given the page
 * the pointer.
 *
 * `FirstPersonController` is built with `lockPointerOnClick: true`, so an unlocked mouse deliberately
 * does **not** turn the view: a cursor crossing the canvas on its way to a menu button is not a
 * look gesture. That is the right behaviour and the wrong thing to leave unexplained — without a
 * line saying so, the first thing a player does is move the mouse, see nothing happen, and conclude
 * the demo is broken. The line disappears the moment the lock is granted, which is also the moment
 * it stops being true.
 *
 * `static updateWhenPaused` is what lets the hint go away when the pause menu opens: `app.pause()`
 * stops `update` for every ordinary script, and a hint frozen on screen behind a menu would be
 * telling the player to click while a click means "choose a row".
 */
export class LockHint extends Script implements ScriptCallbacks {
  static typeId = "first-person/LockHint";

  /** Keeps receiving `update` while `time.paused`, so the hint can hide itself behind a menu. */
  static updateWhenPaused = true;

  /** The element to show and hide, or `null` on a device that has no pointer to lock. */
  element: HTMLElement | null = null;

  /** What the element is showing now, so the DOM is touched only on a change. */
  #shown = false;

  update(): void {
    const element = this.element;
    if (element === null) {
      return;
    }
    const shown = !this.app.input.pointerLock.locked && !this.app.time.paused;
    if (shown === this.#shown) {
      return;
    }
    this.#shown = shown;
    element.hidden = !shown;
  }
}
