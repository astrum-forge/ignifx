import { array, bool, defineSchema, f32, str } from "@ignifx/core";
import type { Schema } from "@ignifx/core";

/**
 * The `audio` project settings section (`docs/architecture/04-extensions.md` §5,
 * `10-audio.md` §1 and §6). Everything here is what a game writes in `ignifx.config.ts`; the knobs
 * a game turns per frame — a bus fader, the master volume — live on `app.audio` instead.
 */

/**
 * The section name as it appears in `ignifx.config.ts`.
 *
 * @public
 */
export const AUDIO_SETTINGS_SECTION = "audio";

/**
 * The bus tree built when a project declares no `.audio.json`
 * (`docs/architecture/10-audio.md` §1). Every bus after the first routes into `"Master"`.
 *
 * @public
 */
export const DEFAULT_AUDIO_BUSES: readonly string[] = Object.freeze(["Master", "Music", "SFX", "UI", "Voice"]);

/**
 * The buses `app.pause()` pauses by default: all of them except `"UI"`, so a pause menu can still
 * click (`docs/architecture/10-audio.md` §6).
 *
 * @public
 */
export const DEFAULT_PAUSABLE_BUSES: readonly string[] = Object.freeze(["Master", "Music", "SFX", "Voice"]);

/**
 * The bus `app.audio.playOneShot` and a fresh `AudioSource` route into.
 *
 * @public
 */
export const DEFAULT_SOUND_BUS = "SFX";

/**
 * The resolved `audio` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default defineConfig({ audio: { buses: "audio/buses.audio.json", masterVolume: 0.8 } });
 * ```
 *
 * @public
 */
export interface AudioSettings {
  /** The address of the `.audio.json` bus tree loaded at startup; empty builds the defaults. */
  readonly buses: string;
  /** The tree built when `buses` is empty: the first name is the root, the rest route into it. */
  readonly defaultBuses: readonly string[];
  /** Which buses `app.pause()` pauses. A bus file's own `pausable` field overrides this per bus. */
  readonly pausableBuses: readonly string[];
  /** The master output gain the app starts at, in `[0, 1]`. */
  readonly masterVolume: number;
  /** Whether `play()` calls made before the first unlock are queued and flushed on unlock. */
  readonly queueWhileLocked: boolean;
  /** Whether `app.pause()` pauses the sounds on pausable buses. */
  readonly pauseWithApp: boolean;
}

/**
 * The values used for everything a project omits.
 *
 * @returns The default `audio` section.
 *
 * @public
 */
export function defaultAudioSettings(): AudioSettings {
  return {
    buses: "",
    defaultBuses: DEFAULT_AUDIO_BUSES,
    pausableBuses: DEFAULT_PAUSABLE_BUSES,
    masterVolume: 1,
    queueWhileLocked: true,
    pauseWithApp: true,
  };
}

/**
 * The schema the `audio` section is validated against.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function audioSettingsSchema(): Schema {
  return defineSchema({
    buses: str(""),
    defaultBuses: array(str(), DEFAULT_AUDIO_BUSES),
    pausableBuses: array(str(), DEFAULT_PAUSABLE_BUSES),
    masterVolume: f32(1, { min: 0, max: 1 }),
    queueWhileLocked: bool(true),
    pauseWithApp: bool(true),
  });
}
