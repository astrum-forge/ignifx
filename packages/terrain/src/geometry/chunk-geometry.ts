import { Vec3 } from "@ignifx/core";
import type { HeightField } from "../heightfield/height-field.js";
import type { MutableVec3 } from "@ignifx/core";

/**
 * Chunk geometry: geomipmapped grids with skirts, baked on the CPU
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2, `docs/adr/0023-terrain-chunked-geomipmapping.md`).
 *
 * A chunk's level-`lod` mesh has `n = chunkSize / 2^lod + 1` vertices per side: `n²` grid vertices
 * in row order, then four skirt strips of `n` vertices — the `-Z`, `+Z`, `-X`, `+X` edges in that
 * order — each a copy of its edge vertex dropped by `skirtDepth`. Every vertex takes the
 * full-resolution normal of its sample, so a chunk's levels shade identically and a LOD switch
 * changes the silhouette but not the lighting.
 *
 * Triangles are wound so the surface faces **up** under Babylon Lite's back-face culling, which is
 * the winding whose right-handed `(p1 - p0) x (p2 - p0)` points *down*; ignifx is left-handed
 * (ADR-0011), and this was measured on a device rather than derived.
 */

/**
 * The vertex arrays of one chunk at one level of detail.
 *
 * @public
 */
export interface ChunkGeometry {
  /** Three floats per vertex, in the terrain's local frame. */
  readonly positions: Float32Array;
  /** Three floats per vertex. */
  readonly normals: Float32Array;
  /** Two floats per vertex: the terrain-wide `0..1` coordinate. */
  readonly uvs: Float32Array;
  /** Three indices per triangle. */
  readonly indices: Uint32Array;
}

/** How many skirt strips a chunk has. */
const SKIRT_EDGES = 4;

/**
 * Vertices per side of a chunk's mesh at a level of detail.
 *
 * @param chunkSize - Quads per chunk side.
 * @param lod - The level; level `n` skips `2^n` samples.
 * @returns The vertex count per side.
 *
 * @public
 */
export function chunkGridSide(chunkSize: number, lod: number): number {
  return chunkSize / 2 ** lod + 1;
}

/**
 * How many vertices a chunk's mesh has at a level of detail, skirts included.
 *
 * @param chunkSize - Quads per chunk side.
 * @param lod - The level.
 * @returns The vertex count.
 *
 * @public
 */
export function chunkVertexCount(chunkSize: number, lod: number): number {
  const n = chunkGridSide(chunkSize, lod);
  return n * n + SKIRT_EDGES * n;
}

/**
 * How many indices a chunk's mesh has at a level of detail, skirts included.
 *
 * @param chunkSize - Quads per chunk side.
 * @param lod - The level.
 * @returns The index count, three per triangle.
 *
 * @public
 */
export function chunkIndexCount(chunkSize: number, lod: number): number {
  const n = chunkGridSide(chunkSize, lod);
  return 6 * (n - 1) * (n - 1) + SKIRT_EDGES * 6 * (n - 1);
}

/**
 * Builds one chunk's mesh at one level of detail.
 *
 * @param field - The height field, in the terrain's local frame.
 * @param chunkX - The chunk column.
 * @param chunkZ - The chunk row.
 * @param lod - The level of detail.
 * @param chunkSize - Quads per chunk side.
 * @param skirtDepth - How far the skirts hang down, in metres.
 * @returns Fresh arrays.
 *
 * @example
 * ```ts
 * const lod0 = buildChunkGeometry(field, 0, 0, 0, 64, 2);
 * lod0.positions.length / 3; // 65 * 65 + 4 * 65
 * ```
 *
 * @public
 */
export function buildChunkGeometry(
  field: HeightField,
  chunkX: number,
  chunkZ: number,
  lod: number,
  chunkSize: number,
  skirtDepth: number,
): ChunkGeometry {
  const vertices = chunkVertexCount(chunkSize, lod);
  const geometry: ChunkGeometry = {
    positions: new Float32Array(vertices * 3),
    normals: new Float32Array(vertices * 3),
    uvs: new Float32Array(vertices * 2),
    indices: new Uint32Array(chunkIndexCount(chunkSize, lod)),
  };
  writeChunkVertices(
    field,
    chunkX,
    chunkZ,
    lod,
    chunkSize,
    skirtDepth,
    geometry.positions,
    geometry.normals,
    geometry.uvs,
  );
  writeChunkIndices(chunkSize, lod, geometry.indices);
  return geometry;
}

/**
 * Writes a chunk's positions and normals — and, when given, its UVs — into existing arrays. This
 * is what a sculpt calls: the index buffer never changes, so only these are re-uploaded.
 *
 * @param field - The height field.
 * @param chunkX - The chunk column.
 * @param chunkZ - The chunk row.
 * @param lod - The level of detail.
 * @param chunkSize - Quads per chunk side.
 * @param skirtDepth - How far the skirts hang down, in metres.
 * @param positions - Receives three floats per vertex.
 * @param normals - Receives three floats per vertex.
 * @param uvs - Receives two floats per vertex, or omitted to leave UVs alone.
 *
 * @public
 */
