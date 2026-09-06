// @ts-check
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import process from "node:process";
import { TextEncoder } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates `rig.glb`: an original, deliberately tiny skinned "box-man" with four animation clips,
 * used by `@ignifx/3d`'s browser suite and by the 3D templates.
 *
 * Everything here is written from scratch — no third-party model, no exporter — so the fixture is
 * Apache-2.0 like the rest of the repository and small enough to read. The rig is four joints
 * (`hips`, `torso`, `armL`, `armR`), one skinned mesh of three boxes, and a `hand` node with no
 * geometry that `Model.attachToNode` can parent a weapon to.
 *
 * Run it with `node tests/fixtures/assets/3d/make-rig.mjs`.
 */

/** The joints, in the order the skin lists them. A vertex names a joint by this index. */
const JOINTS = ["hips", "torso", "armL", "armR"];

/** The animation clips the file declares, each with its length in seconds. */
const CLIPS = [
  { name: "idle", duration: 1, amplitude: 4, frequency: 1 },
  { name: "walk", duration: 0.8, amplitude: 25, frequency: 1 },
  { name: "run", duration: 0.5, amplitude: 55, frequency: 1 },
  { name: "jump", duration: 0.6, amplitude: 70, frequency: 0.5 },
];

/** How many keyframes each clip samples. */
const KEYFRAMES = 9;

/** Degrees to radians. */
const DEG = Math.PI / 180;

/**
 * The eight corners of a unit cube, and the twelve triangles over them.
 * @returns The shared box topology.
 */
function boxTopology() {
  return {
    corners: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    triangles: [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 4, 7],
      [0, 7, 3],
      [1, 2, 6],
      [1, 6, 5],
      [3, 7, 6],
      [3, 6, 2],
      [0, 1, 5],
      [0, 5, 4],
    ],
  };
}

/**
 * Appends one box to the geometry buffers, every vertex bound to one joint.
 * @param out - The buffers.
 * @param center - The box's centre, in model space.
 * @param half - Half its size on each axis.
 * @param joint - The joint index every vertex is bound to.
 */
function addBox(out, center, half, joint) {
  const { corners, triangles } = boxTopology();
  const base = out.positions.length / 3;
  for (const [sx, sy, sz] of corners) {
    out.positions.push(center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2]);
    const length = Math.hypot(sx, sy, sz);
    out.normals.push(sx / length, sy / length, sz / length);
    out.joints.push(joint, 0, 0, 0);
    out.weights.push(1, 0, 0, 0);
  }
  for (const [a, b, c] of triangles) {
    out.indices.push(base + a, base + b, base + c);
  }
}

/**
 * Builds the skinned mesh: a torso and two arms, twenty-four vertices each.
 * @returns The interleaved-by-attribute geometry.
 */
function buildGeometry() {
  const out = { positions: [], normals: [], joints: [], weights: [], indices: [] };
  // Torso, bound to `torso` (joint 1).
  addBox(out, [0, 1.1, 0], [0.25, 0.35, 0.15], 1);
  // Hips, bound to `hips` (joint 0), so the root joint animates something visible.
  addBox(out, [0, 0.55, 0], [0.22, 0.2, 0.14], 0);
  // Arms, bound to `armL` (2) and `armR` (3).
  addBox(out, [-0.4, 1.05, 0], [0.1, 0.32, 0.1], 2);
  addBox(out, [0.4, 1.05, 0], [0.1, 0.32, 0.1], 3);
  return out;
}

/**
 * A quaternion from an axis-angle rotation.
 * @param axis - The unit axis.
 * @param degrees - The angle.
 * @returns The quaternion, `xyzw`.
 */
function quaternion(axis, degrees) {
  const half = degrees * DEG * 0.5;
  const sine = Math.sin(half);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
}

/**
 * Samples one clip's rotation track for one joint.
 * @param clip - The clip.
 * @param phase - A phase offset in turns, so the two arms swing in opposition.
 * @param axis - The axis to swing around.
 * @returns The sampler's input and output.
 */
