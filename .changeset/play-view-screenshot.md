---
"@ignifx/editor-host": minor
---

The editor can now take a screenshot of a running game: the play view answers `screenshot` with the same request and answer as the scene view, and lists `screenshot` in its capabilities. It refuses with the new `RpcErrorCode.notPlaying` while the game is not running, and with `notReady` before its first frame.
