---
"@ignifx/editor-host": minor
---

The scene view can show the Game panel and asset thumbnails: with a canvas it lists the `gameView` and `thumbnails` capabilities and answers `setGameView`, `gameViewFrame` (the open scene through its own camera, as an image) and `renderThumbnail` (a model or prefab rendered on its own). Material and atlas thumbnails are not rendered yet. Thumbnails render in a second app built from fresh extensions: the generated scene view passes the project's `extensions` function as the new `createExtensions` option, and a host given `extensions` without it does not list `thumbnails`.
