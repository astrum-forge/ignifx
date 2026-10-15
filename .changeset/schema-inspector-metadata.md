---
"@ignifx/core": minor
"ignifx": minor
"@ignifx/vite-plugin": patch
---

- `describeSchema` now describes each field's inspector options (`min`, `max`, `step`, `hidden`, `readonly`, `group`, `transient`), an enum's `values`, an asset field's `assetType`, a `componentRef` field's `componentType`, and the nested field of an `array`, `record`, `map` or `optional`.
- Add `describeRegisteredSchemas(app.world.registry)`, which describes every registered component with `allowMultiple` and the `package` that registered it, for inspectors outside the engine.
- `toJsonSchema` writes the same options as `x-ignifx-*` keywords (`x-ignifx-step`, `x-ignifx-group`, `x-ignifx-asset-type`, …) and marks read-only fields with `readOnly`.
- Add `ComponentRegistry.registrarOf(typeId)`, the extension that registered a component.
- The Vite plugin's JSON Schema validator skips `x-` extension keywords and `readOnly` instead of rejecting them with `IGX-0653`.
