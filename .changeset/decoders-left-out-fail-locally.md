---
"@ignifx/core": minor
"@ignifx/vite-plugin": patch
---

A texture or model that needs a decoder turned off with the vite plugin's `decoders` option now fails with `IGX-0508` before loading, instead of fetching the decoder from `cdn.babylonjs.com` or the page root. The message names the option to set back to `true`.
