---
"@ignifx/core": minor
---

A second camera can render into a texture beside the main view: `app.renderer.createRenderTexture(width, height)`, `app.renderer.renderToTexture(camera, texture)` for one frame, `Camera.renderTarget` for every frame, and `texture.readPixels()` to read the result (all `@beta`). A camera with a `renderTarget` is never the main camera.
