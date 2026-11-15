---
"@ignifx/core": patch
"ignifx": minor
---

Reflection probes no longer free a cube a material rebuild from an earlier frame may still draw with, pause between a device loss and its recovery, keep an `onDemand` refresh that a missing environment interrupted, and name the entity in the `everyFrame` downgrade warning.
A lightmapped `MeshRenderer` now follows `setBaseColor`, `setMetallicRoughness` and `setAlpha` edits of its shared material, and frees its material copy when its mesh goes away.
`serializeScene` now writes overrides of nested prefab components (props, `enabled`, removal) from live state, so a scene holding them survives a load and save. A nested entity's own fields still cannot be overridden from an outer instance.
`ignifx.schemas.json` and the format pages now describe the sub-fields of nested records, arrays, maps and optionals, such as `MeshRenderer.lightmap.asset` (an asset reference of type `lightmap`).
