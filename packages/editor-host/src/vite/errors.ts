/**
 * The error the Vite plugin throws.
 *
 * @remarks
 * The plugin runs in the dev server's Node process, where loading `@ignifx/core` (and through it
 * Babylon Lite) to throw its `IgnifxError` would be pure cost. Like `@ignifx/vite-plugin`'s own
 * error, it carries the same registered `IGX-####` codes the page half throws.
 */

import type { EditorHostErrorCode } from "../error-codes.js";

/**
 * The error every `@ignifx/editor-host/vite` API throws for a misconfiguration
 * (`CONSTITUTION.md` §3.9).
 *
 * @beta
 */
export class EditorHostPluginError extends Error {
  /** The stable diagnostic code for this failure. */
  readonly code: EditorHostErrorCode;

  /**
   * Creates a plugin error.
   *
   * @param code - The stable `IGX-####` code for the failure.
   * @param message - An actionable description of what went wrong and how to fix it.
   */
  constructor(code: EditorHostErrorCode, message: string) {
    super(message);
    this.name = "EditorHostPluginError";
    this.code = code;
  }
}
