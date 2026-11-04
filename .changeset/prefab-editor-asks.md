---
"@ignifx/core": minor
---

Add `@ignifx/core/prefab`, which exports `applyOverridesToAsset`, `revertOverrides` and the scene-file helpers without loading the renderer or Babylon Lite.
`applyOverridesToAsset` can now apply the components added on an instance root: pass them as `rootComponents`, and read `appliedComponents`, `rootComponents` and `skippedComponents` in the result.
A scene can now reference an entity or component inside one of its prefab instances with an instance path, `{ "$entity": "<instanceRootUid>/<uidInThePrefab>" }`; `serializeScene` writes such references this way instead of `null`.
