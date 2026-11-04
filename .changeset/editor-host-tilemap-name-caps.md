---
"@ignifx/editor-host": patch
---

`setTilemapCells` now rejects an `asset` address or a layer name longer than 256 characters with `invalidParams`, like the other bounded names in the editor protocol.
