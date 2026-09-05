/**
 * Error codes owned by `@ignifx/cli`. They live in the `14xx` platform range reserved by
 * `docs/architecture/15-devtools-and-diagnostics.md` §1.
 *
 * @remarks
 * The CLI runs before an `App` exists, so it cannot throw core's `IgnifxError`. Phase 1 introduces
 * the full `IgnifxError` registry described in that document; when it lands, these codes are
 * expected to fold into it and `CliError` becomes a thin alias or is removed.
 *
 * @public
 */
export const CliErrorCode = {
  /** The target directory already exists and is not empty, and `overwrite` was not requested. */
  targetNotEmpty: "IGX-1401",
  /** The requested template directory does not exist. */
  templateNotFound: "IGX-1402",
  /** The command line could not be parsed, or an argument is not usable. */
  invalidArguments: "IGX-1403",
} as const;

/**
 * The union of the error codes this package can throw.
 *
 * @public
 */
export type CliErrorCode = (typeof CliErrorCode)[keyof typeof CliErrorCode];

/**
 * The error type every `@ignifx/cli` API throws for misuse (`CONSTITUTION.md` §3.9). It always
 * carries a stable `IGX-####` code so the process boundary can report a machine-readable failure.
 *
 * @example
 * ```ts
 * try {
 *   await copyTemplate({ templateDir, targetDir });
 * } catch (error) {
 *   if (error instanceof CliError && error.code === "IGX-1401") {
 *     console.error("pass --overwrite to write into a non-empty directory");
 *   }
 * }
 * ```
 *
 * @public
 */
export class CliError extends Error {
  /** The stable diagnostic code for this failure. */
  readonly code: CliErrorCode;

  /**
   * Creates a CLI error.
   *
   * @param code - The stable `IGX-14##` code for the failure.
   * @param message - An actionable description of what went wrong and how to fix it.
   * @param options - Standard `Error` options; use `cause` to keep the original failure.
   */
  constructor(code: CliErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CliError";
    this.code = code;
  }
}
