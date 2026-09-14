import { describe, expect, it } from "vitest";
import {
  buildChunkGeometry,
  chunkBounds,
  chunkGridSide,
  chunkIndexCount,
  chunkVertexCount,
} from "../../src/geometry/chunk-geometry.js";
import { HeightField } from "../../src/heightfield/height-field.js";

/** Quads per chunk side in these suites. */
const CHUNK_SIZE = 4;

/** How far the skirts hang down. */
const SKIRT_DEPTH = 1;

/**
 * A 9x9 field whose height is a smooth bump, so LOD meshes differ from one another.
 *
 * @returns The field.
 */
function bumpField(): HeightField {
  const resolution = 9;
  const heights = new Float32Array(resolution * resolution);
  for (let iz = 0; iz < resolution; iz += 1) {
    for (let ix = 0; ix < resolution; ix += 1) {
      heights[iz * resolution + ix] = Math.sin(ix * 0.7) * 2 + Math.cos(iz * 0.5) * 1.5;
    }
  }
  return new HeightField(resolution, { width: 8, depth: 8, height: 10 }, heights);
}

describe("chunk geometry counts", () => {
  it("halves the grid side with every level", () => {
    expect(chunkGridSide(64, 0)).toBe(65);
    expect(chunkGridSide(64, 1)).toBe(33);
    expect(chunkGridSide(64, 3)).toBe(9);
  });

  it("counts the grid vertices plus four skirt strips", () => {
    expect(chunkVertexCount(64, 0)).toBe(65 * 65 + 4 * 65);
    expect(chunkVertexCount(64, 2)).toBe(17 * 17 + 4 * 17);
  });

  it("counts two triangles per quad plus two per skirt quad", () => {
    expect(chunkIndexCount(64, 0)).toBe(6 * 64 * 64 + 4 * 6 * 64);
  });

  it("builds arrays of exactly those lengths", () => {
    const geometry = buildChunkGeometry(bumpField(), 0, 0, 0, CHUNK_SIZE, SKIRT_DEPTH);

    expect(geometry.positions.length).toBe(chunkVertexCount(CHUNK_SIZE, 0) * 3);
    expect(geometry.normals.length).toBe(chunkVertexCount(CHUNK_SIZE, 0) * 3);
    expect(geometry.uvs.length).toBe(chunkVertexCount(CHUNK_SIZE, 0) * 2);
    expect(geometry.indices.length).toBe(chunkIndexCount(CHUNK_SIZE, 0));
  });

  it("indexes only vertices that exist", () => {
    const geometry = buildChunkGeometry(bumpField(), 0, 0, 1, CHUNK_SIZE, SKIRT_DEPTH);
    const vertices = geometry.positions.length / 3;

    expect(Math.max(...geometry.indices)).toBeLessThan(vertices);
  });
});

describe("chunk geometry layout", () => {
  it("puts every grid vertex on the height field", () => {
    const field = bumpField();
    const geometry = buildChunkGeometry(field, 1, 1, 0, CHUNK_SIZE, SKIRT_DEPTH);
    const side = chunkGridSide(CHUNK_SIZE, 0);

    for (let index = 0; index < side * side; index += 1) {
      const at = index * 3;
      const x = geometry.positions[at] ?? 0;
      const z = geometry.positions[at + 2] ?? 0;
      expect(geometry.positions[at + 1] ?? 0).toBeCloseTo(field.heightAt(x, z), 4);
    }
  });

  it("drops every skirt vertex by the skirt depth", () => {
    const field = bumpField();
    const geometry = buildChunkGeometry(field, 0, 0, 0, CHUNK_SIZE, SKIRT_DEPTH);
    const side = chunkGridSide(CHUNK_SIZE, 0);
    const gridCount = side * side;

    for (let index = gridCount; index < geometry.positions.length / 3; index += 1) {
      const at = index * 3;
      const x = geometry.positions[at] ?? 0;
      const z = geometry.positions[at + 2] ?? 0;
      expect(geometry.positions[at + 1] ?? 0).toBeCloseTo(field.heightAt(x, z) - SKIRT_DEPTH, 4);
    }
  });

  it("writes the terrain-wide UV of each sample", () => {
    const geometry = buildChunkGeometry(bumpField(), 1, 0, 0, CHUNK_SIZE, SKIRT_DEPTH);

    expect(geometry.uvs[0]).toBeCloseTo(4 / 8, 6);
    expect(geometry.uvs[1]).toBeCloseTo(0, 6);
  });

  it("gives every level the same normal at a shared sample", () => {
    const field = bumpField();
    const fine = buildChunkGeometry(field, 0, 0, 0, CHUNK_SIZE, SKIRT_DEPTH);
    const coarse = buildChunkGeometry(field, 0, 0, 1, CHUNK_SIZE, SKIRT_DEPTH);

    expect(coarse.normals[0]).toBeCloseTo(fine.normals[0] ?? 0, 6);
    expect(coarse.normals[1]).toBeCloseTo(fine.normals[1] ?? 0, 6);
  });

  it("winds every grid triangle the same way, so the surface faces up on a device", () => {
    // ignifx is left-handed, so the winding that draws upwards is the one whose right-handed cross
    // product points down. `terrain.browser.test.ts` is what proves it renders.
    const geometry = buildChunkGeometry(bumpField(), 0, 0, 0, CHUNK_SIZE, 0);
    const side = chunkGridSide(CHUNK_SIZE, 0);
    const gridTriangles = 2 * (side - 1) * (side - 1);

    for (let triangle = 0; triangle < gridTriangles; triangle += 1) {
      expect(faceNormalY(geometry.positions, geometry.indices, triangle)).toBeLessThan(0);
    }
  });
});

