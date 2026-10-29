---
"@ignifx/core": patch
---

`defineSchema`, `record()`, a hand-written `static schema` and `registerSettings` refuse a fields object written with a literal `__proto__: …` key with `IGX-0607`, instead of dropping that field silently.
