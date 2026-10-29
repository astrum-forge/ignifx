---
"@ignifx/core": minor
"@ignifx/3d": patch
---

Add `MeshRenderer.displayHidden`, which hides a mesh without changing `enabled` or anything a scene file saves.

Show one level of each `LodGroup` in an edit-mode app, chosen by the editor camera's distance, instead of every level at once; the levels' saved `enabled` stays as authored.
