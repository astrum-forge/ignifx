# ADR-0026 · Terrain is chunked geomipmapping with skirts on a PBR surface shader

**Status:** Proposed · **Date:** 2026-09-08 · **Deciders:** Astrum Forge Studios

## Context

Open-world and outdoor games need a terrain: a heightmap, texture layers blended by a control map, level of detail, height queries, physics, and foliage. Babylon Lite 1.27.0 offers a single-mesh `createGroundFromHeightMap`, `createMeshFromData` with vertex updates (`updateMeshPositions` and friends), writable mesh bounds, textures from pixels and texture arrays, thin instances with GPU culling and a LOD partner, and material plugins whose samplers are fragment-only (`lib/material/plugin/plugin-bridge-shared.js`) and whose vertex slot can only translate a vertex through `finalWorld[3]` (`lib/material/pbr/pbr-template.js`). `@ignifx/physics` already has a `HeightfieldCollider` over a row-major sample grid.

The survey (plan §9.1) compared geomipmapping with skirts (de Boer 2000, Ulrich 2002), CDLOD (Strugar 2009) and geometry clipmaps (Losasso & Hoppe 2004), and recommended CDLOD for its crack-free morphing; it also found 8-bit heightmaps terrace, that Unity's built-in and URP terrains blend four layers from one RGBA control map while Terrain3D packs index and weight into a 32-bit word over texture arrays, and that terrain normals are best precomputed and regenerated on edit.

## Options considered

1. **CDLOD on a `ShaderMaterial`** — morphing needs the height texture in the vertex stage; a shader material receives no shadows and no direct light, so the terrain would be unlit relative to everything on it.
2. **CDLOD on PBR through a plugin** — plugin samplers are fragment-only; the vertex slot cannot read a height texture. Not buildable on 1.27.0.
3. **Chunked geomipmapping with skirts, CPU-baked positions, PBR + a surface shader** — every LOD mesh carries its real heights; a downward skirt hides the crack between neighbours at different LODs; lighting, shadows, IBL and fog are the engine's. Popping at LOD switches is bounded by chunk size and a hysteresis band.
4. **Geometry clipmaps** — continuous ring refills and awkward height queries at ring boundaries; no benefit without vertex-stage textures.

## Decision

Option 3:

- A `.terrain.json` describes size, resolution (2ⁿ+1), a `.r16` heightmap (canonical; 16-bit PNG through `ignifx import heightmap`; 8-bit PNG accepted with a terracing warning) or seeded noise, chunks (size, LOD levels, LOD distance, skirt depth), one to four layers (albedo, optional normal, tiling, triplanar), and a control map or slope/height rules that generate one.
- The terrain owns one Lite mesh per chunk per LOD through a single adapter file; only one LOD per chunk is visible; a `PreRender` system selects LODs by camera distance with hysteresis.
- Normals are precomputed on the CPU and regenerated for edited regions.
- One PBR material with the `terrainSplat` surface shader (ADR-0024) blends the layers; per-layer roughness is unavailable in this Lite version.
- Height queries read the source height field; `colliderInit()` returns the `HeightfieldCollider` shape by data, so `@ignifx/terrain` does not depend on `@ignifx/physics`.
- `TerrainScatter` places seeded foliage on an `InstancedMeshRenderer` with GPU culling and a LOD partner; foliage wind is a `displace` surface-shader hook on PBR.

## Consequences

- Draw calls equal visible chunks (64 for a 512 m terrain with 64 m chunks); memory holds every LOD of every chunk (about 1.3× LOD 0).
- Up to eight layers in v1 through albedo and normal texture arrays and two RGBA control maps (spike S0.2 proved `texture_2d_array<f32>` plugin samplers work in 1.27.0 behind a type cast); the 32-layer packed control word is the v2 design. CDLOD-style morphing through a `uv2`-carried parent height is the recorded v1.1 path if popping proves visible.
- Runtime sculpting rewrites the affected chunks' positions and normals and raises a signal a collider and a scatter follow.
- Validation (spike S0.3, 2026-09-08, Apple M1): building 64 chunks × 4 LODs of a 513² field with skirts costs about 40 ms CPU and uploads 20.7 MB (12.66 MB vertices, 9.09 MB indices). Lite does not frustum-cull plain meshes (`lib/frame-graph/render-task.js` 385–391 skips only `visible === false`), so the LOD system culls; visibility must go through `setSubtreeVisible` (direct `visible` writes take no effect until the epoch bumps) and costs one bundle re-record, no renderable rebuild; hidden meshes cost about nothing on the GPU. `engine.drawCallCount` counts hidden bindings and is not a draw metric. No browser image API decodes 16-bit PNG losslessly, so the loader decodes PNG on the CPU and `.r16` stays canonical.
