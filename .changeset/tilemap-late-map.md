---
"@ignifx/2d": patch
---

`Tilemap.collisionData` read before the map finished loading no longer stays empty: the next read after the load builds the collision surface.
