---
"@ignifx/core": minor
---

`app.renderer.surface`

The renderer exposes the canvas the app draws into as `surface` (`RenderSurface | null`; `null` under a headless app), so an extension that adds a second rendering context — `@ignifx/2d`'s sprite renderer — can create it on the app's surface without reaching through `app.lite.engine`.
