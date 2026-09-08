import { bool, Color, defineSchema, enumOf, f32, map, RENDERING_SETTINGS_SECTION } from "@ignifx/core";
import type { App, ColorLike, RenderingSettings, Schema } from "@ignifx/core";

/**
 * The `twoD` project settings section (`docs/architecture/04-extensions.md` §5,
 * `11-2d-toolkit.md` §1 and §7). Everything here is what a game writes in `ignifx.config.ts` or in
 * a scene file's `settings.twoD` block; the knobs a game changes per frame live on `app.twoD` and
 * on `Camera2D` instead.
 */

/**
 * The section name as it appears in `ignifx.config.ts` and in a scene file's `settings` block.
 *
 * @public
 */
export const TWO_D_SETTINGS_SECTION = "twoD";

/**
 * Every rendering mode the 2D toolkit supports, in the order an inspector should list them
 * (`docs/architecture/11-2d-toolkit.md` §1).
 *
 * @public
 */
export const TWO_D_MODES = ["sprite", "mixed"] as const;

/**
 * How 2D composites with the 3D render scene.
 *
 * @remarks
 * `"sprite"` is a pure 2D game: sprites are the only thing drawn. `"mixed"` is 2.5D — the render
 * scene draws first and the sprite pass composites on top without clearing, so meshes and sprites
 * share a frame.
 *
 * @public
 */
export type TwoDMode = (typeof TWO_D_MODES)[number];

/**
 * The resolved `twoD` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default defineConfig({
 *   sortingLayers: { sortingLayers: ["Background", "Default", "Foreground"] },
 *   twoD: { mode: "sprite", pixelsPerUnit: 16, ySort: { Default: true } },
 * });
 * ```
 *
 * @public
 */
export interface TwoDSettings {
  /** Whether sprites are the whole frame (`"sprite"`) or composite over the 3D scene (`"mixed"`). */
  readonly mode: TwoDMode;
  /** How many pixels one world metre spans. Defaults to `100`. */
  readonly pixelsPerUnit: number;
  /**
   * Which sorting layers draw back-to-front by world Y rather than by `orderInLayer`. A layer the
   * record does not mention does not Y-sort.
   */
  readonly ySort: Readonly<Record<string, boolean>>;
}

/**
 * The values used for everything a project omits.
 *
 * @returns The default `twoD` section.
 *
 * @public
 */
export function defaultTwoDSettings(): TwoDSettings {
  return { mode: "sprite", pixelsPerUnit: 100, ySort: {} };
}

/**
 * The schema the `twoD` section is validated against, in `ignifx.config.ts` and in a scene file
 * alike.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function twoDSettingsSchema(): Schema {
  return defineSchema({
    mode: enumOf(TWO_D_MODES, "sprite"),
    pixelsPerUnit: f32(100, { min: Number.EPSILON }),
    ySort: map(bool(false)),
  });
}

/**
 * The value a `"sprite"`-mode frame is cleared to, read from the **core** `rendering.clearColor`
 * setting and decoded the way the 3D path decodes it.
 *
 * @remarks
 * A `"sprite"`-mode sprite pass owns the frame: it clears the swapchain itself and nothing the
 * render scene did survives underneath, so `rendering.clearColor` would otherwise have no effect at
 * all in a 2D game. The precedence the 3D path documents —
 * `Camera.clearColor`, then `Environment.clearColor`, then the setting
 * (`docs/architecture/07-rendering.md` §2.1) — has only its last rung here: neither of those two
 * components exists in a 2D scene, and `Camera2D` has no `clearColor` field of its own.
 *
 * Colours are sRGB everywhere in ignifx and Lite's clear values are linear, so the setting is
 * decoded on the way through exactly as `RendererImpl.applyClearColor` decodes it. That is what
 * makes a `"sprite"` frame and a `"mixed"` frame with the same setting the same colour on screen,
 * and it is also why a literal `#14181F` presents darker than its hex suggests.
 *
 * @param app - The app whose settings are read.
 * @returns The clear value, as straight linear RGBA in `0` to `1`.
 *
 * @internal
 */
export function spriteClearColor(app: App): ColorLike {
  const { clearColor } = app.settings.section<RenderingSettings>(RENDERING_SETTINGS_SECTION);
  return {
    r: Color.srgbToLinear(clearColor.r),
    g: Color.srgbToLinear(clearColor.g),
    b: Color.srgbToLinear(clearColor.b),
    a: clearColor.a,
  };
}
