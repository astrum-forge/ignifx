---
"@ignifx/core": minor
---

Add `rendering.quality`, a quality tier: `"low"`, `"medium"`, `"high"` or `"custom"` (the default, which changes nothing). A named tier turns `hdr`, TAA and GTAO on or off and picks the GTAO resolution to fit the GPU budget, and caps a `PostProcessStack`'s contact shadows (from `"medium"`) and SSGI (`"high"` only). A field you set yourself still wins: `{ quality: "high", taa: { enabled: false } }` is `"high"` without TAA. New exports: `RENDERING_QUALITIES` and `RenderingQuality`.
