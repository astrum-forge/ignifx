---
"@ignifx/core": minor
---

Add `world.loadSceneFile(file, { address })` to build a scene from a `SceneFile` object already in memory, and `loadSceneDependencies` for the asset walk on its own.
Add `world.createScene(name, { persistent })` for an empty scene instance built in code, `entity.setSiblingIndex(index)` to order siblings, and `addComponentFromRecord` to attach a component from its scene file record.
