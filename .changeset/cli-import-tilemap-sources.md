---
"@ignifx/cli": minor
---

Add `ignifx import tilemap <map.tmj | project.ldtk>`, which converts a Tiled map or every level of an LDtk project into `.tilemap.json` files and writes an `.atlas.json` beside each tileset image that has none. Flipped tiles are refused unless you pass `--drop-flips`; `--pixels-per-unit` sets the cell size.
