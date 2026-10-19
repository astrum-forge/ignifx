---
"@ignifx/editor-host": minor
---

Add a 2D view mode to the scene view: `setViewMode` with `"2d"` shows the level through the host's own `Camera2D`, which pans, zooms and frames sprites, while `pick` and clicks select sprites with `app.twoD.pickAt`.
`openScene` and `sceneOpened` now report the scene's `viewMode`, so the editor no longer has to guess it from the level's cameras.
