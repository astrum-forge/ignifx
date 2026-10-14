---
"@ignifx/core": patch
"ignifx": patch
---

- Fix shadows of animated skinned models staying frozen in their first pose: they now follow the skeleton under ESM, PCF, CSM and spot-light shadows, including small moves that keep the same bounding box.
- Fix shadows of shader materials whose vertex stage moves by a uniform such as `time`: PCF and CSM maps now redraw when the uniform changes. Displacement beyond the mesh's own bounds can still be clipped by a directional PCF or ESM map.
