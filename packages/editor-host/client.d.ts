/**
 * The ambient module `@ignifx/editor-host/vite` adds to a project. Reference it once, beside
 * `@ignifx/vite-plugin/client`:
 *
 * ```ts
 * /// <reference types="@ignifx/editor-host/client" />
 * ```
 */

declare module "virtual:ignifx/editor" {
  import type { App } from "@ignifx/core";

  /**
   * Hands the game's app to the ignifx editor's play controls in development: the editor can then
   * play, pause, step and stop it. In a production build this is a no-op.
   *
   * @param app - The running app.
   * @returns A function that detaches the controls.
   */
  export function attachEditorPlayControls(app: App): () => void;
}
