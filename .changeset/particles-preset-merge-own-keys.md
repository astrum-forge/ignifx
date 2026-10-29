---
"@ignifx/particles": patch
---

Fix `particleDefinition` overrides with a `__proto__` key: the key is now merged as an ordinary field, so the definition check refuses it, instead of replacing the prototype of the merged document.
