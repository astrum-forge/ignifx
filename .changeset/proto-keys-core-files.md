---
"@ignifx/core": patch
---

Fix `__proto__` keys in material files, post-effect values and settings defaults: a material's `values`, `textures` and `defines`, a post effect's `values`, and a settings `map` or `record` default keep such a key as a name instead of changing an object's prototype. A shader material whose `defines` names an inherited key such as `toString` is now refused with `IGX-0712`, like any other define the shader does not declare.
