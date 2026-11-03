---
"@ignifx/core": patch
"@ignifx/editor-host": patch
---

`app.start()` after `app.stop()` now restarts the frame loop without running the extensions' `onStart` hooks again. Before, the second start re-ran them, and physics failed with `IGX-1503` ("diagnostics group physics is already registered"), so pressing Play after Step in the editor's play view never resumed the game.
