---
"@ignifx/cli": patch
---

The 3D templates' desktop builds now run at `rendering.quality: "high"` (HDR, TAA, ambient occlusion, HDR bloom) with AgX tone mapping. Browser builds are unchanged. Both 3D templates also accept `?quality=low|medium|high|custom` to try a tier.
