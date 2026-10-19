---
"@ignifx/2d": minor
"ignifx": minor
---

- Add `filter`, `ignore` and `includeUnpickable` options to `app.twoD.pickAt`; a rejected sprite no longer hides the sprites under it in its sorting layer.
- Add `app.twoD.pickAllAt`, which returns the sprites under a point, topmost first, up to 64 unless `limit` says otherwise.
- Add `Tilemap.setCells` for batched tile writes; `setTile` and `setCells` now update the drawn tilemap on the next frame, rebuilding only the chunks they touched.
