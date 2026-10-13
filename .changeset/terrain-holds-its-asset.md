---
"@ignifx/terrain": patch
---

Fix a `Terrain` drawing from an asset that had already been unloaded when the old `definition` handle was released right after a new one was assigned. The terrain now holds its own reference to the asset it draws until it has switched to the new one or is removed.
