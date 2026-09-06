import { Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";
import type { InputAction } from "@ignifx/input";
import type { Dialog } from "@ignifx/ui";

/**
 * Opens and closes the pause menu, and stops the game while it is open.
 *
 * `static updateWhenPaused` is the whole trick: `app.pause()` sets `time.paused`, which stops fixed
 * steps and stops `update` for every ordinary script — including, without this flag, the one script
 * that has to notice the second press of Escape.
 */
export class PauseMenu extends Script implements ScriptCallbacks {
  static typeId = "topdown/PauseMenu";

  /** Keeps receiving `update` while `time.paused`, so the menu can close itself. */
  static updateWhenPaused = true;

  /** The dialog to show. Assigned right after the component is added. */
  menu: Dialog | null = null;

  /** The `pause` action. */
  #pause: InputAction | null = null;

  /**
   * Whether the menu is up. Owned here rather than read off the dialog, so the toggle works before
   * the dialog exists and under a headless app where `Dialog` is a documented no-op.
   */
  #isOpen = false;

  awake(): void {
    this.#pause = this.app.input.actions.find("pause");
    this.menu?.onChosen.connect(
      (id: string): void => {
        if (id === "restart") {
          window.location.reload();
          return;
        }
        this.close();
      },
      { owner: this },
    );
    this.menu?.onDismissed.connect(
      (): void => {
        this.close();
      },
      { owner: this },
    );
  }

  /**
   * Whether the menu is currently up.
   *
   * @returns `true` between {@link PauseMenu.open} and {@link PauseMenu.close}.
   */
  get isOpen(): boolean {
    return this.#isOpen;
  }

  update(): void {
    if (this.#pause?.wasPressedThisFrame === true) {
      if (this.#isOpen) {
        this.close();
      } else {
        this.open();
      }
    }
  }

  /** Shows the menu and stops the clock. */
  open(): void {
    this.#isOpen = true;
    this.menu?.show();
    this.app.pause();
  }

  /** Hides the menu and restarts the clock. */
  close(): void {
    this.#isOpen = false;
    this.menu?.hide();
    this.app.resume();
  }
}
