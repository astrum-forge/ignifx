---
"@ignifx/core": minor
---

Fixed: a single-root prefab placed with `world.instantiate` now loads back from `serializeScene` as the same one entity; before, the loaded copy had its components twice and its offset applied twice.

### Breaking

A scene file's `instance` entry whose scene has exactly one root now is that root, as `world.instantiate` already was: the root's components and children land on the entity carrying the entry, which keeps its own uid, name and transform. Code that reached the instanced root through `entity.children[0]` should use the entity itself.
