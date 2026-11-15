---
"@ignifx/cli": minor
"@ignifx/2d": patch
---

`@ignifx/cli/tilemap` exports `convertTilemapSource`, the Tiled and LDtk conversion behind `ignifx import tilemap` as a pure function that reads through a callback and returns the documents to write; by default it refuses paths outside the base folder (`allowOutsideBase` opts out).
Tilemap conversion refuses maps past `DEFAULT_TILEMAP_SOURCE_LIMITS` (cells, layers, tilesets, tiles per tileset, levels, JSON length) with `IGX-1408`.
LDtk levels whose names collide after cleaning are written to `_2`, `_3`, … files with a warning instead of overwriting each other.
