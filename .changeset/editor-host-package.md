---
"@ignifx/editor-host": minor
"@ignifx/core": minor
---

Add `@ignifx/editor-host`, which lets the ignifx editor run a project's own engine. Its Vite plugin (`editorHostPlugin` from `@ignifx/editor-host/vite`) serves the editor's scene view at `/__ignifx_editor__/` from the project's dev server, and adds `virtual:ignifx/editor`, whose `attachEditorPlayControls(app)` lets the editor play, pause, step and stop the game in development and does nothing in a production build.

- The host speaks editor protocol 0.1 over a `MessagePort`: `hello`/`ready`, `ping`, and a heartbeat. It accepts a port only from the editor's origin, and the scene view may be framed only by that origin.
- `ErrorRange.editorHost` (`"18"`) registers the `IGX-18xx` codes the new package throws.
