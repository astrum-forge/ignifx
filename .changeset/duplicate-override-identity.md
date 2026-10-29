---
"@ignifx/core": minor
"@ignifx/editor-host": minor
---

Fix prefab instances with two overrides of one identity, which a merge conflict can leave: the first had no effect, and an editor that edited or removed the override reached only one of the two.

### Breaking

`validateSceneFile` and the scene loader now refuse an instance whose overrides repeat an identity (the same `path` and `op`, and for an `add` to `<uid>/components` the same added component uid) with `IGX-0608`, and the editor host refuses such a file at `openScene` and such an entry in `createEntity` or `instantiate`. If a scene fails to load with `IGX-0608` naming `overrides/<n>`, keep one of the two overrides it names.
