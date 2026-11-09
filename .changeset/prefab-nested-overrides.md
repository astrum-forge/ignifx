---
"@ignifx/core": minor
"ignifx": minor
---

Prefab overrides can now reach a nested prefab's components through an instance path in the component segment (`"<nested>/components/<nested>/<componentUid>/props/<field>"`), and `applyOverridesToAsset` moves them onto the prefab's nested instance when given `readScene`.

Add `resolveInstancePath` and `enumerateInstanceTargets` to `@ignifx/core/prefab`: pure helpers that resolve and list the entities and components inside a scene file's prefab instances, with labels and override paths.
