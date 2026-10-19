---
"@ignifx/core": patch
---

Saving a scene no longer writes an override for an unchanged asset reference inside an instanced prefab whose file leaves out the reference's `type`.

A save that arrives while `app.assets.reload` is still reloading the asset now reloads it once more, so the newest file wins instead of being lost.

A failed reload now reports an `IGX-0505` `AssetLoadError` naming the asset's address through `app.onError`; the asset keeps its previous value.
