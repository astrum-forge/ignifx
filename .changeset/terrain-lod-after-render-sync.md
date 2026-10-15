---
"@ignifx/terrain": patch
"@ignifx/3d": patch
---

- Terrain LOD and culling now see camera changes in the same frame. `TERRAIN_LOD_ORDER` moves from `10` to `1010`, after core's render sync at `900`; before, a new main camera or a changed `fov`, `near` or `far` took effect one frame late.
- Correct the `LOD_ORDER` docs: core's render sync runs at order `900`, not `0`.
