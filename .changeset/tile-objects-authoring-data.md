---
"@ignifx/2d": minor
"ignifx": minor
---

### Breaking

A tilemap's objects layer no longer spawns entities when a scene loads (ADR-0030). `app.twoD.registerTileObjectFactory`, `unregisterTileObjectFactory`, `spawnTilemapObjects`, `TileObjectFactory` and `TileObjectContext` are removed, and `IGX-1110` is retired. Move the objects into your scene file once with `ignifx import tilemap <map.tilemap.json> <scene.scene.json>`, or, for a level built in code, create the entities from `tilemap.definition.objects` after the map has loaded.
