---
"@ignifx/cli": patch
---

Fix `ignifx import tilemap` dropping an object property named `__proto__`: it is now printed with the object's other properties.
