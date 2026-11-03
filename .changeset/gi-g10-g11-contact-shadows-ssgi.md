---
"@ignifx/core": minor
"ignifx": minor
---

`PostProcessStack` gains `contactShadows` (screen-space contact shadows towards the main directional light) and `ssgi` (beta, one bounce of screen-space global illumination), both off by default and loaded only when enabled. They need `rendering.features.postProcessing`, and SSGI's `environmentDiffuse` needs `rendering.hdr` or the `materialPlugins` feature.
