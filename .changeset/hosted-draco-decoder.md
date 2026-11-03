---
"@ignifx/core": minor
---

Load Draco-compressed glTF models offline: `@ignifx/core` now ships Google's Draco decoder, and `@ignifx/vite-plugin` serves it from the game's own origin like the KTX2 and meshopt decoders, fetched only when a model uses `KHR_draco_mesh_compression`.
