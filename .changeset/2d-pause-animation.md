---
"@ignifx/2d": patch
---

Sprite animation freezes while the app is paused

`app.pause()` now stops `SpriteAnimator` clips and animated tiles. Systems keep running while the app is paused and their `dt` is not zeroed — only scripts are filtered by `updateWhenPaused` — so the 2D animation system checks `time.paused` itself. The existing test missed this because its pause lasted a whole number of clip periods.
