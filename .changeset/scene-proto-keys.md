---
"@ignifx/core": patch
---

Fix `__proto__` keys in scene files: an instanced prefab's props and `map` fields keep such a key as plain data instead of changing an object's prototype, and an override path with a `__proto__` property step is refused with `IGX-0609`.
