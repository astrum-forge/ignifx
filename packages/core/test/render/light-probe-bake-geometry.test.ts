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
    const inline = readGltfTriangles(gltfOf([{ positions: triangle }]));
    expect(inline.primitives).toHaveLength(1);
    expect([...(inline.primitives[0]?.positions ?? [])]).toEqual([0, 0, 0, -1, 0, 0, 0, 1, 0]);

    const external = readGltfTriangles(gltfOf([{ positions: triangle }], "model.bin"));
    expect(external.primitives).toHaveLength(0);
    expect(external.skipped[0]).toContain("separate file");

    const draco = readGltfTriangles(glbOf([{ positions: triangle, draco: true }, { positions: triangle }]));
    expect(draco.primitives).toHaveLength(1);
    expect(draco.skipped).toEqual(["mesh 0 primitive 0: Draco-compressed (KHR_draco_mesh_compression)"]);

    expect(() => readGltfTriangles(new TextEncoder().encode("[]").buffer)).toThrow("not a JSON object");
  });
});

/**
 * A `.gltf` from a document and the bytes of its one embedded buffer.
 *
 * @param json - Everything but `buffers`.
 * @param bin - The buffer.
 * @returns The file.
 */
function embedded(json: Record<string, unknown>, bin: Uint8Array): ArrayBuffer {
  let binary = "";
  for (const byte of bin) {
    binary += String.fromCodePoint(byte);
  }
  const buffers = [{ byteLength: bin.byteLength, uri: `data:application/octet-stream;base64,${btoa(binary)}` }];
  return new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, ...json, buffers })).buffer;
}

/**
 * A one-node document drawing one primitive.
 *
 * @param primitive - The primitive.
 * @param extra - More top-level fields.
 * @returns The document without buffers.
 */
function oneNode(primitive: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [primitive] }], ...extra };
}

