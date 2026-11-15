/**
 * A minimal glTF 2.0 reader for the light-probe bake (`docs/architecture/07-rendering.md` §2.15):
 * the triangles of every mesh the default scene places, in the model's own space, with each
 * primitive's flat base colour. No device, no Lite.
 *
 * - **Containers.** A `.glb` (its JSON and BIN chunks) or a `.gltf` whose buffers are embedded as
 *   `data:` URIs. A buffer at any other URI cannot be read from the bytes alone, so its primitives
 *   are skipped with a reason.
 * - **Geometry.** `POSITION` (float, or the integer types `KHR_mesh_quantization` allows) and the
 *   indices (or none) of every primitive drawn as triangles, strips or fans; points and lines draw no
 *   surface. Node transforms (matrix or TRS) are composed down the default scene, and then X is
 *   mirrored, as Babylon Lite 1.34.0's loader does with its `__root__` node (scale `(-1, 1, 1)`,
 *   `lib/loader-gltf/load-gltf.js`), so the triangles land where the model draws. Skinned meshes
 *   are read in their bind pose and morph targets are ignored.
 * - **Compression.** `KHR_draco_mesh_compression` primitives and `EXT_meshopt_compression` buffer
 *   views need Lite's decoders; they are skipped with a reason. Sparse accessors are skipped too.
 * - **Colour.** `pbrMetallicRoughness.baseColorFactor` (linear) times `1 − metallicFactor` when no
 *   metallic-roughness texture overrides the factor; textures are not sampled.
 */

/** `glTF` in ASCII, little-endian: a `.glb`'s magic. */
const GLB_MAGIC = 0x46_54_6c_67;

/** `JSON` in ASCII, little-endian: the type of a `.glb`'s first chunk. */
const GLB_JSON_CHUNK = 0x4e_4f_53_4a;

/** `BIN\0` in ASCII, little-endian: the type of a `.glb`'s binary chunk. */
const GLB_BIN_CHUNK = 0x00_4e_49_42;

/** Primitive modes the bake can turn into triangles. */
const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

/** Bytes per component, by glTF `componentType`. */
const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Components per element, by glTF accessor `type`. */
const TYPE_COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** One glTF primitive's triangles in the model's space. */
export interface GltfBakePrimitive {
  /** Three floats per vertex, already moved by the node transforms and the X mirror. */
  readonly positions: Float32Array;
  /** Three indices per triangle. */
  readonly indices: Uint32Array;
  /** The flat linear albedo of its material. */
  readonly albedo: readonly [number, number, number];
  /** Its material's name, which a `Model`'s `materialOverrides` key on, or `null`. */
  readonly materialName: string | null;
}

/** What the reader found in one file. */
export interface GltfBakeGeometry {
  /** Every primitive it could read. */
  readonly primitives: readonly GltfBakePrimitive[];
  /** Why each other primitive was left out, one line each. */
  readonly skipped: readonly string[];
}

/** The parts of a glTF document the reader looks at; everything is optional and checked on use. */
interface GltfJson {
  readonly scene?: number;
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly nodes?: readonly GltfNode[];
  readonly meshes?: readonly { readonly primitives?: readonly GltfPrimitive[] }[];
  readonly accessors?: readonly GltfAccessor[];
  readonly bufferViews?: readonly GltfBufferView[];
  readonly buffers?: readonly { readonly uri?: string; readonly byteLength?: number }[];
  readonly materials?: readonly GltfMaterial[];
}

interface GltfNode {
  readonly mesh?: number;
  readonly children?: readonly number[];
  readonly matrix?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
}

