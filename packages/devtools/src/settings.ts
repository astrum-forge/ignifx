import { array, bool, defineSchema, enumOf, f32, str } from "@ignifx/core";
import type { Schema } from "@ignifx/core";

/**
 * The `devtools` project settings section (`docs/architecture/04-extensions.md` §5,
 * `15-devtools-and-diagnostics.md` §4). Everything here is what a game writes in
 * `ignifx.config.ts`; the knobs a developer flips while the overlay is up live on `app.devtools`.
 */

/**
 * The section name as it appears in `ignifx.config.ts`.
 *
 * @public
 */
export const DEVTOOLS_SETTINGS_SECTION = "devtools";

/**
 * Every panel name, in the order `15-devtools-and-diagnostics.md` §4 lists them. The `panels`
 * setting is a re-ordering — and, by omission, a filter — of this list.
 *
 * @public
 */
export const DEVTOOLS_PANEL_NAMES = [
  "stats",
  "scene",
  "inspector",
  "assets",
  "input",
  "audio",
  "physics",
  "console",
  "timeline",
] as const;

/**
 * The union of the nine panel names.
 *
 * @public
 */
export type DevtoolsPanelName = (typeof DEVTOOLS_PANEL_NAMES)[number];

/**
 * Where the overlay is docked against the canvas.
 *
 * @public
 */
export const DEVTOOLS_POSITIONS = ["right", "left", "top", "bottom"] as const;

/**
 * The edge of the canvas the overlay is docked to.
 *
 * @public
 */
export type DevtoolsPosition = (typeof DEVTOOLS_POSITIONS)[number];

/**
 * The resolved `devtools` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default defineConfig({
 *   devtools: { toggleKey: "F1", openOnStart: true, panels: ["stats", "console"] },
 * });
 * ```
 *
 * @public
 */
export interface DevtoolsSettings {
  /**
   * The `KeyboardEvent.code` that toggles the overlay. Defaults to `"Backquote"` — the backtick
   * `15-devtools-and-diagnostics.md` §4 names. The listener is a raw `keydown` on the document, so
   * the key works with or without `@ignifx/input` (`08-input.md` §5).
   */
  readonly toggleKey: string;
  /** Whether the overlay is open the moment the app starts. Defaults to `false`. */
  readonly openOnStart: boolean;
  /**
   * Whether a `SceneAsset` that hot-reloads re-instantiates its live scene instances
   * (`15-devtools-and-diagnostics.md` §5). Defaults to `false`.
   */
  readonly reloadScenes: boolean;
  /**
   * The panels to show, in tab order. Names outside {@link DEVTOOLS_PANEL_NAMES} are ignored.
   * Defaults to every panel in the documented order.
   */
  readonly panels: readonly string[];
  /** The canvas edge the overlay docks to. Defaults to `"right"`. */
  readonly position: DevtoolsPosition;
  /** The overlay's background opacity, `0`–`1`. Defaults to `0.92`. */
  readonly opacity: number;
}

/**
 * The values used for everything a project omits.
 *
 * @returns The default `devtools` section.
 *
 * @public
 */
export function defaultDevtoolsSettings(): DevtoolsSettings {
  return {
    toggleKey: "Backquote",
    openOnStart: false,
    reloadScenes: false,
    panels: [...DEVTOOLS_PANEL_NAMES],
    position: "right",
    opacity: 0.92,
  };
}

/**
 * The schema the `devtools` section is validated against.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function devtoolsSettingsSchema(): Schema {
  return defineSchema({
    toggleKey: str("Backquote", { tooltip: "The KeyboardEvent.code that toggles the overlay." }),
    openOnStart: bool(false, { tooltip: "Whether the overlay is open when the app starts." }),
    reloadScenes: bool(false, { tooltip: "Re-instantiate scene instances when their file changes." }),
    panels: array(str(), [...DEVTOOLS_PANEL_NAMES], { tooltip: "The panels to show, in tab order." }),
    position: enumOf(DEVTOOLS_POSITIONS, "right", { tooltip: "The canvas edge the overlay docks to." }),
    opacity: f32(0.92, { min: 0, max: 1, step: 0.01, tooltip: "The overlay's background opacity." }),
  });
}

/**
 * Narrows a list of names to the panels this build knows, dropping unknown names and duplicates
 * while keeping the caller's order.
 *
 * @param names - The `panels` setting.
 * @returns The panel names to build, in tab order.
 *
 * @internal
 */
export function resolvePanelOrder(names: readonly string[]): readonly DevtoolsPanelName[] {
  const known = new Set<string>(DEVTOOLS_PANEL_NAMES);
  const seen = new Set<string>();
  const out: DevtoolsPanelName[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index] ?? "";
    if (!known.has(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    // Boundary narrowing (coding standards §5.2): `known` is built from the `as const` table, so a
    // name it contains is one of its members.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
    out.push(name as DevtoolsPanelName);
  }
  return out;
}
