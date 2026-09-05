import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/audio` owns. The package sits in the `10` subsystem range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1, so every code reads `IGX-10##`.
 *
 * The table lives here rather than in `@ignifx/core`'s `CoreErrorCode`: an extension owns its own
 * codes and hands them to the app through `ExtensionContext.registerErrorCodes`
 * (`docs/architecture/04-extensions.md` §3).
 */

/**
 * Every diagnostic code `@ignifx/audio` can throw or log, keyed by an intention-revealing name so
 * call sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw audioError(AudioErrorCode.unknownBus, "Ambience is not a registered bus.", {
 *   context: { bus: "Ambience" },
 * });
 * ```
 *
 * @public
 */
export const AudioErrorCode = {
  /** `app.audio.bus(name)`, or an `AudioSource.bus` field, named a bus the tree does not hold. */
  unknownBus: "IGX-1001",
  /** A spatial source is playing and no `AudioListener` is enabled; logged once per world. */
  noAudioListener: "IGX-1002",
  /** An `.audio.json` file is not an `ignifx.audiobuses` document. */
  invalidBusFile: "IGX-1003",
  /** An `.audio.json` file declares a format version this build cannot read. */
  unsupportedBusFileVersion: "IGX-1004",
  /** Two buses in one tree declared the same name. */
  duplicateBusName: "IGX-1005",
  /** A bus named a parent that is not declared, or the parent chain forms a cycle. */
  invalidBusParent: "IGX-1006",
  /** The audio engine could not be created: no Web Audio in this host. */
  audioEngineUnavailable: "IGX-1007",
  /** A clip's bytes could not be decoded into playable audio. */
  clipDecodeFailed: "IGX-1008",
  /** A streaming clip was played on a backend that cannot stream (headless has no media element). */
  streamingUnavailable: "IGX-1009",
  /** The audio service was used after the app had been disposed. */
  audioDisposed: "IGX-1010",
} as const;

/**
 * The union of the codes the `AudioErrorCode` table declares.
 *
 * @public
 */
export type AudioErrorCode = (typeof AudioErrorCode)[keyof typeof AudioErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const AUDIO_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1001": "{bus} is not a bus of this app's audio tree.",
  "IGX-1002": "A spatial AudioSource is playing with no enabled AudioListener; using the world origin.",
  "IGX-1003": "{file} is not an ignifx.audiobuses document this build can read.",
  "IGX-1004": "{file} declares bus format version {version}, which this build cannot read.",
  "IGX-1005": "The bus {bus} is declared twice in {file}.",
  "IGX-1006": "The bus {bus} names the parent {parent}, which is not declared before it.",
  "IGX-1007": "This host has no Web Audio; @ignifx/audio fell back to its headless backend.",
  "IGX-1008": "{asset} could not be decoded into playable audio.",
  "IGX-1009": "{asset} is a streaming clip and this backend cannot stream.",
  "IGX-1010": "The audio service has been disposed.",
});

/**
 * Options accepted by {@link audioError}: the same subset of `IgnifxErrorOptions` this package uses.
 *
 * @public
 */
export interface AudioErrorOptions {
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
 * @remarks
 * `IgnifxError`'s `code` parameter is the open template type `IGX-${number}`, so an `IGX-10##`
 * literal from the `AudioErrorCode` table is accepted without an assertion.
 *
 * @param code - The code from the `AudioErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw audioError(AudioErrorCode.unknownBus, "Ambience is not a registered bus.", {
 *   context: { bus: "Ambience" },
 *   hint: "Declare it in the project's .audio.json, or call app.audio.createBus.",
 * });
 * ```
 *
 * @public
 */
export function audioError(code: AudioErrorCode, message: string, options?: AudioErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
