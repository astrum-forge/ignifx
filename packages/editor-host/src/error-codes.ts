/**
 * The diagnostic codes `@ignifx/editor-host` owns, and the origin rule both of its entries check.
 *
 * The package owns the `18xx` range (`docs/architecture/15-devtools-and-diagnostics.md` §1). This
 * module is plain data with no imports, because the Vite plugin runs in Node without
 * `@ignifx/core` and still reports the same codes.
 */

/**
 * Every diagnostic code `@ignifx/editor-host` can throw, keyed by an intention-revealing name.
 *
 * @beta
 */
export const EditorHostErrorCode = {
  /** `editorOrigin` is not an origin such as `"ignifx://app"` or `"http://localhost:5173"`. */
  invalidEditorOrigin: "IGX-1801",
  /** The host was started where there is no `window` to receive the editor's port, and was given no `messageTarget`. */
  noMessageTarget: "IGX-1802",
  /** An option is outside its documented domain. */
  invalidOption: "IGX-1803",
} as const;

/**
 * The union of the codes in `EditorHostErrorCode`.
 *
 * @beta
 */
export type EditorHostErrorCode = (typeof EditorHostErrorCode)[keyof typeof EditorHostErrorCode];

/**
 * A scheme, `://`, and a host with an optional port: no path, no wildcard, and nothing that could
 * end a `Content-Security-Policy` directive early.
 */
const ORIGIN_SHAPE = /^[a-z][a-z\d+.-]*:\/\/[^\s/?#;,'"*]+$/iu;

/**
 * Tells whether a string is an origin the editor can be served from.
 *
 * @remarks
 * `new URL(value).origin` is not usable here: for a scheme Node does not know, such as the
 * editor's `ignifx://app`, it answers `"null"`, while Chromium reports `ignifx://app` as
 * `event.origin` because Electron registers the scheme as standard.
 *
 * @param value - The candidate, for example `"ignifx://app"` or `"http://localhost:5173"`.
 * @returns `true` when the value is a scheme, `://`, and a host with an optional port.
 *
 * @beta
 */
export function isEditorOrigin(value: string): boolean {
  return ORIGIN_SHAPE.test(value);
}
