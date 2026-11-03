---
"@ignifx/editor-host": minor
---

Add two scene-view methods for the editor's 2D tools. `setTilemapCells { asset, layer, cells }` writes a tilemap editor's cells into the open scene's live tilemaps, so painting shows without saving (capability `tilemapCells`). `setEditorLines { id, lines, color? }` and `clearEditorLines { id? }` draw the editor's own line segments, such as collider outlines and handles, over the view in 3D and 2D, never in the game view (capability `editorLines`).
