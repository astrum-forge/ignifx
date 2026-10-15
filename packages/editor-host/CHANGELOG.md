# @ignifx/editor-host

## 0.10.0

### Minor Changes

- 612ba87: Add `@ignifx/editor-host`, which lets the ignifx editor run a project's own engine. Its Vite plugin (`editorHostPlugin` from `@ignifx/editor-host/vite`) serves the editor's scene view at `/__ignifx_editor__/` from the project's dev server, and adds `virtual:ignifx/editor`, whose `attachEditorPlayControls(app)` lets the editor play, pause, step and stop the game in development and does nothing in a production build.
  
  - The host speaks editor protocol 0.3 over a `MessagePort`: `hello`/`ready`, `ping`, and a heartbeat. Before 1.0 the editor and the host must agree on the protocol's major and minor. It accepts a port only from the editor's origin, and the scene view may be framed only by that origin.
  - `ErrorRange.editorHost` (`"18"`) registers the `IGX-18xx` codes the new package throws.
- c1e2d80: The scene view mirrors the editor's open scene document (protocol 0.3): it opens the document, applies its edits, reads it back, selects, picks, frames, takes screenshots, reports component schemas and hot reloads, and draws gizmos whose drags the editor records.
  `@babylonjs/lite` is a new peer dependency, and a scene view with a canvas renders at `msaaSamples: 1` so its gizmos are visible.

### Patch Changes

- 8294d45: The scene view now runs in edit mode: `startEditorHost` creates its app with `createApp({ editMode: true })`, so the project's scripts get no callbacks unless their class sets `static runInEditMode = true`, and physics does not step. Pass `editMode: false` to run the scene view as a game. The play view is the game's own app and is unchanged.
- Updated dependencies [4c6e200]
- Updated dependencies [37cf52e]
- Updated dependencies [612ba87]
- Updated dependencies [159ea03]
- Updated dependencies [dc768d6]
- Updated dependencies [08e4b01]
- Updated dependencies [738f68d]
- Updated dependencies [fd0afe5]
- Updated dependencies [6573ebf]
  - @ignifx/core@0.10.0
  - @ignifx/vite-plugin@0.10.0
