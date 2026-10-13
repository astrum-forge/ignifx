---
"@ignifx/core": patch
---

Fix custom post effects flipping the frame upside down: a `PostProcessStack` with an odd number of custom effects presented the image vertically mirrored. Every chain length now presents upright, and `in.uv` in a `.post.wgsl` starts at the top-left like `in.position`. If a shader flipped `uv.y` to work around this, remove the flip.
