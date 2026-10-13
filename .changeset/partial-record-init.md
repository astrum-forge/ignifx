---
"@ignifx/core": patch
"ignifx": patch
---

Fix `addComponent` replacing a whole record field when its `init` gives only some of the record's fields: `addComponent(PostProcessStack, { bloom: { enabled: true } })` left bloom's other fields undefined, so Babylon Lite's own defaults applied instead of the schema's. The fields an `init` leaves out now keep their schema defaults, at any depth, as in a scene file, and `ComponentInit` accepts a record in part (new `ComponentInitValue` type).
