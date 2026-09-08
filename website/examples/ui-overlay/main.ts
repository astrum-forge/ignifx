import { Camera, Dialog, FONT_ASSET_TYPE, HudText, Script, Toast } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { button, readout, select, toggle } from "../_kit/panel.ts";
import { createGridGround, createLightRig } from "../_kit/stage.ts";
import { createHud } from "./hud.ts";
import { createProps, Spinner } from "./props.ts";
import type { Hud } from "./hud.ts";
import type { AssetHandle, FontAsset, ScriptCallbacks, UiScalingMode } from "ignifx";

/**
 * The overlay, all four of its parts, over a scene you can still see.
 *
 * `@ignifx/ui` puts one absolutely positioned `<div>` over the canvas and hands a game named
 * layers inside it. **Game UI in ignifx is HTML**, which is what buys real fonts, real layout,
 * screen readers and any framework the team already knows. So:
 *
 * - the HUD panel and its safe-area frame are plain DOM in `app.ui.layer("hud")` (`hud.ts`);
 * - `Dialog` and `Toast` are DOM helpers with no styling opinions, in the `menu` and `overlay`
 *   layers, stacked by layer rather than by luck;
 * - `HudText` is the exception — **GPU** text, positioned in backing-store pixels, which is the one
 *   tool for text that has to line up with `captureScreenshot()`.
 *
 * The Scaling select is the part worth playing with. It decides what a UI unit *is*: a CSS pixel
 * (`css`), a pixel of a fixed reference resolution (`fit`, letterboxed), or a backing-store pixel
 * (`dpi`). Switch it and the DOM half of the overlay changes size while the `HudText` above it does
 * not, because the two live in different spaces — `app.ui.pixelMapping` is the conversion between
 * them. The parameter panel is DOM in a layer too, so it resizes with the HUD.
 *
 * One gotcha is load-bearing and this file shows the fix rather than describing it: **a `Toast`
 * runs on the game clock and nothing advances it for you.** The script that does declares
 * `static updateWhenPaused = true` and passes `app.time.unscaledDeltaTime`, so the message the
 * dialog raises still expires — the dialog paused the game to ask.
 */

/** The font `HudText` draws with. Vendored, OFL-1.1; see `assets/ATTRIBUTION.md`. */
const FONT_ADDRESS = "fonts/share-tech-mono.ttf";

/** The reference resolution `"fit"` letterboxes to: the size this HUD was drawn for. */
const REFERENCE: readonly [number, number] = [960, 540];

/** The scaling modes, in the order the select offers them. */
const MODES: readonly UiScalingMode[] = ["css", "fit", "dpi"];

/** What the score reads before anything has been scored. */
const START_SCORE = 1200;
/**
 * Advances the toasts and re-reads the HUD's figures, whether the game is running or not.
 *
 * @remarks
 * `updateWhenPaused` is the whole point of the class. `app.pause()` stops `update` for every
 * ordinary script, so a "Back in" toast raised from a modal that paused the game would sit on
 * screen for ever — and the HUD's figures would freeze with it.
 */
class OverlayClock extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "ui-overlay/OverlayClock";

  /** Keeps running while the game is paused, which is when a menu raises a toast. */
  static updateWhenPaused = true;

  /** The toast stack to advance. Assigned in code; not something a scene file could carry. */
  toasts: Toast | null = null;

  /** The HUD to refresh, or `null` on an app with no overlay. */
  hud: Hud | null = null;

  /** Advances every message's timer and rewrites the HUD's figures. */
  update(): void {
    this.toasts?.advance(this.app.time.unscaledDeltaTime);
    this.hud?.update(this.app.ui.layout);
  }
}

