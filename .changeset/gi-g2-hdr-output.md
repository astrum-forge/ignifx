---
"@ignifx/core": minor
---

Add `rendering.hdr`: the scene renders into a floating-point target and one final pass applies the `Environment`'s exposure, contrast and tone mapping. A scene of PBR materials looks the same; fog, Standard materials, sprites, particles and the skybox are not yet supported in HDR.
