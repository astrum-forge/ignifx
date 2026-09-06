import { Signal } from "@ignifx/core";
import { uiError, UiErrorCode } from "../errors.js";
import { LocaleAsset } from "./locale-file.js";
import { createPluralSelector, parseMessage, renderMessage } from "./message.js";
import type { MessageParams, MessagePattern, PluralSelector } from "./message.js";
import type { AssetHandle, Logger, SignalLike } from "@ignifx/core";

/**
 * The localization service behind `app.i18n` (`docs/architecture/13-ui.md` §3:
 * "a tiny key/value service with ICU-style plurals, loaded from `.json` assets; UI helpers and
 * `WorldText` accept keys"*).
 *
 * ## Missing keys are not errors
 *
 * `t("hud.score")` with no such key returns `"hud.score"` and logs one debug line per key. A game
 * that ships a new string before the translator does then shows the key rather than an empty box,
 * and a test can assert on the key. `IGX-1304` is reserved for a message that *is* present and
 * cannot be parsed — a genuine authoring mistake.
 *
 * ## Cost
 *
 * Patterns are parsed once and cached by their text, so a `t()` in `update` walks a node list.
 * Switching locale clears nothing: the cache is keyed by pattern, not by key, and two locales that
 * share a pattern share its parse.
 */

/** What a plain empty parameter set is, so `t(key)` allocates nothing. */
const NO_PARAMS: MessageParams = Object.freeze({});

/**
 * What {@link I18nService} is constructed with.
 *
 * @internal
 */
export interface I18nServiceOptions {
  /** The extension's logger. */
  readonly log: Logger;
  /** The locale the app starts in, before any document is loaded. */
  readonly locale: string;
}

/**
 * The localization service, reached as `app.i18n`.
 *
 * @example
 * ```ts
 * await app.i18n.load(app.assets.load<LocaleAsset>("ui/strings.i18n.json"));
 * app.i18n.locale = "fr";
 * app.i18n.t("hud.lives", { count: 3 });
 * ```
 *
 * @public
 */
export class I18nService {
  readonly #log: Logger;

  readonly #tables = new Map<string, Map<string, string>>();

  readonly #patterns = new Map<string, MessagePattern>();

  readonly #reportedMissing = new Set<string>();

  readonly #localeChanged = new Signal<string>();

  #locale: string;

  #fallbackLocale: string;

  #select: PluralSelector;

  /**
   * Builds an empty service. The extension does this; a game never constructs one.
   *
   * @param options - The logger and the starting locale.
   *
   * @internal
   */
  constructor(options: I18nServiceOptions) {
    this.#log = options.log;
    this.#locale = options.locale;
    this.#fallbackLocale = options.locale;
    this.#select = createPluralSelector(options.locale);
  }

  /**
   * The active locale. Writing a locale no loaded document declares throws `IGX-1303`, because a
   * silent no-op there is a bug that only shows up as untranslated text much later.
   *
   * @returns The BCP 47 tag.
   * @throws IgnifxError with code `IGX-1303` when no loaded document declares the tag.
   */
  get locale(): string {
    return this.#locale;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set locale(value: string) {
    if (this.#locale === value) {
      return;
    }
    if (this.#tables.size > 0 && !this.#tables.has(value)) {
      throw uiError(UiErrorCode.unknownLocale, `${value} is not a locale any loaded document declares.`, {
        context: { locale: value },
        hint: `Loaded locales: ${this.availableLocales.join(", ")}.`,
      });
    }
    this.#locale = value;
    this.#select = createPluralSelector(value);
    this.#localeChanged.emit(value);
  }

  /**
   * The locale a key falls back to when the active locale has no entry for it. Set from the first
   * document's `defaultLocale`.
   *
   * @returns The BCP 47 tag.
   */
  get fallbackLocale(): string {
    return this.#fallbackLocale;
  }

  // eslint-disable-next-line jsdoc/require-jsdoc -- the accessor pair is documented on the getter.
  set fallbackLocale(value: string) {
    this.#fallbackLocale = value;
  }

