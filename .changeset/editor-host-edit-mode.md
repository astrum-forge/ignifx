---
"@ignifx/editor-host": patch
---

The scene view now runs in edit mode: `startEditorHost` creates its app with `createApp({ editMode: true })`, so the project's scripts get no callbacks unless their class sets `static runInEditMode = true`, and physics does not step. Pass `editMode: false` to run the scene view as a game. The play view is the game's own app and is unchanged.
