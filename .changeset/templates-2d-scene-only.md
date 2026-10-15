---
"@ignifx/cli": patch
---

`2d-topdown` and `2d-sidescroller` projects no longer hand the tilemap's collision data to its collider in `src/main.ts`: the collider reads the `Tilemap` beside it.
