import type { ElectronErrorCode } from "../error-codes.js";

/*
 * The main process's error, built without `@ignifx/core`. Core is a renderer library: importing it
 * here would load the engine kernel (and its Babylon Lite imports) into a Node process that never
 * renders, and would make `@ignifx/electron/main` usable only where `@ignifx/core` is installed.
 * The message has core's development format (`IGX-####: message [key=value] Hint: …`), so a log
 * line or an IPC rejection reads the same whichever process threw it.
 */

/**
 * Identifiers attached to an {@link ElectronMainError}, as in `@ignifx/core`'s `ErrorContext`.
 *
 * @public
 */
export type ElectronMainErrorContext = Readonly<Record<string, string | number | boolean | null>>;

/**
 * What {@link ElectronMainError} accepts besides its code and message.
 *
 * @public
 */
export interface ElectronMainErrorOptions {
  /** Identifiers that locate the failure. */
  readonly context?: ElectronMainErrorContext;
  /** One sentence telling the developer what to do about it. */
  readonly hint?: string;
  /** The failure being wrapped, when there is one. */
  readonly cause?: unknown;
}

/**
 * The error `@ignifx/electron/main` throws: a stable `IGX-####` {@link ElectronMainError.code} and
 * the identifiers that locate the failure, without importing `@ignifx/core`.
 *
 * @remarks
 * Not an `IgnifxError` (`isIgnifxError` is `false` for it); test `error.code` instead. Errors thrown
 * in an IPC handler reach the renderer as their message only, which is the same text either way.
 *
 * @example
 * ```ts
 * try {
 *   protocolPathFor("ignifx://app/../secret", root);
 * } catch (error) {
 *   if (error instanceof ElectronMainError && error.code === "IGX-1465") {
 *     // refused
 *   }
 * }
 * ```
 *
 * @public
 */
export class ElectronMainError extends Error {
  /** The stable diagnostic code. */
  readonly code: ElectronErrorCode;
  /** Identifiers that locate the failure. */
  readonly context: ElectronMainErrorContext;
  /** One sentence telling the developer what to do about it, or `null`. */
  readonly hint: string | null;

  /**
   * Builds the error and its formatted message.
   *
   * @param code - The code from the `ElectronErrorCode` table.
   * @param message - The actionable development sentence.
   * @param options - Context identifiers, a remedy hint, and the wrapped cause.
   */
  constructor(code: ElectronErrorCode, message: string, options?: ElectronMainErrorOptions) {
    const context = options?.context ?? {};
    const hint = options?.hint ?? null;
    super(
      formatMainErrorMessage(code, message, context, hint),
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ElectronMainError";
    this.code = code;
    this.context = context;
    this.hint = hint;
  }
}

/**
 * Formats a message the way `@ignifx/core`'s development mode does.
 *
 * @param code - The diagnostic code.
 * @param message - The sentence.
 * @param context - The identifiers.
 * @param hint - The remedy, or `null`.
 * @returns `"IGX-####: message [key=value, …] Hint: …"`.
 */
function formatMainErrorMessage(
  code: string,
  message: string,
  context: ElectronMainErrorContext,
  hint: string | null,
): string {
  let formatted = `${code}: ${message}`;
  const keys = Object.keys(context);
  if (keys.length > 0) {
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(`${key}=${String(context[key] ?? null)}`);
    }
    formatted += ` [${parts.join(", ")}]`;
  }
  if (hint !== null && hint.length > 0) {
    formatted += ` Hint: ${hint}`;
  }
  return formatted;
}

/**
 * Builds an {@link ElectronMainError}; the main process's twin of the renderer's `electronError`.
 *
 * @param code - The code from the `ElectronErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw.
 */
export function mainError(
  code: ElectronErrorCode,
  message: string,
  options?: ElectronMainErrorOptions,
): ElectronMainError {
  return new ElectronMainError(code, message, options);
}
