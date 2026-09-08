import { Script } from "@ignifx/core";
import type { GameMenus } from "../menus/game-menus.js";
import type { ScriptCallbacks } from "@ignifx/core";
import type { InputAction } from "@ignifx/input";

/**
 * Drives the front end: opens the pause menu, and pumps the menus' own navigation and toast timers.
 *
 * `static updateWhenPaused` is the whole trick. `app.pause()` sets `time.paused`, which stops fixed
 * steps and stops `update` for every ordinary script — including, without this flag, the one script
 * that has to notice the second press of Escape. A focused `<button>` deliberately does **not**
 * suppress gameplay input in `@ignifx/ui`, so pausing is what stops the character, not focus.
 *
 * ## Why `pause` is read here and `menuBack` is not
 *
 * Both are bound to Escape, and `@ignifx/input` holds an edge flag for the whole frame, so a single
 * press makes `pause.wasPressedThisFrame` and `menuBack.wasPressedThisFrame` true together. Exactly
 * one of them may act on it: while a screen is up the menus consume the press, and only while
 * nothing is up does this script open the pause menu.
 *
 * ## Why losing the pointer also opens the menu
 *
 * Escape is two gestures at once here: the game's pause button, and the browser's way out of
 * pointer lock. Which of the two acts first is the browser's business, and a user agent is allowed
 * to swallow the key press that released the lock rather than deliver it — in which case a player
 * who pressed Escape once would get their cursor back and no menu, and would have to press it
 * again. Watching for the lock going from held to not held closes that gap without depending on
 * which browser is running, and it buys the behaviour every desktop game has anyway: tabbing away
 * takes the pointer, and the game stops rather than running on unwatched. A *refused* request never
 * looks like a loss, because the lock was never held.
 */
export class MenuController extends Script implements ScriptCallbacks {
  static typeId = "third-person/MenuController";

  /** Keeps receiving `update` while `time.paused`, so the menus can close themselves. */
  static updateWhenPaused = true;

  /** The front end to drive. Assigned right after the component is added. */
  menus: GameMenus | null = null;

  /** The `pause` action, which every template binds to Escape, Start and the touch pause button. */
  #pause: InputAction | null = null;

  /** Whether the canvas held the pointer last frame; see the module comment. */
  #wasLocked = false;

  awake(): void {
    this.#pause = this.app.input.actions.find("Pause");
  }

  update(): void {
    const menus = this.menus;
    if (menus === null) {
      return;
    }
    // Read every frame, open or not, or the flag goes stale behind a menu and the next close is
    // reported as a loss.
    const lostPointer = this.#readPointerLoss();
    // The unscaled clock, not `dt`: a menu that repeats a held direction has to keep time while the
    // game is stopped, and `dt` is scaled time, which a `?static=1` scene pins at zero.
    const delta = this.app.time.unscaledDeltaTime;
    const wasOpen = menus.isOpen;
    menus.update(delta);
    if (!wasOpen && (this.#pause?.wasPressedThisFrame === true || lostPointer)) {
      menus.show("pause");
    }
    // The menus own the pause state, in one place: any screen on top stops the game, and closing
    // the last one starts it again. That covers the title screen, which is simply the screen the
    // game boots with, as well as every path out of the pause menu.
    const shouldPause = menus.isOpen;
    if (shouldPause !== this.app.time.paused) {
      if (shouldPause) {
        this.app.pause();
      } else {
        this.app.resume();
      }
    }
  }

  /**
   * Whether the canvas held the pointer last frame and does not hold it now.
   *
   * @returns `true` on the frame the lock was lost, and never on the frame a request was refused.
   */
  #readPointerLoss(): boolean {
    const locked = this.app.input.pointerLock.locked;
    const lost = this.#wasLocked && !locked;
    this.#wasLocked = locked;
    return lost;
  }
}
