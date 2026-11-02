---
"@ignifx/editor-host": minor
---

The editor can now send input to a running game: the play view answers `sendInput { events }` (up to 64 key presses and releases by `<Keyboard>` control name, and pointer moves, presses and releases at fractions of the canvas) by queuing them into the game's own `app.input`, which resolves them on its next frame. Nothing reaches the page's DOM, the editor's window or the operating system. A game with `app.input` lists `sendInput` in its capabilities; a stopped game refuses with `notPlaying`.
