/**
 * `@ignifx/editor-host/vite`: the Vite plugin that serves the ignifx editor's scene view from a
 * project's own dev server, and `virtual:ignifx/editor` for its play view
 * (`docs/architecture/17-editor-host.md` §3). It runs in Vite's Node process and imports nothing
 * from `@ignifx/core`.
 *
 * Explicit named re-exports only, no `export *` (coding standards §4).
 *
 * @packageDocumentation
 */

export { EditorHostErrorCode, isEditorOrigin } from "./error-codes.js";
export { EditorHostPluginError } from "./vite/errors.js";
export {
  DEFAULT_EXTENSIONS_MODULE,
  EDITOR_CANVAS_ID,
  EDITOR_ENTRY_MODULE_ID,
  EDITOR_MODULE_ID,
  EDITOR_PAGE_PATH,
  EDITOR_PLAY_CONTROLS_EXPORT,
  editorEntryModuleSource,
  editorPageHtml,
  normalizeExtensionsModule,
  playControlsModuleSource,
  RESOLVED_EDITOR_ENTRY_MODULE_ID,
  RESOLVED_EDITOR_MODULE_ID,
  type EditorEntryModuleOptions,
  type PlayControlsModuleOptions,
} from "./vite/modules.js";
export { editorHostPlugin, readProjectEngineVersion, type EditorHostPluginOptions } from "./vite/plugin.js";
