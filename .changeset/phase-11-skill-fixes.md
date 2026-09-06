---
"@ignifx/core": minor
"@ignifx/cli": patch
---

Fixes from the Phase 11 skill evaluation

- `SceneAssetToken` lets a script declare a scene or prefab field with `asset(SceneAssetToken)`; `AssetTypeToken.prototype` is optional so a plain token can name an asset that has no class. Previously a prefab handle could only be held as an untyped property.
- `create-ignifx` skips `out/`, `release/` and `coverage/` (desktop build output) at every depth and skips symlinks instead of following them; a template checkout that had been built used to be copied wholesale and to crash on the packaged Electron app's framework links.