export function writeChunkVertices(
  field: HeightField,
  chunkX: number,
  chunkZ: number,
  lod: number,
  chunkSize: number,
  skirtDepth: number,
  positions: Float32Array,
  normals: Float32Array,
  uvs?: Float32Array,
): void {
  const stride = 2 ** lod;
  const n = chunkGridSide(chunkSize, lod);
  const baseX = chunkX * chunkSize;
  const baseZ = chunkZ * chunkSize;
  const normal = scratchNormal();
  const inverseLast = 1 / (field.resolution - 1);
  let vertex = 0;
  const write = (ix: number, iz: number, drop: number): void => {
    const at = vertex * 3;
    positions[at] = field.sampleToLocalX(ix);
    positions[at + 1] = field.sample(ix, iz) - drop;
    positions[at + 2] = field.sampleToLocalZ(iz);
    field.sampleNormal(ix, iz, normal);
    normals[at] = normal.x;
    normals[at + 1] = normal.y;
    normals[at + 2] = normal.z;
    if (uvs !== undefined) {
      uvs[vertex * 2] = ix * inverseLast;
      uvs[vertex * 2 + 1] = iz * inverseLast;
    }
    vertex += 1;
  };
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      write(baseX + i * stride, baseZ + j * stride, 0);
    }
  }
  // Skirts, in the edge order the index writer expects: -Z, +Z, -X, +X.
  for (let k = 0; k < n; k += 1) {
    write(baseX + k * stride, baseZ, skirtDepth);
  }
  for (let k = 0; k < n; k += 1) {
    write(baseX + k * stride, baseZ + chunkSize, skirtDepth);
  }
  for (let k = 0; k < n; k += 1) {
    write(baseX, baseZ + k * stride, skirtDepth);
  }
  for (let k = 0; k < n; k += 1) {
    write(baseX + chunkSize, baseZ + k * stride, skirtDepth);
  }
}

/**
 * Writes a chunk's index buffer at a level of detail. It depends on nothing but the sizes, so every
 * chunk of a terrain shares one pattern per level.
 *
 * @param chunkSize - Quads per chunk side.
 * @param lod - The level of detail.
 * @param indices - Receives {@link chunkIndexCount} indices.
 *
 * @public
 */
export function writeChunkIndices(chunkSize: number, lod: number, indices: Uint32Array): void {
  const n = chunkGridSide(chunkSize, lod);
  let index = 0;
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[index] = a;
      indices[index + 1] = b;
      indices[index + 2] = c;
      indices[index + 3] = b;
      indices[index + 4] = d;
      indices[index + 5] = c;
      index += 6;
    }
  }
  const gridCount = n * n;
  // For each edge: the grid vertex of its k-th point and whether the quad is wound the other way,
  // so every skirt faces out of the chunk (see the module note).
  const edges: readonly { readonly grid: (k: number) => number; readonly flip: boolean }[] = [
    { grid: (k) => k, flip: true },
    { grid: (k) => (n - 1) * n + k, flip: false },
    { grid: (k) => k * n, flip: false },
    { grid: (k) => k * n + (n - 1), flip: true },
  ];
  for (let edge = 0; edge < edges.length; edge += 1) {
    const spec = edges[edge];
    if (spec === undefined) {
      continue;
    }
    const skirtBase = gridCount + edge * n;
    for (let k = 0; k < n - 1; k += 1) {
      const top0 = spec.grid(k);
      const top1 = spec.grid(k + 1);
      const low0 = skirtBase + k;
      const low1 = skirtBase + k + 1;
      if (spec.flip) {
        indices[index] = top0;
        indices[index + 1] = low0;
        indices[index + 2] = top1;
        indices[index + 3] = top1;
        indices[index + 4] = low0;
        indices[index + 5] = low1;
      } else {
        indices[index] = top0;
        indices[index + 1] = top1;
        indices[index + 2] = low0;
        indices[index + 3] = top1;
        indices[index + 4] = low1;
        indices[index + 5] = low0;
      }
      index += 6;
    }
  }
}

/**
 * A chunk's axis-aligned bounds in the terrain's local frame, skirts included.
 *
 * @param field - The height field.
 * @param chunkX - The chunk column.
 * @param chunkZ - The chunk row.
 * @param chunkSize - Quads per chunk side.
 * @param skirtDepth - How far the skirts hang down.
 * @param out - Receives `[minX, minY, minZ, maxX, maxY, maxZ]`.
 * @returns `out`, for chaining.
 *
 * @public
 */
export function chunkBounds(
  field: HeightField,
  chunkX: number,
  chunkZ: number,
  chunkSize: number,
  skirtDepth: number,
  out: Float32Array,
): Float32Array {
  const baseX = chunkX * chunkSize;
  const baseZ = chunkZ * chunkSize;
  field.minMax(baseX, baseZ, chunkSize + 1, chunkSize + 1, out);
  const minY = (out[0] ?? 0) - skirtDepth;
  const maxY = out[1] ?? 0;
  out[0] = field.sampleToLocalX(baseX);
  out[1] = minY;
  out[2] = field.sampleToLocalZ(baseZ);
  out[3] = field.sampleToLocalX(baseX + chunkSize);
  out[4] = maxY;
  out[5] = field.sampleToLocalZ(baseZ + chunkSize);
  return out;
}

/** One scratch vector per module, created on first use so import time allocates nothing. */
let normalScratch: MutableVec3 | null = null;

/**
 * The shared scratch normal.
 *
 * @returns The vector; every caller sees the same instance.
 */
function scratchNormal(): MutableVec3 {
  normalScratch ??= new Vec3();
  return normalScratch;
}
