import { bool, defineSchema, f32, record, str } from "@ignifx/core";
import type { Schema } from "@ignifx/core";

/**
 * The `input` project settings section (`docs/architecture/04-extensions.md` §5,
 * `08-input.md` §2 and §4). Everything here is what a game writes in `ignifx.config.ts`; the
 * runtime knobs a game changes per frame live on `app.input` instead.
 */

/**
 * The section name as it appears in `ignifx.config.ts`.
 *
 * @public
 */
export const INPUT_SETTINGS_SECTION = "input";

/**
 * The pointer-lock half of the `input` section.
 *
 * @public
 */
export interface PointerLockSettings {
  /** Whether `app.input.pointerLock.request()` is allowed to ask the browser. Defaults to `true`. */
  readonly allowed: boolean;
}

/**
 * The resolved `input` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default defineConfig({ input: { actions: "input/default.input.json", pressPoint: 0.4 } });
 * ```
 *
 * @public
 */
export interface InputSettings {
  /** The address of the `.input.json` document loaded at startup; empty loads none. */
  readonly actions: string;
  /** The magnitude at which an analog value counts as pressed. Defaults to `0.5`. */
  readonly pressPoint: number;
  /** Whether gamepads are polled each frame. Defaults to `true`. */
  readonly gamepadPolling: boolean;
  /** Pointer-lock policy. */
  readonly pointerLock: PointerLockSettings;
  /** The control scheme the app starts in; empty picks the first the document declares. */
  readonly defaultScheme: string;
  /**
   * Whether a binding tagged with a control scheme resolves only while that scheme is active.
   * Defaults to `false`, which is Unity's behaviour and what most games want.
   */
  readonly strictSchemes: boolean;
}

/**
 * The values used for everything a project omits.
 *
 * @returns The default `input` section.
 *
 * @public
 */
export function defaultInputSettings(): InputSettings {
  return {
    actions: "",
    pressPoint: 0.5,
    gamepadPolling: true,
    pointerLock: { allowed: true },
    defaultScheme: "",
    strictSchemes: false,
  };
}

/**
 * The schema the `input` section is validated against.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function inputSettingsSchema(): Schema {
  return defineSchema({
    actions: str(""),
    pressPoint: f32(0.5, { min: 0, max: 1 }),
    gamepadPolling: bool(true),
    pointerLock: record({ allowed: bool(true) }),
    defaultScheme: str(""),
    strictSchemes: bool(false),
  });
}