describe("readGltfTriangles, the accessor and primitive rules", () => {
  // Four vertices as floats (48 bytes), then indices as u8, u16, u32.
  const quad = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const bin = new Uint8Array(48 + 4 + 8 + 16);
  bin.set(new Uint8Array(quad.buffer), 0);
  bin.set([0, 1, 2, 3], 48);
  new DataView(bin.buffer).setUint16(52, 0, true);
  new DataView(bin.buffer).setUint16(54, 1, true);
  new DataView(bin.buffer).setUint16(56, 2, true);
  new DataView(bin.buffer).setUint16(58, 3, true);
  for (let i = 0; i < 4; i += 1) {
    new DataView(bin.buffer).setUint32(60 + i * 4, i, true);
  }
  const views = [
    { buffer: 0, byteOffset: 0, byteLength: 48 },
    { buffer: 0, byteOffset: 48, byteLength: 4 },
    { buffer: 0, byteOffset: 52, byteLength: 8 },
    { buffer: 0, byteOffset: 60, byteLength: 16 },
  ];
  const accessors = [
    { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
    { bufferView: 1, componentType: 5121, count: 4, type: "SCALAR" },
    { bufferView: 2, componentType: 5123, count: 4, type: "SCALAR" },
    { bufferView: 3, componentType: 5125, count: 4, type: "SCALAR" },
  ];
  const base = { accessors, bufferViews: views };

  it.each([
    [5, 1, [0, 1, 2, 2, 1, 3]],
    [6, 2, [0, 1, 2, 0, 2, 3]],
    [4, 3, [0, 1, 2]],
  ])("turns mode %i with index accessor %i into a triangle list", (mode, indices, expected) => {
    const geometry = readGltfTriangles(embedded(oneNode({ attributes: { POSITION: 0 }, indices, mode }, base), bin));
    expect([...(geometry.primitives[0]?.indices ?? [])]).toEqual(expected);
  });

  it("draws nothing for points and lines, and reads node matrices and rotations", () => {
    const points = readGltfTriangles(embedded(oneNode({ attributes: { POSITION: 0 }, mode: 0 }, base), bin));
    expect(points).toEqual({ primitives: [], skipped: [] });
    const moved = readGltfTriangles(
      embedded(
        {
          ...base,
          scenes: [{ nodes: [0, 1] }],
          nodes: [
            { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] },
            // A half turn about Y: (x, y, z) → (−x, y, −z), then the mirror: (x, y, −z).
            { mesh: 0, rotation: [0, 1, 0, 0] },
          ],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 3 }] }],
        },
        bin,
      ),
    );
    expect(moved.primitives[0]?.positions[3]).toBeCloseTo(-6, 6);
    expect(moved.primitives[1]?.positions[3]).toBeCloseTo(1, 6);
    expect(moved.primitives[1]?.positions[5]).toBeCloseTo(0, 6);
  });

  it.each<[number, boolean, number[], number[]]>([
    [5120, true, [127, -128, 0], [-1, -1, 0]],
    [5121, true, [255, 0, 51], [-1, 0, 0.2]],
    [5122, true, [32_767, -32_768, 0], [-1, -1, 0]],
    [5123, true, [65_535, 0, 0], [-1, 0, 0]],
    [5120, false, [-3, 2, 1], [3, 2, 1]],
    [5121, false, [3, 2, 1], [-3, 2, 1]],
    [5122, false, [-300, 2, 1], [300, 2, 1]],
    [5123, false, [300, 2, 1], [-300, 2, 1]],
    [5125, false, [7, 2, 1], [-7, 2, 1]],
  ])("reads component type %i (normalised: %s) positions", (componentType, normalized, values, expected) => {
    const bytes = new Uint8Array(12);
    const view = new DataView(bytes.buffer);
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4 }[componentType] ?? 4;
    for (const [index, value] of values.entries()) {
      const offset = index * size;
      if (componentType === 5120) view.setInt8(offset, value);
      else if (componentType === 5121) view.setUint8(offset, value);
      else if (componentType === 5122) view.setInt16(offset, value, true);
      else if (componentType === 5123) view.setUint16(offset, value, true);
      else view.setUint32(offset, value, true);
    }
    const json = oneNode(
      { attributes: { POSITION: 0 } },
      {
        accessors: [{ bufferView: 0, componentType, normalized, count: 1, type: "VEC3" }],
        bufferViews: [{ buffer: 0, byteLength: 12 }],
      },
    );
    const positions = [...(readGltfTriangles(embedded(json, bytes)).primitives[0]?.positions ?? [])];
    expect(positions.map((value) => Math.round(value * 1e4) / 1e4 + 0)).toEqual(expected);
  });

  it.each<[string, Record<string, unknown>, Record<string, unknown>, string]>([
    ["no POSITION", { attributes: {} }, base, "no POSITION"],
    ["a missing accessor", { attributes: { POSITION: 9 } }, base, "does not exist"],
    [
      "a sparse accessor",
      { attributes: { POSITION: 0 } },
      { ...base, accessors: [{ ...accessors[0], sparse: {} }] },
      "sparse",
    ],
    ["the wrong accessor type", { attributes: { POSITION: 1 } }, base, "3-component"],
    [
      "no buffer view",
      { attributes: { POSITION: 0 } },
      { ...base, accessors: [{ componentType: 5126, count: 4, type: "VEC3" }] },
      "no buffer view",
    ],
    [
      "meshopt",
      { attributes: { POSITION: 0 } },
      { ...base, bufferViews: [{ ...views[0], extensions: { EXT_meshopt_compression: {} } }] },
      "meshopt",
    ],
    [
      "a missing buffer",
      { attributes: { POSITION: 0 } },
      { ...base, bufferViews: [{ ...views[0], buffer: 4 }] },
      "buffer 4 does not exist",
    ],
    [
      "an accessor past its buffer",
      { attributes: { POSITION: 0 } },
      { ...base, accessors: [{ ...accessors[0], count: 400 }] },
      "runs past",
    ],
    [
      "an index past the last vertex",
      { attributes: { POSITION: 0 }, indices: 1 },
      { ...base, accessors: [{ ...accessors[0], count: 2 }, accessors[1]] },
      "past the last vertex",
    ],
  ])("skips a primitive with %s", (_name, primitive, extra, reason) => {
    const geometry = readGltfTriangles(embedded(oneNode(primitive, extra), bin));
    expect(geometry.primitives).toHaveLength(0);
    expect(geometry.skipped[0]).toContain(reason);
  });

  it("reads materials, and survives documents with nothing to draw", () => {
    const textured = readGltfTriangles(
      embedded(
        oneNode(
          { attributes: { POSITION: 0 }, material: 0 },
          {
            ...base,
            materials: [{ pbrMetallicRoughness: { baseColorFactor: [2, -1, 0.5, 1], metallicRoughnessTexture: {} } }],
          },
        ),
        bin,
      ),
    );
    expect(textured.primitives[0]?.albedo).toEqual([1, 0, 0.5]);
    const plain = readGltfTriangles(
      embedded(oneNode({ attributes: { POSITION: 0 }, material: 0 }, { ...base, materials: [{}] }), bin),
    );
    expect(plain.primitives[0]?.albedo).toEqual([0, 0, 0]);
    expect(readGltfTriangles(embedded({ ...base, nodes: [{ mesh: 0 }] }, bin))).toEqual({
      primitives: [],
      skipped: [],
    });
    expect(readGltfTriangles(embedded({ ...base, scenes: [{ nodes: [3] }], nodes: [] }, bin)).primitives).toHaveLength(
      0,
    );
    const noBuffer = new TextEncoder().encode(
      JSON.stringify({ ...oneNode({ attributes: { POSITION: 0 } }, base), buffers: [{}] }),
    );
    expect(readGltfTriangles(noBuffer.buffer).skipped[0]).toContain("no data");
    const truncated = new Uint8Array(20);
    new DataView(truncated.buffer).setUint32(0, 0x46_54_6c_67, true);
    new DataView(truncated.buffer).setUint32(12, 400, true);
    expect(() => readGltfTriangles(truncated.buffer)).toThrow("no JSON chunk");
  });
});
