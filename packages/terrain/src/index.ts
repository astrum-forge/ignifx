/**
 * `@ignifx/terrain` public barrel: heightmap and procedural terrains with chunked geomipmapped LOD,
 * a splat surface shader on PBR, gameplay queries, sculpting, and seeded foliage
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5, `docs/adr/0023-terrain-chunked-geomipmapping.md`).
 *
 * Explicit named re-exports only — no `export *` (coding standards §4). Everything the adapter owns
 * (`src/lite/**`) stays internal apart from the type aliases the `.lite` escape hatches name.
 *
 * @packageDocumentation
 */

// assets — the loaded terrain, its loaders, and the layer texture arrays.
export { TerrainAsset, terrainAssetFromDefinition, type TerrainAssetOptions } from "./assets/terrain-asset.js";
export {
  createHeightmapLoader,
  createTerrainLoader,
  HEIGHTMAP_ASSET_TYPE,
  HEIGHTMAP_FILE_EXTENSIONS,
} from "./assets/loader.js";
export {
  createLayerTextures,
  packLayerImages,
  type TerrainLayerImages,
  type TerrainLayerTextures,
} from "./assets/layer-textures.js";

// components — the terrain itself and the foliage scatter.
export { Terrain, type TerrainColliderInit } from "./components/terrain.js";
export { TerrainScatter } from "./components/terrain-scatter.js";

// definition — the `.terrain.json` document, its validator, and address resolution.
export { defineTerrain } from "./definition/define-terrain.js";
export { resolveTerrainAddress } from "./definition/relative.js";
export {
  R16_FILE_EXTENSION,
  TERRAIN_ASSET_TYPE,
  TERRAIN_FILE_EXTENSIONS,
  TERRAIN_FORMAT,
  TERRAIN_FORMAT_VERSION,
  type TerrainChunksDefinition,
  type TerrainDefinition,
  type TerrainDefinitionInput,
  type TerrainHeightmapDefinition,
  type TerrainLayerDefinition,
  type TerrainLayerInput,
  type TerrainMaterialDefinition,
  type TerrainNoiseDefinition,
  type TerrainSize,
  type TerrainSplatDefinition,
  type TerrainSplatRule,
  type TerrainSplatRuleInput,
} from "./definition/types.js";

// errors — the `IGX-16##` code space this package owns.
export {
  MAX_TERRAIN_LAYERS,
  TERRAIN_ERROR_MESSAGES,
  TerrainErrorCode,
  terrainError,
  type TerrainErrorOptions,
} from "./errors.js";

// extension — the factory a game passes to `createApp`.
export { terrain } from "./extension.js";

// geometry — chunk grids with skirts, baked on the CPU.
export {
  buildChunkGeometry,
  chunkBounds,
  chunkGridSide,
  chunkIndexCount,
  chunkVertexCount,
  writeChunkIndices,
  writeChunkVertices,
  type ChunkGeometry,
} from "./geometry/chunk-geometry.js";

// heightfield — the queryable height grid and the three ways heights arrive.
export { createTerrainHit, HeightField, type TerrainHit, type TerrainRegion } from "./heightfield/height-field.js";
export { decodeRgbaImage, type RgbaImage } from "./heightfield/image.js";
export { generateNoiseField, hashFloats } from "./heightfield/noise.js";
export { decodePng, isPng, pngToRgba8, pngToSamples16, type DecodedPng } from "./heightfield/png.js";
export { decodeR16, encodeR16 } from "./heightfield/r16.js";

// lite — the escape-hatch type aliases the adapter's signatures name.
export type { LiteChunkMesh, LiteChunkNode } from "./lite/gpu/chunk-mesh.js";

// lod — level-of-detail selection, frustum culling, and the system that drives both.
export { Frustum } from "./lod/frustum.js";
export { distanceToBox, LOD_HYSTERESIS, lodThreshold, selectLod } from "./lod/lod-select.js";
export {
  TERRAIN_DIAGNOSTICS_COUNTERS,
  TERRAIN_DIAGNOSTICS_GROUP,
  TERRAIN_LOD_ORDER,
  TerrainLodSystem,
} from "./lod/terrain-lod-system.js";

// material — the generated splat shader, the foliage material, and the splat weights.
export {
  createFoliageMaterial,
  foliageMaterialDefinition,
  foliageShaderAddress,
  type FoliageMaterialInput,
} from "./material/foliage.js";
export { FOLIAGE_SHADER_NAME, foliageShaderSource, type FoliageShaderOptions } from "./material/foliage.wgsl.js";
export { loadGeneratedShader, shaderSourceAddress } from "./material/shader-source.js";
export {
  controlMapCount,
  generateControlMaps,
  LAYERS_PER_CONTROL_MAP,
  sampleControlWeight,
  solidControlMaps,
  type ControlMaps,
} from "./material/splat-rules.js";
export {
  TERRAIN_SPLAT_NAME,
  terrainSplatShaderSource,
  type TerrainSplatLayerSpec,
  type TerrainSplatShaderSpec,
} from "./material/terrain-splat.surface.wgsl.js";

// scatter — the seeded placement the `TerrainScatter` component drives.
export {
  createScatterPlacements,
  generateScatter,
  scatterCapacity,
  type ScatterPlacements,
  type ScatterRules,
} from "./scatter/placement.js";

// schemas — what the documentation harness reads.
export { terrainFileSchema } from "./file-schemas.js";
export { describeSchemas, describeTerrainFormat } from "./schemas.js";

// version — the string reported as `Extension.version`.
export { VERSION } from "./version.js";
