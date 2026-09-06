import type { App } from "@ignifx/core";
import type { InputOverridesJson } from "@ignifx/input";

/**
 * The player's settings, and the two things that persist them: `app.storage.namespace("settings")`
 * for the sliders and toggles, and the same namespace for `app.input.saveOverrides()`.
 *
 * ## The header is the point
 *
 * Every ignifx document carries `format` and `formatVersion`, and so does this one. A settings blob
 * or a rebinding set written by an older build of the template is **discarded with a warning**, not
 * migrated and not thrown: a player who updates the game gets the defaults back, which is annoying
 * once, where an exception at boot is a game that does not start. `saveOverrides()` addresses a
 * binding by index, so a template that reorders an action's bindings invalidates its saved
 * rebindings — `@ignifx/input` says so loudly with `IGX-0808`, and the load below catches it for
 * exactly that reason.
 */

/** The `format` every settings document written by this template carries. */
export const SETTINGS_FORMAT = "ignifx-template.settings";

/** The version of {@link SETTINGS_FORMAT} this build reads and writes. */
export const SETTINGS_FORMAT_VERSION = 1;

/** The storage namespace the settings and the rebindings share. */
export const SETTINGS_NAMESPACE = "settings";

/** The key the settings document is stored under. */
export const SETTINGS_KEY = "game";

/** The key `app.input.saveOverrides()`'s document is stored under. */
export const BINDINGS_KEY = "bindings";

/** What the settings screen writes and what {@link applySettings} reads. */
export interface GameSettings {
  /** Always {@link SETTINGS_FORMAT}. Typed as a string because it is read back from JSON. */
  readonly format: string;
  /** The document version; anything but {@link SETTINGS_FORMAT_VERSION} is discarded. */
  readonly formatVersion: number;
  /** The `Master` bus's linear gain, 0 to 1. */
  masterVolume: number;
  /** The `Music` bus's linear gain, 0 to 1. */
  musicVolume: number;
  /** The `SFX` bus's linear gain, 0 to 1. The `UI` bus follows it. */
  sfxVolume: number;
  /** `app.renderer.resolutionScale`, 0.5 to 1. */
  renderScale: number;
  /** Whether the level's shadow-casting light casts shadows. Ignored where the template has none. */
  shadows: boolean;
  /** Whether the post-process chain runs. Ignored where the template has none. */
  postProcessing: boolean;
  /** The `app.i18n` locale. */
  locale: string;
}

/** What a template hands {@link applySettings} so the graphics rows reach its own scene. */
export interface GraphicsHooks {
  /** Whether the template has a shadow-casting light at all. */
  readonly supportsShadows: boolean;
  /** Whether the template has a post-process chain at all. */
  readonly supportsPostProcessing: boolean;
  /** Turns the shadow-casting light's shadows on or off. */
  readonly setShadows: (enabled: boolean) => void;
  /** Turns the post-process chain on or off. */
  readonly setPostProcessing: (enabled: boolean) => void;
}

/** The lowest resolution scale the settings screen offers. `app.renderer` itself clamps at 0.25. */
export const MIN_RENDER_SCALE = 0.5;

/**
 * The settings a fresh installation starts with.
 *
 * @param locale - The locale to start in, normally `app.i18n.locale` after the strings have loaded.
 * @returns A new settings document.
 */
export function defaultSettings(locale: string): GameSettings {
  return {
    format: SETTINGS_FORMAT,
    formatVersion: SETTINGS_FORMAT_VERSION,
    masterVolume: 1,
    musicVolume: 0.6,
    sfxVolume: 0.8,
    renderScale: 1,
    shadows: true,
    postProcessing: true,
    locale,
  };
}

/**
 * Reads one number out of a stored document, falling back when it is missing or out of range.
 *
 * @param source - The stored record.
 * @param key - The field to read.
 * @param fallback - What to use when the field is unusable.
 * @param min - The lowest value accepted.
 * @param max - The highest value accepted.
 * @returns The number to use.
 */
