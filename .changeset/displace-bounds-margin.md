---
"@ignifx/core": minor
"ignifx": minor
---

Add the `// @ignifx displace <metres>` pragma for `.wgsl` shader and surface files: it declares how far the vertex stage moves a vertex, and every `MeshRenderer` and `InstancedMeshRenderer` drawing with the material widens its bounds by that much. A caster moved beyond its mesh's own bounds now keeps its whole shadow under directional PCF and ESM lights, and a GPU-culled instance moved onto the screen is no longer culled.
