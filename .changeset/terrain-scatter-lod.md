---
"@ignifx/terrain": patch
---

Fix `TerrainScatter`'s `lodMesh` never taking effect when the terrain finished loading after `app.start()`, which logged `IGX-0717` once per scatter. The LOD mesh set before start is now applied.
