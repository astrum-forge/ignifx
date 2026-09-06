import { Dialog, LoadingScreen, VirtualButton, VirtualJoystick } from "@ignifx/ui";
import type { App } from "@ignifx/core";

/**
 * Everything the game shows over the canvas: the boot loading screen, the pause menu, and the
 * on-screen controls.
 *
 * ## This file replaced `src/touch-controls.ts`
 *
 * Phase 6 shipped a hand-written DOM thumbstick here, with a comment saying it should be deleted
 * when `@ignifx/ui` shipped `VirtualJoystick`. It has been. The widgets below write the same
 * `<Virtual>/joystick` and `<Virtual>/interact` controls with the same axis convention — screen
 * `+Y` is down and the stick's `+Y` is up — so `assets/game.input.json` did not change a line, and
 * two hundred lines of pointer bookkeeping became two constructor calls.
 *
 * ## Why the pause menu needs `app.pause()` and not focus
 *
 * `@ignifx/ui` only reports `app.input.uiHasFocus` for text-entry elements: a focused `<button>`
 * deliberately keeps gameplay running, because a HUD button should not freeze the game. Stopping
 * the game is therefore an explicit `app.pause()`, which is what `scripts/pause-menu.ts` does.
 */

/** One on-screen button: the `<Virtual>` control it writes, and what it says. */
export interface TouchButton {
  /** The control name after `<Virtual>/`. */
  readonly control: string;
  /** The glyph or word drawn on the button. */
  readonly label: string;
}

/** What {@link createGameUi} hands back. */
export interface GameUi {
  /** The boot screen. Hide it once the preload has settled. */
  readonly loading: LoadingScreen;
  /** The pause dialog, so a script can show it. */
  readonly pause: Dialog;
  /** Removes every widget this created. */
  dispose(): void;
}

/**
 * Reports whether this device is likely to want on-screen controls at all.
 *
 * @returns `true` when the browser reports at least one touch point.
 */
export function hasTouch(): boolean {
  return navigator.maxTouchPoints > 0;
}

/**
 * Builds the overlay.
 *
 * @param app - The running app. `app.ui` is mounted by the time `createApp` resolves.
 * @param buttons - The on-screen buttons to draw beside the stick, right to left.
 * @param touch - Whether to build the on-screen controls at all.
 * @returns The widgets, and a way to remove them.
 */
export function createGameUi(app: App, buttons: readonly TouchButton[], touch: boolean): GameUi {
  const loading = new LoadingScreen(app.ui, { label: "Loading…" });
  // Follows `app.assets.onProgress`, bytes-weighted where the build recorded sizes. It is
  // connected before the first `load` call so the bar starts at the first byte.
  loading.bindTo(app.assets);

  const pause = new Dialog(app.ui, {
    layer: "menu",
    title: "Paused",
    buttons: [
      { id: "resume", label: "Resume" },
      { id: "restart", label: "Restart" },
    ],
    visible: false,
  });

  const widgets: { dispose(): void }[] = [];
  if (touch) {
    const bottom = "calc(2rem + var(--ignifx-safe-bottom, 0px))";
    widgets.push(new VirtualJoystick(app, { control: "joystick", style: { left: "2rem", bottom } }));
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      if (button !== undefined) {
        widgets.push(
          new VirtualButton(app, {
            control: button.control,
            label: button.label,
            style: { right: `${String(2 + index * 6)}rem`, bottom },
          }),
        );
      }
    }
    widgets.push(
      new VirtualButton(app, {
        control: "pause",
        label: "II",
        style: { right: "2rem", top: "calc(2rem + var(--ignifx-safe-top, 0px))", width: "3rem", height: "3rem" },
      }),
    );
  }

  return {
    loading,
    pause,
    dispose(): void {
      for (const widget of widgets) {
        widget.dispose();
      }
      pause.dispose();
      loading.dispose();
    },
  };
}
