---
"@ignifx/editor-host": patch
---

`pickRect` no longer box-selects disabled sprites and tilemaps, those on inactive entities, or `pickable: false` meshes, matching `pick`.
The schema set no longer lists a hidden host class in a component's `extends`.
