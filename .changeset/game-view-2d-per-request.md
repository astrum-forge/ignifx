---
"@ignifx/core": patch
"@ignifx/editor-host": patch
---

`app.renderer.nextFrame` now settles when the render loop stops, and the editor host's 2D game view no longer keeps an offscreen surface or old scene layers alive between frames and picks up a changed `rendering.clearColor`.
