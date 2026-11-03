---
"@ignifx/core": minor
---

Add HDR bloom: with `rendering.hdr` on, `PostProcessStack.bloom` runs a downsample/upsample glow on the linear scene colour before tone mapping, tuned by the new `intensity`, `radius` and `hdrThreshold` fields. It replaces the LDR bloom under HDR; projects without HDR keep the LDR bloom unchanged.