describe("crack-free LOD edges", () => {
  it("puts a coarse edge vertex exactly on a fine one it shares", () => {
    const field = bumpField();
    const fine = buildChunkGeometry(field, 0, 0, 0, CHUNK_SIZE, SKIRT_DEPTH);
    const coarse = buildChunkGeometry(field, 0, 0, 1, CHUNK_SIZE, SKIRT_DEPTH);
    const fineSide = chunkGridSide(CHUNK_SIZE, 0);
    const coarseSide = chunkGridSide(CHUNK_SIZE, 1);

    // The coarse mesh keeps every other sample, so its k-th edge vertex is the fine 2k-th.
    for (let k = 0; k < coarseSide; k += 1) {
      const coarseAt = k * 3;
      const fineAt = k * 2 * 3;
      expect(coarse.positions[coarseAt]).toBeCloseTo(fine.positions[fineAt] ?? 0, 5);
      expect(coarse.positions[coarseAt + 1]).toBeCloseTo(fine.positions[fineAt + 1] ?? 0, 5);
      expect(coarse.positions[coarseAt + 2]).toBeCloseTo(fine.positions[fineAt + 2] ?? 0, 5);
    }

    // The skirt is what hides the gap between those shared points: it reaches below the lowest
    // height either level can show along the edge.
    const lowest = lowestEdgeHeight(fine.positions, fineSide);
    const skirtY = coarse.positions[coarseSide * coarseSide * 3 + 1] ?? 0;
    expect(skirtY).toBeLessThanOrEqual(lowest);
  });
});

describe("chunkBounds", () => {
  it("covers the chunk's footprint and its height range, skirt included", () => {
    const field = bumpField();
    const out = new Float32Array(6);

    chunkBounds(field, 0, 0, CHUNK_SIZE, SKIRT_DEPTH, out);

    expect(out[0]).toBeCloseTo(field.sampleToLocalX(0), 6);
    expect(out[3]).toBeCloseTo(field.sampleToLocalX(CHUNK_SIZE), 6);
    const range = new Float32Array(2);
    field.minMax(0, 0, CHUNK_SIZE + 1, CHUNK_SIZE + 1, range);
    expect(out[1]).toBeCloseTo((range[0] ?? 0) - SKIRT_DEPTH, 6);
    expect(out[4]).toBeCloseTo(range[1] ?? 0, 6);
  });

  it("contains every vertex of the chunk's finest mesh", () => {
    const field = bumpField();
    const bounds = chunkBounds(field, 1, 1, CHUNK_SIZE, SKIRT_DEPTH, new Float32Array(6));
    const geometry = buildChunkGeometry(field, 1, 1, 0, CHUNK_SIZE, SKIRT_DEPTH);

    for (let index = 0; index < geometry.positions.length; index += 3) {
      expect(geometry.positions[index]).toBeGreaterThanOrEqual((bounds[0] ?? 0) - 1e-4);
      expect(geometry.positions[index + 1]).toBeGreaterThanOrEqual((bounds[1] ?? 0) - 1e-4);
      expect(geometry.positions[index + 2]).toBeGreaterThanOrEqual((bounds[2] ?? 0) - 1e-4);
      expect(geometry.positions[index]).toBeLessThanOrEqual((bounds[3] ?? 0) + 1e-4);
      expect(geometry.positions[index + 1]).toBeLessThanOrEqual((bounds[4] ?? 0) + 1e-4);
      expect(geometry.positions[index + 2]).toBeLessThanOrEqual((bounds[5] ?? 0) + 1e-4);
    }
  });
});

/**
 * The Y component of a triangle's face normal.
 *
 * @param positions - The packed positions.
 * @param indices - The index buffer.
 * @param triangle - Which triangle.
 * @returns The Y of `(p1 - p0) x (p2 - p0)`.
 */
function faceNormalY(positions: Float32Array, indices: Uint32Array, triangle: number): number {
  const a = (indices[triangle * 3] ?? 0) * 3;
  const b = (indices[triangle * 3 + 1] ?? 0) * 3;
  const c = (indices[triangle * 3 + 2] ?? 0) * 3;
  const ux = (positions[b] ?? 0) - (positions[a] ?? 0);
  const uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
  const vx = (positions[c] ?? 0) - (positions[a] ?? 0);
  const vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
  return uz * vx - ux * vz;
}

/**
 * The lowest height along a chunk's first edge row.
 *
 * @param positions - The chunk's packed vertex positions.
 * @param side - Vertices per side.
 * @returns The height, in metres.
 */
function lowestEdgeHeight(positions: Float32Array, side: number): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (let k = 0; k < side; k += 1) {
    lowest = Math.min(lowest, positions[k * 3 + 1] ?? 0);
  }
  return lowest;
}
