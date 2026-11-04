---
"@ignifx/core": minor
---

Add `bakeLightProbes` (beta), an asynchronous CPU light-probe bake that also runs headless. It bakes a `.probes.json` grid from a world's lights and the triangles of meshes built with `MeshAsset.fromData`, and accepts `signal` and `onProgress`. It checks the grid, `rays` and `maxDistance` before tracing, and throws `IGX-0734` for values it cannot bake.
