---
"@ignifx/core": minor
---

Add temporal anti-aliasing: `rendering.taa: { enabled: true }` (with `rendering.hdr` on) jitters each frame and blends it into a reprojected, neighbourhood-clipped history, with `blend`, `sharpness`, `clamp` and `cutDistance` settings. `app.renderer.resetTemporalHistory()` drops the history after a camera cut the engine cannot detect.
