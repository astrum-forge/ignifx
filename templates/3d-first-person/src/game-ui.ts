import { Dialog, LoadingScreen, VirtualButton, VirtualJoystick } from "@ignifx/ui";
import type { App } from "@ignifx/core";

/**
 * Everything the game shows over the canvas: the boot loading screen, the pause menu, the HUD line,
 * and the on-screen controls.
 *
 * ## Why the HUD is a `<div>` and not a `HudText`
 *
 * `@ignifx/ui` draws GPU text through `HudText`, and every text component needs a `FontAsset` — a
 * real `.ttf` the template would have to ship and license. A HUD line is also exactly the kind of
 * thing HTML is better at: real fonts, real layout, selectable, announced by a screen reader, and
 * free. `HudText` earns its cost when the text has to appear in `captureScreenshot()` or be drawn
 * in the world; a status line is neither. The skill says the same thing in one sentence: *"Use the
 * DOM for menus, HUDs, dialogs and touch controls."*
 *
 * ## Why the touch widgets are two constructor calls
 *
 * Phase 6 shipped the two 2D templates' `src/touch-controls.ts`, a hand-written thumbstick, with a comment
 * saying it should be deleted when `@ignifx/ui` shipped `VirtualJoystick`. It has been: the widgets
 * below write the same `<Virtual>/…` controls with the same axis convention, so `game.input.json`
 * says nothing about where the input came from.
 */

/** What {@link createGameUi} hands back. */
export interface GameUi {
  /** The boot screen. Hide it once the preload has settled. */
  readonly loading: LoadingScreen;
  /** The pause dialog, so a script can show it. */
  readonly pause: Dialog;
  /** The HUD line element, or `null` under an app with no DOM overlay. */
  readonly hud: HTMLDivElement | null;
  /** The crosshair, which `Interactor` marks when something is in reach. */
  readonly crosshair: HTMLDivElement | null;
  /** Removes every widget this created. */
  dispose(): void;
}

/** What {@link createGameUi} needs to know that is not on the app. */
export interface GameUiOptions {
  /** The loading screen's label, already localized. */
  readonly loadingLabel: string;
  /** The pause dialog's title, already localized. */
  readonly pauseTitle: string;
  /** The pause dialog's buttons, already localized. */
  readonly pauseButtons: readonly { readonly id: string; readonly label: string }[];
  /** Whether to build the on-screen controls. */
  readonly touch: boolean;
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
 * @param options - The localized strings and whether touch controls are wanted.
 * @returns The widgets, and a way to remove them.
 */
export function createGameUi(app: App, options: GameUiOptions): GameUi {
  const loading = new LoadingScreen(app.ui, { label: options.loadingLabel });
  // Follows `app.assets.onProgress`, bytes-weighted where the build recorded sizes. It is
  // connected before the first `load` call so the bar starts at the first byte.
  loading.bindTo(app.assets);

  const pause = new Dialog(app.ui, {
    layer: "menu",
    title: options.pauseTitle,
    buttons: options.pauseButtons,
    visible: false,
  });

  const hudLayer = app.ui.layer("hud").element;
  let hud: HTMLDivElement | null = null;
  let crosshair: HTMLDivElement | null = null;
  if (hudLayer !== null) {
    hud = hudLayer.ownerDocument.createElement("div");
    hud.className = "hud";
    // The crosshair is centred on the *layer*, which fills the overlay root, which is sized and
    // positioned over the canvas — so `top: 50%` is the canvas's centre pixel at every DPR and in
    // every scaling mode, which is exactly where `Interactor` casts its ray.
    crosshair = hudLayer.ownerDocument.createElement("div");
    crosshair.className = "crosshair";
    crosshair.dataset["target"] = "none";
    hudLayer.append(hud, crosshair);
  }

  const widgets: { dispose(): void }[] = [];
  if (options.touch) {
    const bottom = "calc(2rem + var(--ignifx-safe-bottom, 0px))";
    widgets.push(
      new VirtualJoystick(app, { control: "joystick", style: { left: "2rem", bottom } }),
      new VirtualJoystick(app, { control: "look", style: { right: "2rem", bottom } }),
      new VirtualButton(app, { control: "jump", label: "▲", style: { right: "11rem", bottom } }),
      new VirtualButton(app, { control: "interact", label: "E", style: { right: "11rem", bottom: "7rem" } }),
      new VirtualButton(app, { control: "crouch", label: "▼", style: { right: "18rem", bottom } }),
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
    hud,
    crosshair,
    dispose(): void {
      for (const widget of widgets) {
        widget.dispose();
      }
      hud?.remove();
      crosshair?.remove();
      pause.dispose();
      loading.dispose();
    },
  };
}