function readNumber(source: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

/**
 * Reads one flag out of a stored document.
 *
 * @param source - The stored record.
 * @param key - The field to read.
 * @param fallback - What to use when the field is missing or not a boolean.
 * @returns The flag to use.
 */
function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Loads the settings, or the defaults when nothing usable is stored.
 *
 * @param app - The running app.
 * @param locale - The locale the defaults use, and the fallback for a stored locale the strings do
 *   not declare.
 * @returns The settings to apply.
 */
export async function loadSettings(app: App, locale: string): Promise<GameSettings> {
  const defaults = defaultSettings(locale);
  let source: Record<string, unknown> | null;
  try {
    // The generic is the caller's declaration, unchecked exactly as `JSON.parse`'s is, so this is a
    // *claim* about the stored shape rather than a proof of it — which is why every field below is
    // range-checked before it is used.
    source = await app.storage.namespace(SETTINGS_NAMESPACE).get<Record<string, unknown>>(SETTINGS_KEY);
  } catch (error: unknown) {
    app.log.warn("IGX-TPL-0001 the stored settings could not be read and were ignored: {error}", String(error));
    return defaults;
  }
  if (source === null) {
    return defaults;
  }
  if (source["format"] !== SETTINGS_FORMAT || source["formatVersion"] !== SETTINGS_FORMAT_VERSION) {
    app.log.warn(
      "IGX-TPL-0001 settings written as {format} v{version} were discarded; this build reads " +
        `${SETTINGS_FORMAT} v${String(SETTINGS_FORMAT_VERSION)}.`,
      String(source["format"]),
      String(source["formatVersion"]),
    );
    return defaults;
  }
  const storedLocale = source["locale"];
  return {
    format: SETTINGS_FORMAT,
    formatVersion: SETTINGS_FORMAT_VERSION,
    masterVolume: readNumber(source, "masterVolume", defaults.masterVolume, 0, 1),
    musicVolume: readNumber(source, "musicVolume", defaults.musicVolume, 0, 1),
    sfxVolume: readNumber(source, "sfxVolume", defaults.sfxVolume, 0, 1),
    renderScale: readNumber(source, "renderScale", defaults.renderScale, MIN_RENDER_SCALE, 1),
    shadows: readBoolean(source, "shadows", defaults.shadows),
    postProcessing: readBoolean(source, "postProcessing", defaults.postProcessing),
    locale:
      typeof storedLocale === "string" && app.i18n.availableLocales.includes(storedLocale) ? storedLocale : locale,
  };
}

/**
 * Writes the settings.
 *
 * @param app - The running app.
 * @param settings - The document to store.
 * @returns A promise that settles once the write is durable.
 */
export async function saveSettings(app: App, settings: GameSettings): Promise<void> {
  try {
    await app.storage.namespace(SETTINGS_NAMESPACE).set(SETTINGS_KEY, { ...settings });
  } catch (error: unknown) {
    app.log.warn("IGX-TPL-0002 the settings could not be stored: {error}", String(error));
  }
}

/**
 * Applies the settings to the running app: the three bus gains, the resolution scale, the shadow
 * and post-process switches, and the locale.
 *
 * @param app - The running app.
 * @param settings - The settings to apply.
 * @param graphics - How the graphics rows reach this template's scene.
 */
export function applySettings(app: App, settings: GameSettings, graphics: GraphicsHooks): void {
  app.audio.tryBus("Master")?.setVolume(settings.masterVolume, 0.05);
  app.audio.tryBus("Music")?.setVolume(settings.musicVolume, 0.05);
  app.audio.tryBus("SFX")?.setVolume(settings.sfxVolume, 0.05);
  // The UI bus follows the effects slider rather than getting one of its own: a player who turns
  // effects down does not expect the menu to stay loud, and a fourth slider for two clicks and a
  // hover is a settings screen nobody reads.
  app.audio.tryBus("UI")?.setVolume(settings.sfxVolume, 0.05);
  app.renderer.resolutionScale = settings.renderScale;
  if (graphics.supportsShadows) {
    graphics.setShadows(settings.shadows);
  }
  if (graphics.supportsPostProcessing) {
    graphics.setPostProcessing(settings.postProcessing);
  }
  if (settings.locale !== app.i18n.locale && app.i18n.availableLocales.includes(settings.locale)) {
    app.i18n.locale = settings.locale;
  }
}

/**
 * Loads the saved binding overrides onto `app.input`.
 *
 * @remarks
 * A stored document that no longer matches the template's bindings is `IGX-0808`, which is caught
 * here and dropped: overrides addressed by index cannot survive an action whose bindings were
 * reordered, and a game that refuses to start because of a rebinding is worse than one that
 * forgets it.
 *
 * @param app - The running app.
 * @returns A promise that settles once the overrides have been applied or discarded.
 */
export async function loadInputOverrides(app: App): Promise<void> {
  let stored: InputOverridesJson | null;
  try {
    stored = await app.storage.namespace(SETTINGS_NAMESPACE).get<InputOverridesJson>(BINDINGS_KEY);
  } catch (error: unknown) {
    app.log.warn("IGX-TPL-0003 the stored rebindings could not be read and were ignored: {error}", String(error));
    return;
  }
  if (stored === null) {
    return;
  }
  if (stored.format !== "ignifx.inputoverrides") {
    app.log.warn("IGX-TPL-0003 the stored rebindings are not an ignifx.inputoverrides document; they were discarded.");
    await clearStoredOverrides(app);
    return;
  }
  try {
    app.input.loadOverrides(stored);
  } catch (error: unknown) {
    app.log.warn(
      "IGX-TPL-0003 the stored rebindings no longer fit this build and were discarded: {error}",
      String(error),
    );
    await clearStoredOverrides(app);
  }
}

/**
 * Stores the current binding overrides.
 *
 * @param app - The running app.
 * @returns A promise that settles once the write is durable.
 */
export async function saveInputOverrides(app: App): Promise<void> {
  try {
    await app.storage.namespace(SETTINGS_NAMESPACE).set(BINDINGS_KEY, app.input.saveOverrides());
  } catch (error: unknown) {
    app.log.warn("IGX-TPL-0002 the rebindings could not be stored: {error}", String(error));
  }
}

/**
 * Drops every override, in memory and in storage.
 *
 * @param app - The running app.
 * @returns A promise that settles once the stored document is gone.
 */
export async function resetInputOverrides(app: App): Promise<void> {
  app.input.clearOverrides();
  await clearStoredOverrides(app);
}

/**
 * Removes the stored overrides document.
 *
 * @param app - The running app.
 * @returns A promise that settles once the key is gone.
 */
async function clearStoredOverrides(app: App): Promise<void> {
  try {
    await app.storage.namespace(SETTINGS_NAMESPACE).delete(BINDINGS_KEY);
  } catch (error: unknown) {
    app.log.warn("IGX-TPL-0002 the stored rebindings could not be removed: {error}", String(error));
  }
}
