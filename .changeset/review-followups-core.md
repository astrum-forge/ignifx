---
"@ignifx/core": patch
---

`enumerateInstanceTargets` and `resolveInstancePath` now reach the targets of a child that instances the same prefab as its file's root, as the loader does.
`describeRegisteredSchemas` writes `null` in `requires` for a required class that declares no `typeId` of its own, instead of its parent's type id.
`serializeScene` writes overrides for the components a variant prefab's nested root merged into the instance root, and reports (`IGX-0609`) a component added to a nested entity or a nested entity destroyed at run time instead of dropping it silently.
