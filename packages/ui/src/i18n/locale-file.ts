import { defineSchema, describeSchema, map, str, toJsonSchema, u32 } from "@ignifx/core";
import { uiError, UiErrorCode } from "../errors.js";
import type { JsonSchemaObject, Schema, SchemaDescription } from "@ignifx/core";

/**
 * The `ignifx.i18n` document (`docs/architecture/06-serialization-and-scene-format.md` §6,
 * `13-ui.md` §3: *"loaded from `.json` assets"*).
 *
 * One file carries **every** locale, keyed by BCP 47 tag, because a game with two languages should
 * not need two fetches and a `locale` switch should not need a load at all:
 *
 * ```json
 * {
 *   "format": "ignifx.i18n",
 *   "formatVersion": 1,
 *   "defaultLocale": "en",
 *   "locales": {
 *     "en": { "hud.score": "Score: {score}" },
 *     "fr": { "hud.score": "Score : {score}" }
 *   }
 * }
 * ```
 *
 * A game that would rather ship one file per locale loads several documents and calls
 * `app.i18n.load` on each; the service merges them, later loads winning on a repeated key.
 */

/**
 * The `format` discriminator every translation document carries.
 *
 * @public
 */
export const I18N_FORMAT = "ignifx.i18n";

/**
 * The `formatVersion` this build writes and is the only one it can read. Before 1.0 the number
 * stays `1` and an incompatible change invalidates files rather than migrating them
 * (`CONSTITUTION.md` §4.2); a file declaring anything else is rejected with `IGX-1302`.
 *
 * @public
 */
export const I18N_FORMAT_VERSION = 1;

/**
 * The asset type translation documents are registered under.
 *
 * @public
 */
export const I18N_ASSET_TYPE = "i18n";

/**
 * The file extensions the translation loader claims.
 *
 * @public
 */
export const I18N_FILE_EXTENSIONS: readonly string[] = Object.freeze([".i18n.json"]);

/**
 * A parsed `ignifx.i18n` document.
 *
 * @public
 */
export interface LocaleDocument {
  /** The locale used when nothing else selected one. */
  readonly defaultLocale: string;
  /** Every locale's message table, keyed by BCP 47 tag. */
  readonly locales: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * Narrows a parsed JSON value to an object.
 *
 * @param value - The value.
 * @returns The object, or `null` when the value is an array, a primitive, or absent.
 */
function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // The guard above is exactly "a plain object", which
  // is a string-keyed bag of unknowns.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Record<string, unknown>;
}

/**
 * Reads one locale's table, dropping any entry whose value is not a string.
 *
 * @param value - The raw table.
 * @returns The strings.
 */
function readTable(value: unknown): Record<string, string> {
  const source = asObject(value);
  const table: Record<string, string> = {};
  if (source === null) {
    return table;
  }
  for (const key of Object.keys(source).toSorted()) {
    const message = source[key];
    if (typeof message === "string") {
      table[key] = message;
    }
  }
  return table;
}

/**
 * Parses and validates a translation document.
 *
 * @param value - The parsed JSON.
 * @param address - The address it came from, for the error's context.
 * @returns The document.
 * @throws IgnifxError with code `IGX-1302` when the header is missing, the version does not match,
 * or the file declares no locales.
 *
 * @example
 * ```ts
 * const document = parseLocaleFile(
 *   { format: "ignifx.i18n", formatVersion: 1, defaultLocale: "en", locales: { en: { ok: "OK" } } },
 *   "ui/strings.i18n.json",
 * );
 * document.locales["en"]?.["ok"]; // "OK"
 * ```
 *
 * @public
 */
export function parseLocaleFile(value: unknown, address: string): LocaleDocument {
  const file = asObject(value);
  if (file === null || file["format"] !== I18N_FORMAT || file["formatVersion"] !== I18N_FORMAT_VERSION) {
    throw uiError(UiErrorCode.invalidLocaleFile, `${address} is not an ${I18N_FORMAT} document this build can read.`, {
      context: { file: address },
      hint: `This build reads ${I18N_FORMAT} version ${String(I18N_FORMAT_VERSION)}.`,
    });
  }
  const raw = asObject(file["locales"]);
  const tags = raw === null ? [] : Object.keys(raw).toSorted();
  if (tags.length === 0) {
    throw uiError(UiErrorCode.invalidLocaleFile, `${address} declares no locales.`, {
      context: { file: address },
      hint: 'Add at least one entry to the "locales" object, keyed by BCP 47 tag.',
    });
  }
  const locales: Record<string, Readonly<Record<string, string>>> = {};
  for (const tag of tags) {
    locales[tag] = readTable(raw?.[tag]);
  }
  const declared = file["defaultLocale"];
  const fallback = tags[0] ?? "";
  const defaultLocale = typeof declared === "string" && Object.hasOwn(locales, declared) ? declared : fallback;
  return { defaultLocale, locales };
}

/**
 * A loaded translation document (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * @remarks
 * Pure data: it loads identically under Node and in a browser and has nothing to release.
 *
 * @example
 * ```ts
 * const strings = await app.assets.loadAsync<LocaleAsset>("ui/strings.i18n.json");
 * strings.value.availableLocales; // ["en", "fr"]
 * ```
 *
 * @public
 */
export class LocaleAsset {
  /** The type name the asset service registers translation documents under. */
  static assetType: string = I18N_ASSET_TYPE;

  /** The address the document was loaded from. */
  readonly address: string;

  /** The parsed document. */
  readonly document: LocaleDocument;

  /**
   * Wraps a parsed document. The `i18n` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param document - The parsed document.
   *
   * @internal
   */
  constructor(address: string, document: LocaleDocument) {
    this.address = address;
    this.document = document;
  }

  /**
   * Every locale the document declares, sorted.
   *
   * @returns The BCP 47 tags.
   */
  get availableLocales(): readonly string[] {
    return Object.keys(this.document.locales);
  }
}

/**
 * The schema a translation document is described and validated against for tooling.
 *
 * @remarks
 * The loader validates with {@link parseLocaleFile}, which produces an actionable `IGX-1302`
 * naming the file; this schema is what `pnpm docs:schemas` renders and what a JSON Schema for an
 * editor is generated from — the split `@ignifx/2d`'s `file-schemas.ts` documents.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function localeFileSchema(): Schema {
  return defineSchema({
    format: str(I18N_FORMAT, { tooltip: "Always ignifx.i18n." }),
    formatVersion: u32(I18N_FORMAT_VERSION, { tooltip: "The document version this build reads." }),
    defaultLocale: str("en", { tooltip: "The locale used until the game picks another." }),
    locales: map(map(str()), { tooltip: "Message tables keyed by BCP 47 tag, then by message key." }),
  });
}

/**
 * Describes the `ignifx.i18n` file format for the documentation harness.
 *
 * @returns The record `pnpm docs:schemas` renders.
 *
 * @public
 */
export function describeLocaleFileFormat(): SchemaDescription {
  return describeSchema("ignifx/i18n-file", localeFileSchema(), {
    title: "Translations",
    format: I18N_FORMAT,
    description: "Message tables for one or more locales, with {name} interpolation and ICU-style plurals.",
  });
}

/**
 * The JSON Schema a tool validates a `.i18n.json` document against.
 *
 * @returns The JSON Schema object.
 *
 * @public
 */
export function localeJsonSchema(): JsonSchemaObject {
  return toJsonSchema(localeFileSchema());
}
