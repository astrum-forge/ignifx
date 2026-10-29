---
"@ignifx/core": patch
---

Fix schema fields named after a member every object inherits: `defineSchema`, `Component.define`, `Script.define` and `record()` now refuse `__proto__`, `constructor`, `toString` and the other `Object.prototype` names with `IGX-0607`.

**Behaviour change:** such a field used to read the inherited member whenever a value or file omitted it, and a `record` field named `__proto__` replaced the record's prototype instead of holding a value. If a schema now throws `IGX-0607` when it is defined, rename the field; `prototype` stays allowed.
