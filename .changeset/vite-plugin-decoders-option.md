---
"@ignifx/vite-plugin": minor
---

Add a `decoders` option that leaves unused Babylon Lite decoders out of a build: `ignifx({ decoders: { draco: false } })` keeps the 251 KB Draco decoder out of `dist/` (also `meshopt` and `ktx2`). Every decoder is still copied by default, and a file that needs one you left out fails to load.
