/**
 * Builds tiny glTF files for the light-probe bake's tests: one triangle per mesh, laid out the way
 * an exporter writes them.
 */

/** One mesh of a test file. */
export interface TestGltfMesh {
  /** Nine floats: one triangle. */
  readonly positions: readonly number[];
  /** The node's translation. */
  readonly translation?: readonly [number, number, number];
  /** The node's uniform scale. */
  readonly scale?: number;
  /** The material's base colour factor, or none for no material. */
  readonly baseColor?: readonly [number, number, number, number];
  /** The material's metallic factor. */
  readonly metallic?: number;
  /** The material's name. */
  readonly name?: string;
  /** Marks the primitive Draco-compressed. */
  readonly draco?: boolean;
}

/**
 * The glTF JSON and binary for some meshes, each a child of one parent node.
 *
 * @param meshes - The meshes.
 * @param parentTranslation - The parent node's translation.
 * @returns The JSON document (buffer 0 without a URI) and the binary buffer.
 */
function documentFor(
  meshes: readonly TestGltfMesh[],
  parentTranslation: readonly [number, number, number],
): { json: Record<string, unknown>; bin: Uint8Array } {
  const floats: number[] = [];
  const accessors: unknown[] = [];
  const views: unknown[] = [];
  const materials: unknown[] = [];
  const gltfMeshes: unknown[] = [];
  const children: number[] = [];
  const nodes: Record<string, unknown>[] = [{ translation: [...parentTranslation], children }];
  for (const [index, mesh] of meshes.entries()) {
    views.push({ buffer: 0, byteOffset: floats.length * 4, byteLength: 36 });
    floats.push(...mesh.positions);
    accessors.push({ bufferView: index, componentType: 5126, count: 3, type: "VEC3" });
    const primitive: Record<string, unknown> = { attributes: { POSITION: index } };
    if (mesh.baseColor !== undefined) {
      primitive["material"] = materials.length;
      materials.push({
        ...(mesh.name === undefined ? {} : { name: mesh.name }),
        pbrMetallicRoughness: { baseColorFactor: [...mesh.baseColor], metallicFactor: mesh.metallic ?? 0 },
      });
    }
    if (mesh.draco === true) {
      primitive["extensions"] = { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } };
    }
    gltfMeshes.push({ primitives: [primitive] });
    nodes.push({
      mesh: index,
      ...(mesh.translation === undefined ? {} : { translation: [...mesh.translation] }),
      ...(mesh.scale === undefined ? {} : { scale: [mesh.scale, mesh.scale, mesh.scale] }),
    });
    children.push(index + 1);
  }
  const bin = new Uint8Array(Float32Array.from(floats).buffer);
  return {
    json: {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes,
      meshes: gltfMeshes,
      accessors,
      bufferViews: views,
      buffers: [{ byteLength: bin.byteLength }],
      materials,
    },
    bin,
  };
}

/**
 * A `.glb` holding the meshes.
 *
 * @param meshes - The meshes.
 * @param parentTranslation - The parent node's translation.
 * @returns The file.
 */
export function glbOf(
  meshes: readonly TestGltfMesh[],
  parentTranslation: readonly [number, number, number] = [0, 0, 0],
): ArrayBuffer {
  const { json, bin } = documentFor(meshes, parentTranslation);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46_54_6c_67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e_4f_53_4a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x00_4e_49_42, true);
  out.set(bin, 28 + jsonLength);
  return out.buffer;
}

/**
 * A `.gltf` holding the meshes, its buffer embedded as a `data:` URI (or at `uri`).
 *
 * @param meshes - The meshes.
 * @param uri - A URI to name instead of embedding the buffer.
 * @returns The file.
 */
export function gltfOf(meshes: readonly TestGltfMesh[], uri?: string): ArrayBuffer {
  const { json, bin } = documentFor(meshes, [0, 0, 0]);
  let binary = "";
  for (const byte of bin) {
    binary += String.fromCodePoint(byte);
  }
  json["buffers"] = [
    { byteLength: bin.byteLength, uri: uri ?? `data:application/octet-stream;base64,${btoa(binary)}` },
  ];
  return new TextEncoder().encode(JSON.stringify(json)).buffer;
}
