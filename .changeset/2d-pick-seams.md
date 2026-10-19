---
"@ignifx/2d": minor
"ignifx": minor
---

- Add `filter`, `ignore` and `includeUnpickable` options to `app.twoD.pickAt`; a rejected sprite no longer hides the sprites under it in its sorting layer.
- Add `app.twoD.pickAllAt`, which returns every sprite under a point, topmost first.
- Add `Tilemap.setCells` for batched tile writes; `setTile` and `setCells` now update the drawn tilemap on the next frame, rebuilding only the chunks they touched.
