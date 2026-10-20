# @ignifx/particles

## 0.10.0

### Patch Changes

- 451c503: In an edit-mode app, a particle system still plays on awake and shows its first frame, but its clock stands still; `simulate(seconds)` previews it.
- fd0afe5: - `create-ignifx` now pins a new project's `@ignifx/*` dependencies to its own release (for example `^0.9.1`) instead of `^0.0.0`, which installed the empty 0.0.0 packages.
  - `VERSION`, `app.version`, each extension's `version` and the `engineVersion` written into saved scenes now report the installed release instead of `"0.0.0"` (or `"0.2.1"`). `VERSION` is typed `string` instead of a fixed literal.
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

- d617f2c: Fix API and skill examples that called `.retain()` on an asset handle before assigning it to a component field. A field takes no reference of its own, so that extra reference was never released. The examples now assign the handle directly and release it when it is no longer used.
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

- 6e1eed7: - Add `@ignifx/particles`: `ParticleSystem` plays `.particles.json` definitions as stateless GPU particles. The vertex shader evaluates each particle from its spawn record and the current time, so the CPU writes only the particles emitted each frame. `play`, `stop`, `pause`, `resume`, `emit(n)`, `simulate(seconds)`, `aliveCount` and `onStopped` control it.
  - Add nine presets through `particleDefinition("fire" | "smoke" | "sparks" | "explosion" | "dust" | "sparkle" | "rain" | "snow" | "leaves", overrides?)`.
  - Add `app.particles` with `maxParticles`, `qualityScale` and `gravity` (taken from the physics settings when `@ignifx/physics` is registered), plus alive, emitted, upload and draw-call counters in `app.diagnostics`.
  - Particles pause exactly with the app, follow `timeScale`, and reproduce for a given `seed`. Collisions, sub-emitters and per-particle sorting are not available: they are not functions of time alone.
  - Add `@ignifx/particles-2d`: `ParticleSystem2D` plays the same definitions into a 2D sorting layer through `app.twoD.createSpriteBatch`, sharing the particle budget with the 3D systems.
  - The `ignifx` umbrella re-exports both packages.

### Patch Changes

- Updated dependencies [be82465]
- Updated dependencies [6e1eed7]
  - @ignifx/core@0.3.0
