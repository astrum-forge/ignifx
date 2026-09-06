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
 */
export class MenuController extends Script implements ScriptCallbacks {
  static typeId = "sidescroller/MenuController";

  /** Keeps receiving `update` while `time.paused`, so the menus can close themselves. */
  static updateWhenPaused = true;

  /** The front end to drive. Assigned right after the component is added. */
  menus: GameMenus | null = null;

  /** The `pause` action, which every template binds to Escape, Start and the touch pause button. */
  #pause: InputAction | null = null;

  awake(): void {
    this.#pause = this.app.input.actions.find("pause");
  }

  update(): void {
    const menus = this.menus;
    if (menus === null) {
      return;
    }
    // The unscaled clock, not `dt`: a menu that repeats a held direction has to keep time while the
    // game is stopped, and `dt` is scaled time, which a `?static=1` scene pins at zero.
    const delta = this.app.time.unscaledDeltaTime;
    const wasOpen = menus.isOpen;
    menus.update(delta);
    if (!wasOpen && this.#pause?.wasPressedThisFrame === true) {
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
}
