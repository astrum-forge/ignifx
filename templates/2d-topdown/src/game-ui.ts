import { LoadingScreen, VirtualButton, VirtualJoystick } from "@ignifx/ui";
import type { App } from "@ignifx/core";

/**
 * Build the loading screen, DOM HUD, and touch controls. Menus live in `menus/game-menus.ts`.
 * The DOM HUD needs no bundled font. Virtual widgets share the action bindings used by desktop
 * controls; the joystick converts screen Y-down motion to a Y-up control value.
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
  /** The HUD line element, or `null` under an app with no DOM overlay. */
  readonly hud: HTMLDivElement | null;
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
 * @param label - The loading screen's label, already localized.
 * @param buttons - The on-screen buttons to draw beside the stick, right to left.
 * @param touch - Whether to build the on-screen controls at all.
 * @returns The widgets, and a way to remove them.
 */
export function createGameUi(app: App, label: string, buttons: readonly TouchButton[], touch: boolean): GameUi {
  const loading = new LoadingScreen(app.ui, { label });
  // Follows `app.assets.onProgress`, bytes-weighted where the build recorded sizes. It is
  // connected before the first `load` call so the bar starts at the first byte.
  loading.bindTo(app.assets);

  const hudLayer = app.ui.layer("hud").element;
  let hud: HTMLDivElement | null = null;
  if (hudLayer !== null) {
    hud = hudLayer.ownerDocument.createElement("div");
    hud.className = "hud";
    hudLayer.append(hud);
  }

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
    hud,
    dispose(): void {
      for (const widget of widgets) {
        widget.dispose();
      }
      hud?.remove();
      loading.dispose();
    },
  };
}
