---
"@ignifx/core": minor
---

Lightmap atlas placement: a `.lightmap.json` entry's `scale` and `offset` now move that renderer's UV2 into its square of a shared lightmap texture, so many static renderers can use one atlas. It needs `lightmap.uv2: true` and a mesh with `uvs2`; otherwise the renderer still logs `IGX-0735` and samples the whole texture.
