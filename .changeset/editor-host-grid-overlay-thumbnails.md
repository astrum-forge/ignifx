---
"@ignifx/editor-host": minor
---

`setGrid` takes two new optional fields, announced by the `gridOverlay` capability: `overlay: true` draws the 3D grid over the scene, so a floor mesh no longer hides it, and `height` moves the grid's plane to that world y (from -100 000 to 100 000 metres, `GRID_MAX_HEIGHT`). Both default to the old behaviour. `renderThumbnail` no longer holds up other requests while its model settles: it runs beside the request queue, and it stops waiting after a few frames when nothing draws. Its images are unchanged.
