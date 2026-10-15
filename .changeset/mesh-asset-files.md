---
"@ignifx/core": minor
"@ignifx/vite-plugin": minor
"ignifx": minor
---

Add `.mesh.json` mesh files: a file names one primitive (`box`, `sphere`, `plane`, `ground`, `cylinder`, `capsule`, `torus`) and its `MeshAsset` factory options, so a scene file can reference a primitive by address (`{ "$asset": "meshes/crate.mesh.json" }`) without code publishing it first. A bad primitive or option fails the load with `IGX-0507`.

- `@ignifx/vite-plugin` records `.mesh.json` files as `mesh` assets and checks their header; pass `meshFileJsonSchema()` from `@ignifx/core` in `schemas.formats` to validate their options at build time.
