---
"@ignifx/cli": minor
"@ignifx/2d": patch
---

`@ignifx/cli/tilemap` exports `convertTilemapSource`, the Tiled and LDtk conversion behind `ignifx import tilemap` as a pure function that reads through a callback and returns the documents to write.
Tilemap conversion refuses maps past `DEFAULT_TILEMAP_SOURCE_LIMITS` (cells, layers, tiles per tileset, levels, JSON length) with `IGX-1408`.
