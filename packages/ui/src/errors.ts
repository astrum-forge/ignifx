import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/ui` owns. The UI subsystem sits in the `13` range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1 — *"`13xx` UI"* — so every code reads
 * `IGX-13##`. `@ignifx/ui` is the only package in the range and owns all of it.
 *
 * The table lives here rather than in `@ignifx/core`'s `CoreErrorCode`: an extension owns its own
 * codes and hands them to the app through `ExtensionContext.registerErrorCodes`
 * (`docs/architecture/04-extensions.md` §3).
 */

/**
 * Every diagnostic code `@ignifx/ui` can throw or log, keyed by an intention-revealing name so call
 * sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw uiError(UiErrorCode.unknownLayer, "hud is not a declared UI layer.", {
 *   context: { layer: "hud" },
 * });
 * ```
 *
 * @public
 */
export const UiErrorCode = {
  /** A second `ui()` extension was registered on one app. */
  duplicateExtension: "IGX-1301",
  /** A `.i18n.json` file is not an `ignifx.i18n` document this build can read. */
  invalidLocaleFile: "IGX-1302",
  /** `app.i18n.locale` was set to a locale the loaded document does not declare. */
  unknownLocale: "IGX-1303",
  /** A message pattern could not be parsed: an unbalanced brace or an unknown argument form. */
  invalidMessagePattern: "IGX-1304",
  /** A widget that needs `@ignifx/input` was built on an app that did not register it. */
  inputExtensionMissing: "IGX-1305",
  /** A `WorldText` or `HudText` was asked to draw before its `font` asset was assigned. */
  missingFont: "IGX-1306",
  /** A DOM-only member was reached on a host with no document, and did nothing. */
  headlessNoOp: "IGX-1307",
  /** A `WorldText` needed a scene renderable after the render scene had already been built. */
  sceneAlreadyBuilt: "IGX-1308",
} as const;

/**
 * The union of the codes the `UiErrorCode` table declares.
 *
 * @public
 */
export type UiErrorCode = (typeof UiErrorCode)[keyof typeof UiErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const UI_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1301": "The ui() extension is already registered on this app.",
  "IGX-1302": "{file} is not an ignifx.i18n document this build can read.",
  "IGX-1303": "{locale} is not a locale the loaded translation document declares.",
  "IGX-1304": "Message {key} could not be parsed: {reason}.",
  "IGX-1305": "{widget} needs the @ignifx/input extension, which this app did not register.",
  "IGX-1306": "{component} has no font asset assigned, so it has nothing to draw.",
  "IGX-1307": "{member} did nothing: this app has no DOM overlay host.",
  "IGX-1308": "{component} was given its text after app.start(), so Babylon Lite will not draw it.",
});

/**
 * Options accepted by {@link uiError}: the same subset of `IgnifxErrorOptions` this package uses.
 *
 * @public
 */
export interface UiErrorOptions {
  /** Identifiers that locate the failure. */
  readonly context?: ErrorContext;
  /** One sentence telling the developer what to do about it. */
  readonly hint?: string;
  /** The failure being wrapped, when there is one. */
  readonly cause?: unknown;
}

/**
 * Builds an `IgnifxError` carrying one of this package's codes.
 *
 * @param code - The code from the `UiErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw uiError(UiErrorCode.unknownLocale, "fr is not a locale strings.i18n.json declares.", {
 *   context: { locale: "fr" },
 * });
 * ```
 *
 * @public
 */
export function uiError(code: UiErrorCode, message: string, options?: UiErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
