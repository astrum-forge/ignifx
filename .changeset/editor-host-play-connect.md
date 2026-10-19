---
"@ignifx/editor-host": minor
---

The play view keeps the editor's first connect message: `virtual:ignifx/editor` listens as soon as it is evaluated, with the new `listenForEditorPlayControls`, and starts the handshake on that port when `main.ts` calls `attachEditorPlayControls(app)` after `await createApp(...)`.
Under `vite dev` the game's own pages are served with `Content-Security-Policy: frame-ancestors <editorOrigin>`, as the scene view already was.
The play controls answer a new `playState` request with `{ state, frameCount, time }` and send `playStateChanged` when the game starts playing, pauses or stops; both are additive to protocol 0.3.
