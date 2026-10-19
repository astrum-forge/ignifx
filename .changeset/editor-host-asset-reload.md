---
"@ignifx/editor-host": minor
---

The scene view reloads a model, mesh, material, sprite atlas, shader or prefab in place when it changes on disk, rebuilding the open scene's instances of a changed prefab with their uids, transforms and overrides, and sends a new `assetReloaded` notification.
Textures are not reloaded yet; the editor still reloads the view for them.
