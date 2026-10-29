---
"@ignifx/core": minor
"@ignifx/3d": patch
"ignifx": patch
---

Add `MeshRenderer.displayHidden`, which hides a mesh from drawing and picking without changing `enabled`, `pickable`, or anything a scene file saves.

In an edit-mode app a `LodGroup` shows one level, chosen by the editor camera's distance, instead of switching the saved `MeshRenderer.enabled`, so moving an editor's camera no longer changes the scene file and a removed or disabled group shows every level again.
