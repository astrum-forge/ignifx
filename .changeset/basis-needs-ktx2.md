---
"@ignifx/core": minor
---

A `.basis` texture in a project that serves its own decoders (one built with `@ignifx/vite-plugin`) now fails with `IGX-0509` before anything is fetched, instead of loading Babylon Lite's transcoder from `cdn.babylonjs.com`, which Lite gives no way to move. Elsewhere a `.basis` load that the page's Content Security Policy refuses fails with the same code. Convert `.basis` textures to `.ktx2`, which carry the same data and whose decoder ships with `@ignifx/core`.