  /**
   * Every locale any loaded document declares, sorted.
   *
   * @returns The BCP 47 tags.
   */
  get availableLocales(): readonly string[] {
    return [...this.#tables.keys()].toSorted();
  }

  /**
   * Emitted after {@link I18nService.locale} changed. UI that caches rendered strings — `HudText`
   * does — redraws from here.
   *
   * @returns The signal.
   */
  get onLocaleChanged(): SignalLike<string> {
    return this.#localeChanged;
  }

  /**
   * Merges a translation document into the service.
   *
   * @remarks
   * Accepts a loaded {@link LocaleAsset} or the handle of one, in which case the merge happens when
   * the handle settles. Later loads win on a repeated key, which is what makes a per-locale
   * download or a downloadable language pack work. The first document loaded also sets
   * {@link I18nService.fallbackLocale} and, when the app is still on its starting locale and the
   * document does not declare it, moves the active locale to the document's `defaultLocale`.
   *
   * @param source - A loaded document, or its handle.
   * @returns A promise that settles once the document has been merged.
   *
   * @example
   * ```ts
   * using strings = app.assets.load<LocaleAsset>("ui/strings.i18n.json");
   * await app.i18n.load(strings);
   * ```
   */
  async load(source: AssetHandle<LocaleAsset> | LocaleAsset): Promise<void> {
    const asset = source instanceof LocaleAsset ? source : await source.promise;
    const first = this.#tables.size === 0;
    for (const [tag, table] of Object.entries(asset.document.locales)) {
      const existing = this.#tables.get(tag) ?? new Map<string, string>();
      for (const [key, message] of Object.entries(table)) {
        existing.set(key, message);
      }
      this.#tables.set(tag, existing);
    }
    this.#reportedMissing.clear();
    if (!first) {
      return;
    }
    this.#fallbackLocale = asset.document.defaultLocale;
    if (!this.#tables.has(this.#locale)) {
      this.#locale = asset.document.defaultLocale;
      this.#select = createPluralSelector(this.#locale);
      this.#localeChanged.emit(this.#locale);
    }
  }

  /**
   * Whether the active locale, or the fallback, has an entry for a key.
   *
   * @param key - The message key.
   * @returns `true` when {@link I18nService.t} will find a message.
   */
  has(key: string): boolean {
    return this.#lookup(key) !== null;
  }

  /**
   * Renders a message.
   *
   * @param key - The message key.
   * @param params - The values `{name}` placeholders and plural selectors read.
   * @returns The rendered message, or the key itself when no document declares it.
   *
   * @example
   * ```ts
   * app.i18n.t("hud.lives", { count: 1 }); // "1 life"
   * app.i18n.t("hud.lives", { count: 4 }); // "4 lives"
   * ```
   */
  t(key: string, params: MessageParams = NO_PARAMS): string {
    const message = this.#lookup(key);
    if (message === null) {
      if (!this.#reportedMissing.has(key)) {
        this.#reportedMissing.add(key);
        this.#log.debug(`No translation for ${key} in ${this.#locale}; showing the key.`);
      }
      return key;
    }
    return renderMessage(this.#pattern(key, message), params, this.#select);
  }

  /**
   * Drops every loaded document.
   *
   * @internal
   */
  clear(): void {
    this.#tables.clear();
    this.#patterns.clear();
    this.#reportedMissing.clear();
  }

  /**
   * Releases everything the service holds.
   *
   * @internal
   */
  dispose(): void {
    this.clear();
    this.#localeChanged.clear();
  }

  /**
   * Finds a key in the active locale, then in the fallback.
   *
   * @param key - The message key.
   * @returns The raw pattern, or `null`.
   */
  #lookup(key: string): string | null {
    return this.#tables.get(this.#locale)?.get(key) ?? this.#tables.get(this.#fallbackLocale)?.get(key) ?? null;
  }

  /**
   * Parses a pattern, or returns the cached parse.
   *
   * @param key - The message key, for the `IGX-1304` context.
   * @param message - The raw pattern.
   * @returns The parsed pattern; an unreadable one renders as its own raw text.
   */
  #pattern(key: string, message: string): MessagePattern {
    const cached = this.#patterns.get(message);
    if (cached !== undefined) {
      return cached;
    }
    const parsed = parseMessage(message);
    if (parsed.error !== null) {
      const error = uiError(UiErrorCode.invalidMessagePattern, `Message ${key} could not be parsed: ${parsed.error}.`, {
        context: { key, reason: parsed.error },
        hint: "Braces are structural in an ignifx.i18n message; a literal brace has to arrive as a parameter.",
      });
      this.#log.warn(error.message);
    }
    this.#patterns.set(message, parsed);
    return parsed;
  }
}
