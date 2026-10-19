---
"@ignifx/editor-host": minor
---

The scene view describes its registered components with `describeRegisteredSchemas`, so the editor gets each component's `allowMultiple` and `package` and each field's inspector options, the project's own scripts included, and gets a new `schemasChanged` after every hot reload.
