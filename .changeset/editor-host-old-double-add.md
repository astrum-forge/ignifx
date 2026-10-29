---
"@ignifx/editor-host": patch
---

`openScene` builds a component once when an older editor's `readBack` saved it both as an instance root's own and as an `add` override with the same uid, and warns once with `IGX-0608`, so `readBack` no longer changes after the first rebuild.
