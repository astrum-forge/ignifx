---
"@ignifx/core": minor
"@ignifx/physics": minor
"@ignifx/physics-2d": minor
"@ignifx/editor-host": minor
---

Add the `ComponentHooks.onValidate(fields)` hook, which the editor host calls after an inspector edit or a hot-reload default changes a component's fields; colliders, rigidbodies and character controllers rebuild their body there.
