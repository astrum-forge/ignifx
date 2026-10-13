---
"@ignifx/core": patch
---

Fix `Light.enabled` being ignored: a disabled `Light`, or one on an inactive entity, now lights nothing and casts no shadow, and enabling it again restores both.
