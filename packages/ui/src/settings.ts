import { array, bool, defineSchema, enumOf, str, u32 } from "@ignifx/core";
import type { Schema } from "@ignifx/core";

/**
 * The `ui` project settings section (`docs/architecture/04-extensions.md` §5, `13-ui.md` §1).
 * Everything here is what a game writes in `ignifx.config.ts`; the knobs a game changes per frame
 * live on `app.ui` and on the individual layers instead.
 */

/**
 * The section name as it appears in `ignifx.config.ts`.
 *
 * @public
 */
export const UI_SETTINGS_SECTION = "ui";

/**
 * Every scaling mode the overlay host supports, in the order an inspector should list them
 * (`docs/architecture/13-ui.md` §1).
 *
 * @public
 */
export const UI_SCALING_MODES = ["css", "fit", "dpi"] as const;

/**
 * How the overlay's coordinate system relates to the canvas.
 *
 * @remarks
 * - `"css"` — one UI unit is one CSS pixel and nothing is scaled. The browser default, and what a
 *   responsive HTML menu wants.
 * - `"fit"` — the root is exactly {@link UiSettings.referenceResolution} CSS pixels and is scaled
 *   uniformly to fit inside the canvas, keeping aspect and centring the letterbox. A HUD authored
 *   once at 1920x1080 then looks the same on every window size.
 * - `"dpi"` — one UI unit is one **render-target** pixel: the root is sized to the canvas's
 *   backing store and scaled by `1 / devicePixelRatio` so it still covers the same area. This is
 *   the space `Camera.worldToScreen`, `HudText`, and `app.renderer.captureScreenshot()` all work
 *   in, so an element placed at `left: 100px` lands on render-target column 100 exactly.
 *
 * @public
 */
export type UiScalingMode = (typeof UI_SCALING_MODES)[number];

/**
 * The resolved `ui` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default defineConfig({
 *   ui: { scaling: "fit", referenceResolution: [640, 360], layers: ["hud", "menu"] },
 * });
 * ```
 *
 * @public
 */
export interface UiSettings {
  /** How the overlay's coordinate system relates to the canvas. Defaults to `"css"`. */
  readonly scaling: UiScalingMode;
  /**
   * The `[width, height]`, in UI units, that `"fit"` scales to. Ignored by the other two modes.
   * Defaults to `[1920, 1080]`.
   */
  readonly referenceResolution: readonly number[];
  /**
   * The layers created eagerly, back to front. Declaring them here is what makes their stacking
   * order independent of the order the game happens to call {@link UiHost.layer} in.
   */
  readonly layers: readonly string[];
  /** Whether the overlay is shown at all. Defaults to `true`. */
  readonly visible: boolean;
}

/**
 * The z-index step between two consecutive layers. The first declared layer sits at
 * `UI_LAYER_Z_STEP`, the second at twice that, and so on, which leaves nine free slots between any
 * two layers for a game that wants to interleave its own elements.
 *
 * @public
 */
export const UI_LAYER_Z_STEP = 10;

/**
 * The values used for everything a project omits.
 *
 * @returns The default `ui` section.
 *
 * @public
 */
export function defaultUiSettings(): UiSettings {
  return { scaling: "css", referenceResolution: [1920, 1080], layers: ["hud", "menu", "overlay"], visible: true };
}

/**
 * The schema the `ui` section is validated against.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function uiSettingsSchema(): Schema {
  return defineSchema({
    scaling: enumOf(UI_SCALING_MODES, "css", { tooltip: "How the overlay's units map onto the canvas." }),
    referenceResolution: array(u32(1), [1920, 1080], {
      tooltip: 'The [width, height] the "fit" mode scales to.',
    }),
    layers: array(str(), ["hud", "menu", "overlay"], {
      tooltip: "The layers created up front, back to front.",
    }),
    visible: bool(true, { tooltip: "Whether the overlay is shown." }),
  });
}
