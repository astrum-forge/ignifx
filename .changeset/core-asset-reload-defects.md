---
"@ignifx/core": patch
---

Saving a scene no longer writes an override for an unchanged asset reference inside an instanced prefab whose file leaves out the reference's `type`.
