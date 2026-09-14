---
"@ignifx/terrain": minor
"@ignifx/cli": minor
"ignifx": minor
---

- Add `@ignifx/terrain`: `Terrain` loads a `.terrain.json` with a 16-bit `.r16` heightmap, a PNG heightmap, or seeded noise, and draws it as chunked geomipmapped meshes with skirts, one level of detail per chunk, chosen and frustum-culled every frame.
- Blend up to eight texture layers with RGBA control maps or height and slope rules through one PBR material and a surface shader, so shadows, image-based lighting and fog stay intact. Per-layer roughness is not available.
- Query the terrain without physics: `heightAt`, `normalAt`, `raycast`, `bounds`, `worldToSample` and `sampleToWorld`. `colliderInit()` returns the init a `HeightfieldCollider` from `@ignifx/physics` accepts, and `setHeights` sculpts at runtime and raises `onHeightsChanged`.
- Add `TerrainScatter`, which places grass and trees on chosen layers, slopes and heights with a seed, and draws them through `InstancedMeshRenderer` with GPU culling, an LOD mesh and the `foliageMaterialDefinition` wind shader.
- An 8-bit heightmap loads with a terracing warning (`IGX-1603`). Convert 16-bit PNGs with the new `ignifx import heightmap in.png out.r16` command in `@ignifx/cli`.
- The `ignifx` umbrella re-exports the package.
