import { IgnifxError } from "@ignifx/core";
import type { ElectronErrorCode } from "./error-codes.js";
import type { ErrorContext } from "@ignifx/core";

export { ELECTRON_ERROR_MESSAGES, ElectronErrorCode } from "./error-codes.js";

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
