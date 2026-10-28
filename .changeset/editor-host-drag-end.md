---
"@ignifx/editor-host": patch
---

The scene view now sends `transformDragging` when a gizmo drag starts and `transformDragged` when every drag ends, even one that ends where it started, so the editor can hold undo until the drag is over.
