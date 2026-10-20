---
"@ignifx/editor-host": minor
---

Add `playStats` to the play view: the game's frame rate, frame time, entity count and frame count.
After a script's hot reload changes a field's default, the scene view now gives that field the new default wherever the open scene leaves it out, and lists `hotReloadDefaults` in `ready`.
