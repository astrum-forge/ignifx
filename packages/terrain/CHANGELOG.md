# @ignifx/terrain

## 0.21.1

### Patch Changes

- 0be954f: API documentation and the generated API reference pages no longer cite plan documents, phase numbers or task ids that are not published; they cite the architecture section or ADR that describes the behaviour, or state it alone. The hint on an invalid `ignifx.animator` file names the format page that exists, `ignifx.animator.md`.
- cd97af6: Every package ships a README, so its npm page says what the package is, how to install it and where its skill page is. The `@ignifx/cli` README gives the scaffold command that works, `npx --package=@ignifx/cli create-ignifx <dir>`, and the `@ignifx/vite-plugin` README lists every asset type and points to the shipped `@ignifx/vite-plugin/client` types.
- eb2ba35: Correct the shipped agent skills and halve the entry skill, from 72.6 KB to 34.9 KB: the commands a scaffolded project really has, the complete error-code ranges and file-format index, and CSM shadows surviving device loss.
  Skill pages name other skills by package and path inside it, so the pointers resolve from `node_modules`. The editor-host protocol method reference moves to `references/protocol.md` in that skill.
- Updated dependencies [0be954f]
- Updated dependencies [cd97af6]
  - @ignifx/core@0.21.1

## 0.21.0

### Patch Changes

- @ignifx/core@0.21.0

## 0.20.0

### Patch Changes

- f780bba: Warnings and errors from lights, post-processing, instancing, environments, shadows, surface shaders, settings, particles, physics, terrain and navmesh surfaces now name the entity or asset instead of printing `{entity}` and similar placeholders.
- Updated dependencies [104cac3]
- Updated dependencies [22f43ba]
- Updated dependencies [8bfc859]
- Updated dependencies [158069d]
- Updated dependencies [a6b8e03]
- Updated dependencies [f780bba]
- Updated dependencies [f780bba]
  - @ignifx/core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [b59a7c1]
- Updated dependencies [60531bb]
- Updated dependencies [8f134b2]
- Updated dependencies [cd8f666]
  - @ignifx/core@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [1d6ee43]
- Updated dependencies [e6655e0]
- Updated dependencies [89c2f6b]
- Updated dependencies [5f2ae72]
- Updated dependencies [d41217c]
  - @ignifx/core@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [ee4425f]
- Updated dependencies [a0ce8c6]
- Updated dependencies [45df4aa]
- Updated dependencies [9b6b741]
- Updated dependencies [212a922]
- Updated dependencies [7dafb6d]
  - @ignifx/core@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [fc79bcb]
- Updated dependencies [4709009]
  - @ignifx/core@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [14dd9cd]
- Updated dependencies [c75a3d7]
- Updated dependencies [105a427]
- Updated dependencies [1dc7131]
- Updated dependencies [a3d3a02]
- Updated dependencies [a4b0c20]
- Updated dependencies [ab1cd2b]
- Updated dependencies [39ae9d1]
- Updated dependencies [3db9f43]
- Updated dependencies [87a551e]
  - @ignifx/core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [5e3458c]
- Updated dependencies [ef78f28]
- Updated dependencies [6eaf002]
- Updated dependencies [879f7c2]
- Updated dependencies [9d9bc4e]
  - @ignifx/core@0.14.0

## 0.13.0

### Minor Changes

- afa8e20: A component class can declare `static title` and `static description`, and `describeRegisteredSchemas` uses them when no curated entry is given.
  Every engine component now declares its curated title or summary this way.
  The editor host now sends every package's component titles and summaries, such as "Rigidbody mover", instead of class names.

### Patch Changes

- Updated dependencies [afa8e20]
  - @ignifx/core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [8ea4101]
- Updated dependencies [3999551]
- Updated dependencies [8d7f8ef]
- Updated dependencies [0dbe07f]
- Updated dependencies [234534b]
- Updated dependencies [5dcbff1]
- Updated dependencies [a71c607]
- Updated dependencies [38ddd7a]
- Updated dependencies [51efbc6]
- Updated dependencies [7f5b116]
  - @ignifx/core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [2964d6e]
- Updated dependencies [fac8cc9]
- Updated dependencies [3b5b8ed]
  - @ignifx/core@0.11.0

## 0.10.0

### Patch Changes

- fd0afe5: - `create-ignifx` now pins a new project's `@ignifx/*` dependencies to its own release (for example `^0.9.1`) instead of `^0.0.0`, which installed the empty 0.0.0 packages.
  - `VERSION`, `app.version`, each extension's `version` and the `engineVersion` written into saved scenes now report the installed release instead of `"0.0.0"` (or `"0.2.1"`). `VERSION` is typed `string` instead of a fixed literal.
- 6e30980: - Terrain LOD and culling now see camera changes in the same frame. `TERRAIN_LOD_ORDER` moves from `10` to `1010`, after core's render sync at `900`; before, a new main camera or a changed `fov`, `near` or `far` took effect one frame late.
  - Correct the `LOD_ORDER` docs: core's render sync runs at order `900`, not `0`.
- Updated dependencies [6f197c9]
- Updated dependencies [1804a62]
- Updated dependencies [e0276f8]
- Updated dependencies [4c6e200]
- Updated dependencies [324ce73]
- Updated dependencies [37cf52e]
- Updated dependencies [612ba87]
- Updated dependencies [159ea03]
- Updated dependencies [b0480a0]
- Updated dependencies [1fba2ea]
- Updated dependencies [df7b73f]
- Updated dependencies [dc768d6]
- Updated dependencies [738f68d]
- Updated dependencies [fd0afe5]
- Updated dependencies [63d4e86]
  - @ignifx/core@0.10.0

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
