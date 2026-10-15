---
"@ignifx/editor-host": minor
---

The scene view mirrors the editor's open scene document (protocol 0.3): it opens the document, applies its edits, reads it back, selects, picks, frames, takes screenshots, reports component schemas and hot reloads, and draws gizmos whose drags the editor records.
`@babylonjs/lite` is a new peer dependency, and a scene view with a canvas renders at `msaaSamples: 1` so its gizmos are visible.
