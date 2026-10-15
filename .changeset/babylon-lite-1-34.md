---
"@ignifx/core": minor
"@ignifx/2d": minor
"@ignifx/3d": minor
"@ignifx/audio": minor
"@ignifx/particles": minor
"@ignifx/particles-2d": minor
"@ignifx/physics": minor
"@ignifx/terrain": minor
"@ignifx/ui": minor
"ignifx": minor
---

### Breaking

ignifx now runs on Babylon Lite 1.34.0. `@babylonjs/lite` is pinned exactly, so install `@babylonjs/lite@1.34.0` alongside ignifx; the packages that declare it as a peer dependency accept no other version.

- `app.start()` now runs one extra renderable rebuild before the first frame, so that turning a shadow-casting light on or off and adding the first skinned or morph-target model after start keep rendering on Lite 1.34.
