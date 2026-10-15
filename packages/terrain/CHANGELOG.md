# @ignifx/terrain

## 0.9.0

### Minor Changes

- 2c61694: ### Breaking
  
  ignifx now runs on Babylon Lite 1.34.0. `@babylonjs/lite` is pinned exactly, so install `@babylonjs/lite@1.34.0` alongside ignifx; the packages that declare it as a peer dependency accept no other version.
  
  - `app.start()` now runs one extra renderable rebuild before the first frame, so that turning a shadow-casting light on or off and adding the first skinned or morph-target model after start keep rendering on Lite 1.34.

### Patch Changes

- Updated dependencies [2c61694]
  - @ignifx/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [874d49b]
  - @ignifx/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [2ea5e9e]
- Updated dependencies [a837a3e]
  - @ignifx/core@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies [d843b2e]
  - @ignifx/core@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [3a8b165]
- Updated dependencies [41450fb]
- Updated dependencies [e198c1c]
- Updated dependencies [96cdf34]
- Updated dependencies [946e837]
- Updated dependencies [09ef95f]
  - @ignifx/core@0.6.0

## 0.5.0

### Patch Changes

- 14d5716: Fix a `Terrain` drawing from an asset that had already been unloaded when the old `definition` handle was released right after a new one was assigned. The terrain now holds its own reference to the asset it draws until it has switched to the new one or is removed.
- 2a2b876: Fix `TerrainScatter`'s `lodMesh` never taking effect when the terrain finished loading after `app.start()`, which logged `IGX-0717` once per scatter. The LOD mesh set before start is now applied.
- Updated dependencies [d617f2c]
- Updated dependencies [6175ff5]
- Updated dependencies [ee4f87b]
  - @ignifx/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [097d60b]
- Updated dependencies [1f45e2f]
  - @ignifx/core@0.4.0

## 0.3.1

### Patch Changes

- 00a6c5f: Fix installing `ignifx`, `@ignifx/particles`, `@ignifx/particles-2d` and `@ignifx/terrain`: 0.3.0 of the three new packages was published with unresolved `workspace:` and `catalog:` dependencies, so `npm install` failed with `Unsupported URL Type`. Upgrade to 0.3.1.
- @ignifx/core@0.3.1

## 0.3.0

### Minor Changes

- 6e1eed7: - Add `@ignifx/terrain`: `Terrain` loads a `.terrain.json` with a 16-bit `.r16` heightmap, a PNG heightmap, or seeded noise, and draws it as chunked geomipmapped meshes with skirts, one level of detail per chunk, chosen and frustum-culled every frame.
  - Blend up to eight texture layers with RGBA control maps or height and slope rules through one PBR material and a surface shader, so shadows, image-based lighting and fog stay intact. Per-layer roughness is not available.
  - Query the terrain without physics: `heightAt`, `normalAt`, `raycast`, `bounds`, `worldToSample` and `sampleToWorld`. `colliderInit()` returns the init a `HeightfieldCollider` from `@ignifx/physics` accepts, and `setHeights` sculpts at runtime and raises `onHeightsChanged`.
  - Add `TerrainScatter`, which places grass and trees on chosen layers, slopes and heights with a seed, and draws them through `InstancedMeshRenderer` with GPU culling, an LOD mesh and the `foliageMaterialDefinition` wind shader.
  - An 8-bit heightmap loads with a terracing warning (`IGX-1603`). Convert 16-bit PNGs with the new `ignifx import heightmap in.png out.r16` command in `@ignifx/cli`.
  - The `ignifx` umbrella re-exports the package.

### Patch Changes

- Updated dependencies [be82465]
- Updated dependencies [6e1eed7]
  - @ignifx/core@0.3.0
