---
"@ignifx/editor-host": patch
---

Fix `__proto__` keys in the editor host: a settings `map` entry named `__proto__` now reaches the settings panel instead of being dropped, and an `applyOps` path through `__proto__` resolves only when the document holds that key as data; otherwise it fails with `invalidPath`.
