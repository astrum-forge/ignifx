---
"@ignifx/core": patch
---

Fix a black frame when a `PostProcessStack` runs contact shadows and SSGI together without `rendering.hdr` (also reached by `rendering.quality: "high"` with `hdr: false` written). The second pass wrote the scene colour target, which Lite reallocated under the scene pass ("Destroyed texture" in WebGPU); on the plain path the passes now ping-pong between two scratch targets and copy back.
