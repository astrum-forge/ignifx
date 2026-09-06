import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/electron` owns. The package sits in the `14` platform range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1, whose low half is already spoken for:
 * `@ignifx/cli` owns `IGX-1401`–`IGX-1419` and `@ignifx/core` allocates from `IGX-1420` upward
 * (the reservation comment in `packages/core/src/errors/error-codes.ts`). This package therefore
 * starts at `IGX-1460`, leaving `IGX-1430`–`IGX-1459` for the kernel's own platform and storage
 * growth.
 *
 * The table lives here rather than in `@ignifx/core`'s `CoreErrorCode`: an extension owns its own
 * codes and hands them to the app through `ExtensionContext.registerErrorCodes`
 * (`docs/architecture/04-extensions.md` §3).
 */

/**
 * Every diagnostic code `@ignifx/electron` can throw, keyed by an intention-revealing name so call
 * sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw electronError(ElectronErrorCode.hostVersionMismatch, "The preload bridge is too old.", {
 *   context: { host: "2.0.0", expected: "1.x" },
 * });
 * ```
 *
 * @public
 */
export const ElectronErrorCode = {
  /** `window.ignifxHost` exists but announces a major version this build cannot talk to. */
  hostVersionMismatch: "IGX-1460",
  /** `window.ignifxHost` exists but is missing a method the renderer needs. */
  hostContractIncomplete: "IGX-1461",
  /** `app.desktop` was used on an app whose Electron extension found no host bridge. */
  hostUnavailable: "IGX-1462",
  /** The main process refused an IPC request, or the handler threw. */
  hostCallFailed: "IGX-1463",
  /** `openExternal` was handed a URL whose protocol is not on the allow-list. */
  externalUrlRefused: "IGX-1464",
  /** An `ignifx://` request resolved outside the directory the protocol serves. */
  protocolPathEscaped: "IGX-1465",
  /** `createGameWindow` was given options that cannot be honoured together. */
  invalidWindowOptions: "IGX-1466",
} as const;

/**
 * The union of the codes the `ElectronErrorCode` table declares.
 *
 * @public
 */
export type ElectronErrorCode = (typeof ElectronErrorCode)[keyof typeof ElectronErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const ELECTRON_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1460": "The preload bridge announces version {host}, which this build cannot talk to.",
  "IGX-1461": "The preload bridge is missing {member}.",
  "IGX-1462": "app.desktop needs the @ignifx/electron preload bridge; this app has none.",
  "IGX-1463": "The main process refused {channel}.",
  "IGX-1464": "{url} does not use an allowed protocol.",
  "IGX-1465": "{path} resolves outside the directory the ignifx:// protocol serves.",
  "IGX-1466": "{option} is not a usable window option.",
});

/**
 * Options accepted by {@link electronError}: the same subset of `IgnifxErrorOptions` this package
 * uses.
 *
 * @public
 */
export interface ElectronErrorOptions {
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
 * @param code - The code from the `ElectronErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw electronError(ElectronErrorCode.externalUrlRefused, "file: links are not opened.", {
 *   context: { url: "file:///etc/passwd" },
 * });
 * ```
 *
 * @public
 */
export function electronError(code: ElectronErrorCode, message: string, options?: ElectronErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
