/**
 * Error codes owned by this module. Phase 1 replaces this with the full registry described in
 * `docs/architecture/15-devtools-and-diagnostics.md` §1; only the WebGPU capability code exists today.
 *
 * @public
 */
export const ErrorCode = {
  /** WebGPU is not available in the current environment. */
  webGpuUnavailable: "IGX-0001",
  /** A runtime handle was used after it had been disposed, or was not created by ignifx. */
  invalidRuntime: "IGX-0002",
} as const;

/**
 * The union of the error codes this package can throw.
 *
 * @public
 */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * The error type every ignifx API throws for misuse (`CONSTITUTION.md` §3.9). It always carries a
 * stable `IGX-####` code so production builds can compact the message without losing meaning.
 *
 * @example
 * ```ts
 * try {
 *   await createRenderEngine(canvas);
 * } catch (error) {
 *   if (error instanceof IgnifxError && error.code === "IGX-0001") {
 *     showWebGpuUnsupportedPage();
 *   }
 * }
 * ```
 *
 * @public
 */
export class IgnifxError extends Error {
  /** The stable diagnostic code for this failure. */
  readonly code: ErrorCode;

  /**
   * Creates an ignifx error.
   *
   * @param code - The stable `IGX-####` code for the failure.
   * @param message - An actionable description of what went wrong and how to fix it.
   * @param options - Standard `Error` options; use `cause` to keep the original failure.
   */
  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IgnifxError";
    this.code = code;
  }
}
