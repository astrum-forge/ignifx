---
"@ignifx/core": minor
"ignifx": minor
"@ignifx/editor-host": minor
---

- Add `transformSchema()`, the entity transform (`position`, `rotation` as a quaternion, `scale`) as a schema, so inspectors and their ops can treat it like any component.
- `describeSchemas()` and `describeRegisteredSchemas()` describe `ignifx/Transform` with those fields and mark it `builtIn`: it is each entity's `transform` block and cannot be added or removed.
- The editor host's `getSchemas` answer describes `ignifx/Transform` the same way, with its `propsSchema`.
- A `quat` field's inspector `step` is documented as degrees, because inspectors edit it as Euler angles.
