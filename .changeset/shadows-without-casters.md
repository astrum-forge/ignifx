---
"@ignifx/core": patch
---

Fix frames never presenting when `rendering.features.shadows` is on and a light casts shadows but no mesh does. The shadow pass drew every mesh into the shadow map it was also reading, and the GPU rejected the frame; it now only clears the map, so the scene renders unshadowed until something casts. The same happened when the last caster stopped casting.
