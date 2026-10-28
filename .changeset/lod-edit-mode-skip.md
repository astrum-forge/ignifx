---
"@ignifx/3d": patch
"ignifx": patch
---

In an edit-mode app a `LodGroup` no longer switches its levels or turns them off when removed, so moving an editor's camera no longer changes the saved `MeshRenderer.enabled` values. Every level shows as authored in the scene view.
