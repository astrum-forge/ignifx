import { describe, expect, it } from "vitest";
import { readGltfTriangles } from "../../src/render/light-probe-bake-gltf.js";
import { MAX_BAKE_SEGMENTS, primitiveTriangles } from "../../src/render/light-probe-bake-primitives.js";
import { glbOf, gltfOf } from "./support/gltf-bytes.js";
import type { MeshPrimitiveDefinition } from "../../src/render/mesh-asset.js";

/**
 * The light-probe bake's geometry builders: the primitives rebuilt on the CPU at Lite's sizes, and
 * the minimal glTF reader.
 */

/**
 * The axis-aligned bounds of some positions.
 *
 * @param positions - Three floats per vertex.
 * @returns `[min, max]`.
 */
function bounds(positions: Float32Array): [number[], number[]] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 1) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis] ?? 0, positions[i] ?? 0);
    max[axis] = Math.max(max[axis] ?? 0, positions[i] ?? 0);
  }
  return [min, max];
}

/**
 * Checks that every index names a vertex and the count is whole triangles.
 *
 * @param positions - The positions.
 * @param indices - The indices.
 */
function expectWellFormed(positions: Float32Array, indices: Uint32Array): void {
  expect(indices.length % 3).toBe(0);
  expect(indices.length).toBeGreaterThan(0);
  const vertices = positions.length / 3;
  expect([...indices].every((index) => index < vertices)).toBe(true);
}

describe("primitiveTriangles", () => {
  it.each<[MeshPrimitiveDefinition, number[], number[]]>([
    [{ primitive: "box", options: {} }, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
    [{ primitive: "box", options: { size: 2, depth: 4 } }, [-1, -1, -2], [1, 1, 2]],
    [{ primitive: "sphere", options: { diameter: 2 } }, [-1, -1, -1], [1, 1, 1]],
    [{ primitive: "plane", options: { width: 4, height: 2 } }, [-2, -1, 0], [2, 1, 0]],
    [{ primitive: "ground", options: { width: 6, height: 2, subdivisions: 8 } }, [-3, 0, -1], [3, 0, 1]],
    [{ primitive: "cylinder", options: {} }, [-0.5, -1, -0.5], [0.5, 1, 0.5]],
    [{ primitive: "capsule", options: { height: 2, radius: 0.5 } }, [-0.5, -1, -0.5], [0.5, 1, 0.5]],
    [{ primitive: "capsule", options: {} }, [-0.25, -0.5, -0.25], [0.25, 0.5, 0.25]],
    [{ primitive: "torus", options: { diameter: 2, thickness: 0.5 } }, [-1.25, -0.25, -1.25], [1.25, 0.25, 1.25]],
  ])("builds %j at Lite's size", (definition, min, max) => {
    const { positions, indices } = primitiveTriangles(definition);
    expectWellFormed(positions, indices);
    const [lo, hi] = bounds(positions);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(lo[axis]).toBeCloseTo(min[axis] ?? 0, 4);
      expect(hi[axis]).toBeCloseTo(max[axis] ?? 0, 4);
    }
  });

  it("caps the tessellation of curved shapes", () => {
    const sphere = primitiveTriangles({ primitive: "sphere", options: { segments: 64 } });
    expect(sphere.indices.length / 3).toBe(MAX_BAKE_SEGMENTS * MAX_BAKE_SEGMENTS * 2 * 2);
    const cone = primitiveTriangles({ primitive: "cylinder", options: { diameterTop: 0, height: 1 } });
    const [lo, hi] = bounds(cone.positions);
    expect(hi[1]).toBeCloseTo(0.5, 6);
    expect(lo[1]).toBeCloseTo(-0.5, 6);
  });
});

describe("readGltfTriangles", () => {
  const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];

  it("reads a .glb's triangles through its node transforms, mirrored on X as Lite draws them", () => {
    const geometry = readGltfTriangles(
      glbOf(
        [
          { positions: triangle, translation: [1, 2, 3], scale: 2, baseColor: [0.5, 0.25, 1, 1], name: "Paint" },
          { positions: triangle, baseColor: [1, 1, 1, 1], metallic: 1 },
          { positions: triangle },
        ],
        [10, 0, 0],
      ),
    );
    expect(geometry.skipped).toEqual([]);
    expect(geometry.primitives).toHaveLength(3);
    const [first, metal, bare] = geometry.primitives;
    // Parent (10, 0, 0), child (1, 2, 3) scaled by 2, then X mirrored.
    expect([...(first?.positions ?? [])]).toEqual([-11, 2, 3, -13, 2, 3, -11, 4, 3]);
    expect([...(first?.indices ?? [])]).toEqual([0, 1, 2]);
    expect(first?.albedo).toEqual([0.5, 0.25, 1]);
    expect(first?.materialName).toBe("Paint");
    expect(metal?.albedo).toEqual([0, 0, 0]);
    expect(bare?.albedo).toEqual([1, 1, 1]);
    expect(bare?.materialName).toBeNull();
  });

  it("reads a .gltf with an embedded buffer, and skips what it cannot read with a reason", () => {
    const embedded = readGltfTriangles(gltfOf([{ positions: triangle }]));
    expect(embedded.primitives).toHaveLength(1);
    expect([...(embedded.primitives[0]?.positions ?? [])]).toEqual([0, 0, 0, -1, 0, 0, 0, 1, 0]);

    const external = readGltfTriangles(gltfOf([{ positions: triangle }], "model.bin"));
    expect(external.primitives).toHaveLength(0);
    expect(external.skipped[0]).toContain("separate file");

    const draco = readGltfTriangles(glbOf([{ positions: triangle, draco: true }, { positions: triangle }]));
    expect(draco.primitives).toHaveLength(1);
    expect(draco.skipped).toEqual(["mesh 0 primitive 0: Draco-compressed (KHR_draco_mesh_compression)"]);

    expect(() => readGltfTriangles(new TextEncoder().encode("[]").buffer)).toThrow("not a JSON object");
  });
});
