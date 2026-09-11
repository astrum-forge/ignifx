import { LoadingScreen, VirtualButton, VirtualJoystick } from "@ignifx/ui";
import type { App } from "@ignifx/core";

/**
 * Build the loading screen, DOM HUD, and touch controls. Menus live in `menus/game-menus.ts`.
 * The DOM HUD needs no bundled font. Virtual widgets share the action bindings used by desktop
 * controls; the joystick converts screen Y-down motion to a Y-up control value.
 */

/** What {@link createGameUi} hands back. */
export interface GameUi {
  /** The boot screen. Hide it once the preload has settled. */
  readonly loading: LoadingScreen;
  /** The HUD line element, or `null` under an app with no DOM overlay. */
  readonly hud: HTMLDivElement | null;
  /** The crosshair, which `Interactor` marks when something is in reach. */
  readonly crosshair: HTMLDivElement | null;
  /**
   * The "click to look" line `LockHint` shows and hides, or `null` when this device has no pointer
   * to lock — a phone gets the on-screen sticks instead, and telling it to click would be a lie.
   */
  readonly hint: HTMLDivElement | null;
  /** Removes every widget this created. */
  dispose(): void;
}

/** What {@link createGameUi} needs to know that is not on the app. */
export interface GameUiOptions {
  /** The loading screen's label, already localized. */
  readonly loadingLabel: string;
  /** The "click to look" line, already localized. */
  readonly lockHint: string;
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

  const hudLayer = app.ui.layer("hud").element;
  let hud: HTMLDivElement | null = null;
  let crosshair: HTMLDivElement | null = null;
  let hint: HTMLDivElement | null = null;
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
    if (!options.touch) {
      hint = hudLayer.ownerDocument.createElement("div");
      hint.className = "lock-hint";
      hint.textContent = options.lockHint;
      // Hidden until `LockHint` decides otherwise, so it never flashes over the title screen.
      hint.hidden = true;
      hudLayer.append(hint);
    }
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
    hud,
    crosshair,
    hint,
    dispose(): void {
      for (const widget of widgets) {
        widget.dispose();
      }
      hud?.remove();
      crosshair?.remove();
      hint?.remove();
      loading.dispose();
    },
  };
}
