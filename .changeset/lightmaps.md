---
"@ignifx/core": minor
"ignifx": minor
---

Add lightmaps (beta): `MeshRenderer.lightmap` samples a baked `.lightmap.json` (`LightmapAsset`, or `createLightmapAsset` for a texture built in code) through the mesh's second UV set, adding to the shading (`mode: "add"`) or multiplying it (`"shadowmap"`), with `level`, `gamma` and `uv2`. Only a renderer on a static entity with a PBR material samples it, through its own copy of the material; anything else logs `IGX-0735` once. Per-entity atlas `scale`/`offset` are read and validated but not applied yet. The GPU code loads only once a renderer samples a lightmap, with or without `rendering.features.lightmaps`.
