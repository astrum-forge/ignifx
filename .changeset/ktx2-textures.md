---
"@ignifx/core": minor
---

Load `.ktx2` textures through `app.assets`, transcoded to the device's compressed format (BC7, ETC2, ASTC or RGBA8), and `.basis` through Lite's Basis loader. A `.ktx2` keeps its rows as stored, so encode it vertically flipped to draw like its PNG under the default `invertY`.

Ship Babylon Lite's KTX2 and meshopt decoders in `@ignifx/core` and load them from the game's own origin whenever the manifest lists them, so games no longer fetch them from `cdn.babylonjs.com`.