bootExample({
  title: "UI overlay",
  settings: {
    rendering: {
      clearColor: { r: 0.043, g: 0.059, b: 0.094, a: 1 },
      msaaSamples: 4,
      features: { shadows: true },
    },
    // The overlay's own settings section. Both are live on `app.ui` as well, which is what the
    // Scaling select writes.
    ui: { scaling: "css", referenceResolution: [...REFERENCE] },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    app.registerComponents([OverlayClock, Spinner]);

    const focus = { x: 0, y: 0.55, z: 0 };
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 200, fov: 40 });
    attachOrbit(app, eye, { yaw: 18, pitch: 24, distance: 3.9, target: focus, minDistance: 2, maxDistance: 12 });
    createLightRig(app, { focus, shadows: true, shadowDarkness: 0.3 });
    await createGridGround(app, { size: 24 });
    createProps(app);

    // Awaited before `app.start()`, so the glyphs are shaped for the first frame rather than a
    // frame or two later — which is what makes a capture of this example reproducible.
    const font: AssetHandle<FontAsset> = app.assets.load(FONT_ADDRESS, { type: FONT_ASSET_TYPE });
    await font.promise;
    const score = app.world.createEntity("Score").addComponent(HudText, {
      font,
      text: `SCORE ${String(START_SCORE).padStart(6, "0")}`,
      anchor: "topLeft",
      position: { x: 24, y: 22 },
      fontSize: 30,
      color: { r: 1, g: 0.72, b: 0.42, a: 1 },
    });

    const hud = createHud(app.ui);
    const toasts = new Toast(app.ui, { duration: 3, maxVisible: 3 });
    // Re-used rather than rebuilt per question: a `Dialog` is always above the other roots of its
    // layer, and one per question leaves a stack of modals in the document.
    const dialog = new Dialog(app.ui, {
      title: "Leave the run?",
      message: "Progress since the last checkpoint is lost. A Dialog is plain DOM with no styling opinions.",
      buttons: [
        { id: "stay", label: "Keep playing" },
        { id: "leave", label: "Leave" },
      ],
      dismissOnBackdrop: true,
      visible: false,
    });
    dialog.onChosen.connect((id: string): void => {
      dialog.hide();
      app.resume();
      toasts.show(id === "leave" ? "Run abandoned" : "Back in");
    });

    const clock = app.world.createEntity("Overlay").addComponent(OverlayClock);
    clock.toasts = toasts;
    clock.hud = hud;

    panel({
      title: "UI overlay",
      groups: [
        {
          label: "Overlay",
          controls: [
            // One assignment is the whole switch: the host re-lays out the root, republishes the
            // scale and emits `onLayoutChanged`.
            select("Scaling", [...MODES], {
              value: app.ui.scaling,
              change: (mode: string): void => {
                app.ui.scaling = MODES.find((name: UiScalingMode): boolean => name === mode) ?? "css";
              },
            }),
            toggle("Simulate a notch", {
              value: false,
              change: (on: boolean): void => {
                hud?.setNotch(on);
              },
            }),
            // One layer, not the whole overlay: `app.ui.visible = false` would take the parameter
            // panel with it — it is mounted in a layer of its own — and leave nothing to turn it
            // back on with. Hiding a layer is what a game does for a cutscene anyway.
            toggle("HUD layer", {
              value: true,
              change: (on: boolean): void => {
                app.ui.layer("hud").visible = on;
              },
            }),
          ],
        },
        {
          label: "Widgets",
          controls: [
            button("Open the dialog", (): void => {
              // A modal question is what a game pauses for, and the widget does not do it for you.
              app.pause();
              dialog.show();
            }),
            button("Show a toast", (): void => {
              toasts.show("Checkpoint reached");
            }),
            button("Score +50", (): void => {
              // Changing `text` re-shapes the block and nothing else; changing `fontSize` would
              // rebuild it, which is why a per-frame counter is cheap and a per-frame size is not.
              const next = Number(score.text.slice(6)) + 50;
              score.text = `SCORE ${String(next).padStart(6, "0")}`;
            }),
          ],
        },
        {
          label: "Focus",
          collapsed: true,
          controls: [
            readout("Toasts on screen", (): string => String(toasts.messages.length)),
            readout("Pointer over UI", (): string => (app.ui.pointerOverUi ? "yes" : "no")),
            readout("Keyboard captured", (): string => (app.ui.keyboardHasFocus ? "yes" : "no")),
          ],
        },
      ],
    });
  },
});