function sampleTrack(clip, phase, axis) {
  const times = [];
  const values = [];
  for (let index = 0; index < KEYFRAMES; index += 1) {
    const t = (index / (KEYFRAMES - 1)) * clip.duration;
    times.push(t);
    const turns = (index / (KEYFRAMES - 1)) * clip.frequency + phase;
    const angle = Math.sin(turns * Math.PI * 2) * clip.amplitude;
    values.push(...quaternion(axis, angle));
  }
  return { times, values };
}

/** Accumulates typed arrays into one glTF binary buffer, four-byte aligned. */
class BufferBuilder {
  /** The chunks written so far. */
  #chunks = [];

  /** How many bytes have been written. */
  #length = 0;

  /** The buffer views, in the order glTF will list them. */
  views = [];

  /**
   * Appends a typed array and returns the index of the buffer view over it.
   * @param data - The array to append.
   * @param [target] - The glTF buffer target, when the view is vertex or index data.
   * @returns The buffer-view index.
   */
  add(data, target) {
    const padding = (4 - (this.#length % 4)) % 4;
    if (padding > 0) {
      this.#chunks.push(new Uint8Array(padding));
      this.#length += padding;
    }
    const view = {
      buffer: 0,
      byteOffset: this.#length,
      byteLength: data.byteLength,
      ...(target === undefined ? {} : { target }),
    };
    this.views.push(view);
    this.#chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    this.#length += data.byteLength;
    return this.views.length - 1;
  }

  /**
   * The finished binary chunk, padded to a four-byte boundary.
   * @returns The bytes.
   */
  build() {
    const padded = this.#length + ((4 - (this.#length % 4)) % 4);
    const out = new Uint8Array(padded);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

/**
 * The smallest and largest value of each component, which glTF requires on a POSITION accessor.
 * @param values - The flat component array.
 * @param stride - How many components one element has.
 * @returns The bounds.
 */
function bounds(values, stride) {
  const min = Array.from({ length: stride }, () => Number.POSITIVE_INFINITY);
  const max = Array.from({ length: stride }, () => Number.NEGATIVE_INFINITY);
  for (let index = 0; index < values.length; index += stride) {
    for (let component = 0; component < stride; component += 1) {
      const value = values[index + component];
      min[component] = Math.min(min[component], value);
      max[component] = Math.max(max[component], value);
    }
  }
  return { min, max };
}

/**
 * Builds the whole glTF document and its binary buffer.
 * @returns The document and the bytes it points into.
 */
function buildDocument() {
  const geometry = buildGeometry();
  const builder = new BufferBuilder();
  const accessors = [];

  const positions = new Float32Array(geometry.positions);
  const positionBounds = bounds(geometry.positions, 3);
  accessors.push({
    bufferView: builder.add(positions, 34_962),
    componentType: 5126,
    count: positions.length / 3,
    type: "VEC3",
    min: positionBounds.min,
    max: positionBounds.max,
  });
  accessors.push({
    bufferView: builder.add(new Float32Array(geometry.normals), 34_962),
    componentType: 5126,
    count: geometry.normals.length / 3,
    type: "VEC3",
  });
  accessors.push({
    bufferView: builder.add(new Uint8Array(geometry.joints), 34_962),
    componentType: 5121,
    count: geometry.joints.length / 4,
    type: "VEC4",
  });
  accessors.push({
    bufferView: builder.add(new Float32Array(geometry.weights), 34_962),
    componentType: 5126,
    count: geometry.weights.length / 4,
    type: "VEC4",
  });
  accessors.push({
    bufferView: builder.add(new Uint16Array(geometry.indices), 34_963),
    componentType: 5123,
    count: geometry.indices.length,
    type: "SCALAR",
  });

  // The joints sit at the origin of their own bind pose, so every inverse bind matrix is the
  // inverse of that joint's world translation — an identity with a negated offset.
  const bindOffsets = [
    [0, 0.55, 0],
    [0, 1.1, 0],
    [-0.4, 1.05, 0],
    [0.4, 1.05, 0],
  ];
  const inverseBind = new Float32Array(JOINTS.length * 16);
  for (let joint = 0; joint < JOINTS.length; joint += 1) {
    const base = joint * 16;
    inverseBind[base] = 1;
    inverseBind[base + 5] = 1;
    inverseBind[base + 10] = 1;
    inverseBind[base + 15] = 1;
    inverseBind[base + 12] = -bindOffsets[joint][0];
    inverseBind[base + 13] = -bindOffsets[joint][1];
    inverseBind[base + 14] = -bindOffsets[joint][2];
  }
  const inverseBindAccessor = accessors.length;
  accessors.push({
    bufferView: builder.add(inverseBind),
    componentType: 5126,
    count: JOINTS.length,
    type: "MAT4",
  });

  const animations = [];
  for (const clip of CLIPS) {
    const samplers = [];
    const channels = [];
    // Node indices: 0 root, 1 hips, 2 torso, 3 armL, 4 armR, 5 hand, 6 mesh.
    const tracks = [
      { node: 1, phase: 0, axis: [1, 0, 0] },
      { node: 3, phase: 0, axis: [1, 0, 0] },
      { node: 4, phase: 0.5, axis: [1, 0, 0] },
    ];
    for (const track of tracks) {
      const { times, values } = sampleTrack(clip, track.phase, track.axis);
      const input = accessors.length;
      accessors.push({
        bufferView: builder.add(new Float32Array(times)),
        componentType: 5126,
        count: times.length,
        type: "SCALAR",
        min: [times[0]],
        max: [times[times.length - 1]],
      });
      const output = accessors.length;
      accessors.push({
        bufferView: builder.add(new Float32Array(values)),
        componentType: 5126,
        count: values.length / 4,
        type: "VEC4",
      });
      samplers.push({ input, output, interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node: track.node, path: "rotation" } });
    }
    animations.push({ name: clip.name, samplers, channels });
  }

  const json = {
    asset: { version: "2.0", generator: "ignifx tests/fixtures/assets/3d/make-rig.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "root", children: [1, 6] },
      { name: "hips", translation: [0, 0.55, 0], children: [2, 3, 4] },
      { name: "torso", translation: [0, 0.55, 0], children: [5] },
      { name: "armL", translation: [-0.4, 0.5, 0] },
      { name: "armR", translation: [0.4, 0.5, 0] },
      { name: "hand", translation: [0.35, 0.2, 0.2] },
      { name: "boxman", mesh: 0, skin: 0 },
    ],
    meshes: [
      {
        name: "boxman",
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 2, WEIGHTS_0: 3 },
            indices: 4,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    skins: [{ name: "rig", inverseBindMatrices: inverseBindAccessor, joints: [1, 2, 3, 4], skeleton: 1 }],
    materials: [
      {
        name: "boxman",
        pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.4, 1], metallicFactor: 0, roughnessFactor: 0.9 },
      },
    ],
    animations,
    accessors,
    bufferViews: builder.views,
    buffers: [{ byteLength: 0 }],
  };
  const binary = builder.build();
  json.buffers[0].byteLength = binary.byteLength;
  return { json, binary };
}

/**
 * Packs a glTF document and its buffer into a `.glb` container.
 * @param json - The document.
 * @param binary - The binary chunk.
 * @returns The `.glb` bytes.
 */
function packGlb(json, binary) {
  const encoder = new TextEncoder();
  let jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jsonPadding > 0) {
    const padded = new Uint8Array(jsonBytes.byteLength + jsonPadding);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.byteLength);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.byteLength + 8 + binary.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46_54_6c_67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e_4f_53_4a, true);
  out.set(jsonBytes, 20);
  const binaryHeader = 20 + jsonBytes.byteLength;
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, 0x00_4e_49_42, true);
  out.set(binary, binaryHeader + 8);
  return Buffer.from(out);
}

const { json, binary } = buildDocument();
const glb = packGlb(json, binary);
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "rig.glb"), glb);
process.stdout.write(
  `rig.glb: ${String(glb.byteLength)} bytes, ${String(json.accessors[0].count)} vertices, ` +
    `${String(json.animations.length)} clips, ${String(JOINTS.length)} joints\n`,
);
