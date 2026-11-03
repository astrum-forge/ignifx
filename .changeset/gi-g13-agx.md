---
"@ignifx/core": minor
---

Add `"agx"` to the tone-mapping curves: `Environment.imageProcessing.toneMapping = "agx"` applies the AgX base look (Benjamin Wendt's minimal AgX, a fit of Blender's "AgX Base"), on the plain path and through the `rendering.hdr` output pass alike. The curve's shader loads only when a scene names it.
