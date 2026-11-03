---
"@ignifx/core": minor
---

Add auto exposure for HDR projects: `rendering.autoExposure` meters the scene on the GPU and eases the exposure between `minEv` and `maxEv`, at `speedUp` and `speedDown`, plus `compensation`. Off by default; it needs `rendering.hdr`.
