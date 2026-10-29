---
"@ignifx/core": minor
---

Fix schema fields named after a member every object inherits: such a field read the inherited member whenever a value or file omitted it, and a `record` field named `__proto__` replaced the record's prototype instead of holding a value.

### Breaking

`defineSchema`, `Component.define`, `Script.define`, `record()`, `ComponentRegistry` (for a hand-written `static schema`) and `registerSettings` now refuse a field named `__proto__`, `constructor`, `toString`, `valueOf` or any other `Object.prototype` member with `IGX-0607`. Rename the field; `prototype` stays allowed.
