---
"@ignifx/core": patch
---

Fix `__proto__` keys in material files, post-effect values and settings defaults: a material's `values`, `textures` and `defines`, a surface shader's `textures`, a post effect's `values`, and a settings `map` or `record` default now keep such a key as a name instead of changing an object's prototype.

**Behaviour change:** a shader material whose `values` or `defines` has a key named `__proto__` used to load with that key silently dropped; it is now refused with `IGX-0712`, like any other name the shader does not declare. A `defines` key named after any other inherited member, such as `toString`, is also refused with `IGX-0712` now; before, it was taken as declared. If a material file fails to load with `IGX-0712` after this update, remove the key or declare it in the shader.
