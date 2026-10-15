---
"@ignifx/cli": patch
---

`2d-topdown` and `2d-sidescroller` projects no longer hand the tilemap's collision data to its collider in `src/main.ts`: the collider reads the `Tilemap` beside it.

Their `assets/level.tilemap.json` files no longer carry an objects layer; the player, props, shrine and coins were already entities in the scene file.

Their still sprites name their frame in `SpriteRenderer.frameName`, so `src/scripts/sprite-frame.ts` is gone and an editor shows each prop's frame without running a script.