interface GltfPrimitive {
  readonly attributes?: Readonly<Record<string, number>>;
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

interface GltfAccessor {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType?: number;
  readonly normalized?: boolean;
  readonly count?: number;
  readonly type?: string;
  readonly sparse?: unknown;
}

interface GltfBufferView {
  readonly buffer?: number;
  readonly byteOffset?: number;
  readonly byteLength?: number;
  readonly byteStride?: number;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

interface GltfMaterial {
  readonly name?: string;
  readonly pbrMetallicRoughness?: {
    readonly baseColorFactor?: readonly number[];
    readonly metallicFactor?: number;
    readonly metallicRoughnessTexture?: unknown;
  };
}

/** A failure to read one primitive, carried as a reason rather than thrown to the caller. */
class SkipPrimitive extends Error {}

/**
 * Reads the triangles of a `.glb` or self-contained `.gltf`.
 *
 * @param bytes - The file.
 * @returns The primitives and the reasons for those left out.
 * @throws Error when the bytes are not a glTF document at all; the bake reports it as the model's
 * skip reason.
 *
 * @internal
 */
export function readGltfTriangles(bytes: ArrayBuffer): GltfBakeGeometry {
  const { json, bin } = splitContainer(bytes);
  const buffers = (json.buffers ?? []).map((buffer, index) => resolveBuffer(buffer.uri, index, bin));
  const primitives: GltfBakePrimitive[] = [];
  const skipped: string[] = [];
  const mirror = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const visit = (nodeIndex: number, parent: readonly number[], depth: number): void => {
    const node = json.nodes?.[nodeIndex];
    if (node === undefined || depth > 256) {
      return;
    }
    const world = multiply(parent, localMatrix(node));
    const mesh = node.mesh === undefined ? undefined : json.meshes?.[node.mesh];
    for (const [index, primitive] of (mesh?.primitives ?? []).entries()) {
      try {
        const read = readPrimitive(json, buffers, primitive, world);
        if (read !== null) {
          primitives.push(read);
        }
      } catch (error) {
        const reason = error instanceof SkipPrimitive ? error.message : String(error);
        skipped.push(`mesh ${String(node.mesh)} primitive ${String(index)}: ${reason}`);
      }
    }
    for (const child of node.children ?? []) {
      visit(child, world, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, mirror, 0);
  }
  return { primitives, skipped };
}

/**
 * Splits a `.glb` into its JSON and BIN chunks, or parses a `.gltf`.
 *
 * @param bytes - The file.
 * @returns The document and the binary chunk, if any.
 * @throws Error for anything else.
 */
function splitContainer(bytes: ArrayBuffer): { json: GltfJson; bin: Uint8Array | null } {
  const view = new DataView(bytes);
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    const jsonLength = view.getUint32(12, true);
    if (view.getUint32(16, true) !== GLB_JSON_CHUNK || 20 + jsonLength > bytes.byteLength) {
      throw new Error("the .glb has no JSON chunk");
    }
    const json = parseJson(new Uint8Array(bytes, 20, jsonLength));
    let bin: Uint8Array | null = null;
    const binStart = 20 + jsonLength;
    if (binStart + 8 <= bytes.byteLength && view.getUint32(binStart + 4, true) === GLB_BIN_CHUNK) {
      const binLength = Math.min(view.getUint32(binStart, true), bytes.byteLength - binStart - 8);
      bin = new Uint8Array(bytes, binStart + 8, binLength);
    }
    return { json, bin };
  }
  return { json: parseJson(new Uint8Array(bytes)), bin: null };
}

/**
 * Parses a glTF JSON document.
 *
 * @param text - Its UTF-8 bytes.
 * @returns The document.
 * @throws Error when it is not a JSON object.
 */
function parseJson(text: Uint8Array): GltfJson {
  const value: unknown = JSON.parse(new TextDecoder().decode(text));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the glTF document is not a JSON object");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is optional and checked where it is read.
  return value as GltfJson;
}

/**
 * The bytes of one buffer, or why there are none.
 *
 * @param uri - The buffer's URI, or `undefined` for the `.glb` chunk.
 * @param index - The buffer's index.
 * @param bin - The `.glb`'s binary chunk.
 * @returns The bytes, or the reason as a string.
 */
function resolveBuffer(uri: string | undefined, index: number, bin: Uint8Array | null): Uint8Array | string {
  if (uri === undefined) {
    return index === 0 && bin !== null ? bin : `buffer ${String(index)} has no data`;
  }
  const comma = uri.indexOf(",");
  if (uri.startsWith("data:") && comma > 0 && uri.slice(0, comma).endsWith(";base64")) {
    const text = atob(uri.slice(comma + 1));
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      out[i] = text.charCodeAt(i);
    }
    return out;
  }
  return `buffer ${String(index)} is a separate file (${uri.slice(0, 80)}), which the bake cannot read`;
}

/**
 * Reads one primitive into model space.
 *
 * @param json - The document.
 * @param buffers - The resolved buffers.
 * @param primitive - The primitive.
 * @param world - Its node's transform, mirror included.
 * @returns The triangles, or `null` for points and lines.
 * @throws SkipPrimitive with the reason it cannot be read.
 */
function readPrimitive(
  json: GltfJson,
  buffers: readonly (Uint8Array | string)[],
  primitive: GltfPrimitive,
  world: readonly number[],
): GltfBakePrimitive | null {
  if (primitive.extensions?.["KHR_draco_mesh_compression"] !== undefined) {
    throw new SkipPrimitive("Draco-compressed (KHR_draco_mesh_compression)");
  }
  const mode = primitive.mode ?? MODE_TRIANGLES;
  if (mode !== MODE_TRIANGLES && mode !== MODE_TRIANGLE_STRIP && mode !== MODE_TRIANGLE_FAN) {
    return null;
  }
  const positionIndex = primitive.attributes?.["POSITION"];
  if (positionIndex === undefined) {
    throw new SkipPrimitive("no POSITION attribute");
  }
  const local = readAccessor(json, buffers, positionIndex, 3);
  const vertexCount = local.length / 3;
  const positions = new Float32Array(local.length);
  for (let v = 0; v < vertexCount; v += 1) {
    const x = local[v * 3] ?? 0;
    const y = local[v * 3 + 1] ?? 0;
    const z = local[v * 3 + 2] ?? 0;
    positions[v * 3] = at(world, 0) * x + at(world, 4) * y + at(world, 8) * z + at(world, 12);
    positions[v * 3 + 1] = at(world, 1) * x + at(world, 5) * y + at(world, 9) * z + at(world, 13);
    positions[v * 3 + 2] = at(world, 2) * x + at(world, 6) * y + at(world, 10) * z + at(world, 14);
  }
  const raw =
    primitive.indices === undefined
      ? Uint32Array.from({ length: vertexCount }, (_, index) => index)
      : Uint32Array.from(readAccessor(json, buffers, primitive.indices, 1));
  for (const index of raw) {
    if (index >= vertexCount) {
      throw new SkipPrimitive("an index past the last vertex");
    }
  }
  const material = primitive.material === undefined ? undefined : json.materials?.[primitive.material];
  return {
    positions,
    indices: toTriangleList(raw, mode),
    albedo: materialAlbedo(material),
    materialName: material?.name ?? null,
  };
}

/**
 * Reads an accessor's elements as plain numbers, normalised when it says so.
 *
 * @param json - The document.
 * @param buffers - The resolved buffers.
 * @param index - The accessor's index.
 * @param components - The components per element the caller needs.
 * @returns `count × components` numbers.
 * @throws SkipPrimitive when it cannot be read.
 */
function readAccessor(
  json: GltfJson,
  buffers: readonly (Uint8Array | string)[],
  index: number,
  components: number,
): Float64Array {
  const accessor = json.accessors?.[index];
  if (accessor === undefined) {
    throw new SkipPrimitive(`accessor ${String(index)} does not exist`);
  }
  if (accessor.sparse !== undefined) {
    throw new SkipPrimitive("a sparse accessor");
  }
  const width = TYPE_COMPONENTS[accessor.type ?? ""];
  const size = COMPONENT_BYTES[accessor.componentType ?? 0];
  const count = accessor.count ?? 0;
  if (width !== components || size === undefined || !Number.isSafeInteger(count) || count < 0) {
    throw new SkipPrimitive(`accessor ${String(index)} is not a ${String(components)}-component number array`);
  }
  const view = accessor.bufferView === undefined ? undefined : json.bufferViews?.[accessor.bufferView];
  if (view === undefined) {
    throw new SkipPrimitive(`accessor ${String(index)} has no buffer view`);
  }
  if (view.extensions?.["EXT_meshopt_compression"] !== undefined) {
    throw new SkipPrimitive("meshopt-compressed (EXT_meshopt_compression)");
  }
  const buffer = buffers[view.buffer ?? 0];
  if (buffer === undefined || typeof buffer === "string") {
    throw new SkipPrimitive(buffer ?? `buffer ${String(view.buffer)} does not exist`);
  }
  const stride = view.byteStride ?? size * width;
  const start = buffer.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = count === 0 ? start : start + stride * (count - 1) + size * width;
  if (end > buffer.byteOffset + buffer.byteLength) {
    throw new SkipPrimitive(`accessor ${String(index)} runs past its buffer`);
  }
  const data = new DataView(buffer.buffer, 0, buffer.byteOffset + buffer.byteLength);
  const out = new Float64Array(count * width);
  const type = accessor.componentType ?? 0;
  const normalized = accessor.normalized === true;
  for (let element = 0; element < count; element += 1) {
    for (let c = 0; c < width; c += 1) {
      out[element * width + c] = readComponent(data, start + element * stride + c * size, type, normalized);
    }
  }
  return out;
}

/**
 * Reads one component.
 *
 * @param data - The buffer.
 * @param offset - Its byte offset.
 * @param type - The glTF component type.
 * @param normalized - Whether an integer maps to `[-1, 1]` or `[0, 1]`.
 * @returns The number.
 */
function readComponent(data: DataView, offset: number, type: number, normalized: boolean): number {
  switch (type) {
    case 5120:
      return normalized ? Math.max(data.getInt8(offset) / 127, -1) : data.getInt8(offset);
    case 5121:
      return normalized ? data.getUint8(offset) / 255 : data.getUint8(offset);
    case 5122:
      return normalized ? Math.max(data.getInt16(offset, true) / 32_767, -1) : data.getInt16(offset, true);
    case 5123:
      return normalized ? data.getUint16(offset, true) / 65_535 : data.getUint16(offset, true);
    case 5125:
      return data.getUint32(offset, true);
    default:
      return data.getFloat32(offset, true);
  }
}

/**
 * Turns strip or fan indices into a triangle list.
 *
 * @param indices - The primitive's indices.
 * @param mode - Its mode.
 * @returns Three indices per triangle.
 */
function toTriangleList(indices: Uint32Array, mode: number): Uint32Array {
  if (mode === MODE_TRIANGLES) {
    return indices.length % 3 === 0 ? indices : indices.slice(0, indices.length - (indices.length % 3));
  }
  const out: number[] = [];
  for (let i = 2; i < indices.length; i += 1) {
    const a = indices[i - 2] ?? 0;
    const b = indices[i - 1] ?? 0;
    const c = indices[i] ?? 0;
    if (mode === MODE_TRIANGLE_FAN) {
      out.push(indices[0] ?? 0, b, c);
    } else if (i % 2 === 0) {
      out.push(a, b, c);
    } else {
      out.push(b, a, c);
    }
  }
  return Uint32Array.from(out);
}

/**
 * A material's flat diffuse colour.
 *
 * @param material - The material, or `undefined` for glTF's default (white, metallic 1 — which
 * the bake reads as white, since an untextured default material is meant as plain white).
 * @returns Linear RGB.
 */
function materialAlbedo(material: GltfMaterial | undefined): [number, number, number] {
  const pbr = material?.pbrMetallicRoughness;
  if (material === undefined) {
    return [1, 1, 1];
  }
  const base = pbr?.baseColorFactor ?? [1, 1, 1, 1];
  const metallic = pbr?.metallicRoughnessTexture === undefined ? clamp01(pbr?.metallicFactor ?? 1) : 0;
  const keep = 1 - metallic;
  return [clamp01(base[0] ?? 1) * keep, clamp01(base[1] ?? 1) * keep, clamp01(base[2] ?? 1) * keep];
}

/**
 * Clamps a number to `[0, 1]`, `NaN` to 0.
 *
 * @param value - The number.
 * @returns It, clamped.
 */
function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * A node's local transform, column-major.
 *
 * @param node - The node.
 * @returns Sixteen numbers.
 */
function localMatrix(node: GltfNode): number[] {
  if (node.matrix?.length === 16) {
    return [...node.matrix];
  }
  const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
  const [qx = 0, qy = 0, qz = 0, qw = 1] = node.rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];
  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/**
 * Multiplies two column-major 4×4 matrices: `a · b`.
 *
 * @param a - The parent.
 * @param b - The child.
 * @returns The product.
 */
function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = Array.from({ length: 16 }, () => 0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += at(a, k * 4 + row) * at(b, column * 4 + k);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * Reads one number of an array, `0` past its end.
 *
 * @param values - The array.
 * @param index - The index.
 * @returns The number.
 */
function at(values: ArrayLike<number>, index: number): number {
  return values[index] ?? 0;
}
