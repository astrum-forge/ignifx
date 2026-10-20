---
"@ignifx/editor-host": minor
---

Add the `sampleAnimation { entity, state, normalizedTime, parameters? }` scene method, which poses an entity's `Animator` through `Animator.sample` and answers `{ posed }`; it is additive within protocol 0.3, and an older host answers `methodNotFound`.
