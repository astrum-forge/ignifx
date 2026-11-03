import {
  addComputeDispatch,
  addTaskAfter,
  buildFrameGraphTask,
  computeTextureBinding,
  computeStorageTextureBinding,
  computeUniformBufferBinding,
  createComputeBindingSet,
  createComputeDispatch,
  createComputeShader,
  createComputeStorageTexture2D,
  createComputeTask,
  createComputeTextureResource,
  createUniformBuffer,
  disposeComputeBindingSet,
  disposeComputeShader,
  disposeComputeStorageTexture2D,
  disposeUniformBuffer,
  getEffectiveAspectRatio,
  getFrameGraph,
  getPbrUnlit,
  getProjectionMatrix,
  getViewMatrix,
  invertMat4,
  isPbrMaterial,
  removeComputeDispatch,
  updateUniformBuffer,
} from "@babylonjs/lite";
import { rebuildMaterialPipelines } from "../material.js";
import { frameGraphTasks, SCENE_INPUT_TASK_NAMES } from "./scene-inputs.js";
import type { SceneInputs } from "./scene-inputs.js";
import type {
  ComputeDispatch,
  ComputeShader,
  ComputeStorageTexture2D,
  ComputeTask,
  EngineContext,
  Mat4,
  Material,
  MaterialPlugin,
  SceneContext,
  Task,
  UniformBuffer,
} from "@babylonjs/lite";

/**
 * Ground-truth ambient occlusion (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, steps G8 and G9;
 * `docs/architecture/07-rendering.md` §2.14). Its own chunk: the renderer imports it only when
 * `rendering.ambientOcclusion.enabled` is on, so a project without it loads none of it and its frame
 * graph has none of these tasks (`CONSTITUTION.md` §2.5).
 *
 * ```text
 * … depth pyramid → gtao params → gtao (compute: horizons, then depth-aware blur) → scene → …
 *                                                └─ AO texture ─→ every lit PBR material's `occlusion`
 * ```
 *
 * - **GTAO** (Jimenez et al. 2016, after XeGTAO): per pixel, a few screen-space slices through the
 *   view vector; along each, the highest horizon on either side within `radius`, then the cosine-
 *   weighted visible arc between them against the normal projected into the slice. Depth comes from
 *   the scene inputs' depth pyramid (level 1 at half resolution, coarser levels for far taps), normals
 *   from the scene inputs' world normals, rotated into view space. Slice angle and step offset are
 *   jittered per pixel with interleaved gradient noise.
 * - **Denoise.** A 5×5 blur weighted by view-depth similarity, in the same compute pass.
 * - **Indirect light only (spike S3).** {@link createAmbientOcclusionPlugin} multiplies Lite's PBR
 *   `occlusion` variable, which scales the environment's irradiance and specular occlusion and
 *   nothing else (`lib/material/pbr/fragments/ibl-fragment.js`), by the AO texture at the
 *   fragment's screen position. Every lit PBR variant declares `occlusion` before that slot: the
 *   template's `occlusionDefault`, or the reflectance extension's own `AT` code
 *   (`lib/material/pbr/fragments/reflectance-fragment.js` line 146). Standard materials, unlit PBR and
 *   custom shaders are left alone.
 * - **Camera matrices** are written by a tiny task that runs inside the frame graph, after Lite has
 *   updated world matrices for the frame, so the AO never lags a moving camera.
 * - **Resize and device loss.** The scene inputs' `onChange` disables the pass, rebuilds the
 *   textures and bindings, swaps them in, and rebuilds the patched materials, whose bind groups hold
 *   the AO texture's view. The old textures are disposed a few frames later, once no in-flight bind
 *   group can still name them.
 * - **TAA.** `rendering.taa` (G5) filters the final colour, AO included; a dedicated AO history is
 *   not wired. It would accumulate {@link AmbientOcclusion.texture} before the plugin reads it.
 */

/**
 * The frame-graph task names, in the order they run after the scene inputs.
 *
 * @internal
 */
export const GTAO_TASK_NAMES = { params: "ignifx:gtao-params", compute: "ignifx:gtao" } as const;

/**
 * The name the material plugin carries; part of Lite's pipeline cache key.
 *
 * @internal
 */
export const GTAO_PLUGIN_NAME = "ignifx-gtao";

/** The uniform block: three matrices, the sizes, the settings. */
const UNIFORM_FLOATS = 16 * 3 + 4 + 4;

/** Frames an old texture set outlives its replacement. */
const RETIRE_FRAMES = 8;

/** The workgroup edge both shaders use. */
const WORKGROUP = 8;

/**
 * What the GTAO pass is asked for.
 *
 * @internal
 */
export interface AmbientOcclusionOptions {
  /** `"half"` or `"full"` resolution. */
  readonly quality: "half" | "full";
  /** World-space radius. */
  readonly radius: number;
  /** Exponent on the visibility. */
  readonly intensity: number;
  /** Fraction of the radius over which occluders fade. */
  readonly falloff: number;
  /** Where an asynchronous rebuild's failure goes. */
  readonly onError: (error: unknown) => void;
}

/**
 * The slice and step counts and the resolution divisor of a quality.
 *
 * @internal
 */
export interface GtaoShape {
  /** Full-resolution pixels per AO pixel along each axis: 2 or 1. */
  readonly scale: number;
  /** The depth-pyramid level the centre depth is read from. */
  readonly baseMip: number;
  /** Screen-space slices per pixel. */
  readonly slices: number;
  /** Steps along each side of a slice. */
  readonly steps: number;
}

/**
 * The shape of a quality: `"half"` is 2 slices × 4 steps at half resolution, `"full"` 3 × 6 at full.
 *
 * @param quality - The quality.
 * @returns The shape.
 *
 * @internal
 */
export function gtaoShape(quality: "half" | "full"): GtaoShape {
  return quality === "full"
    ? { scale: 1, baseMip: 0, slices: 3, steps: 6 }
    : { scale: 2, baseMip: 1, slices: 2, steps: 4 };
}

/**
 * A running GTAO pass.
 *
 * @internal
 */
export interface AmbientOcclusion {
  /** The denoised AO texture, `rgba8unorm`, AO in every colour channel; replaced on resize. */
  readonly texture: ComputeStorageTexture2D;
  /**
   * Attaches the plugin to lit PBR materials that lack it and retires old textures. Once a frame.
   *
   * @param isSceneRegistered - Whether a patched material's pipelines must be rebuilt.
   */
  update(isSceneRegistered: boolean): void;
  /** Removes the tasks, frees every GPU object and releases the scene-inputs lease. Idempotent. */
  dispose(): void;
}

/** One device's worth of GPU objects, rebuilt on resize and device recovery. */
interface GpuSet {
  readonly uniforms: UniformBuffer;
  readonly raw: ComputeStorageTexture2D;
  readonly out: ComputeStorageTexture2D;
  readonly shaders: readonly ComputeShader[];
  readonly gtao: ComputeDispatch;
  readonly denoise: ComputeDispatch;
  /** Full-resolution width and height the set was built for. */
  readonly width: number;
  readonly height: number;
}

/**
 * Builds the GTAO compute shader.
 *
 * @param shape - The quality's shape, baked in as constants.
 * @returns The WGSL.
 *
 * @internal
 */
export function gtaoWgsl(shape: GtaoShape): string {
  return `
struct GtaoParams {
  proj: mat4x4<f32>,
  invProj: mat4x4<f32>,
  view: mat4x4<f32>,
  size: vec4<f32>,
  settings: vec4<f32>,
};
@group(0) @binding(0) var<uniform> params: GtaoParams;
@group(0) @binding(1) var depthPyramid: texture_2d<f32>;
@group(0) @binding(2) var normals: texture_2d<f32>;
@group(0) @binding(3) var aoOut: texture_storage_2d<rgba16float, write>;

const SLICES: u32 = ${String(shape.slices)}u;
const STEPS: u32 = ${String(shape.steps)}u;
const BASE_MIP: i32 = ${String(shape.baseMip)};
const SCALE: f32 = ${shape.scale.toFixed(1)};
const PI: f32 = 3.14159265;
const HALF_PI: f32 = 1.57079633;

fn loadDepth(pixel: vec2<f32>, mip: i32) -> f32 {
  let dims = vec2<i32>(textureDimensions(depthPyramid, mip));
  let coord = clamp(vec2<i32>(floor(pixel / f32(1 << u32(mip)))), vec2<i32>(0), dims - 1);
  return textureLoad(depthPyramid, coord, mip).r;
}

fn viewPosition(pixel: vec2<f32>, depth: f32) -> vec3<f32> {
  let uv = pixel / params.size.xy;
  let p = params.invProj * vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  return p.xyz / p.w;
}

fn ign(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

@compute @workgroup_size(${String(WORKGROUP)}, ${String(WORKGROUP)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (f32(id.x) >= params.size.z || f32(id.y) >= params.size.w) {
    return;
  }
  let pixel = (vec2<f32>(id.xy) + 0.5) * SCALE;
  let depth = loadDepth(pixel, BASE_MIP);
  if (depth <= 0.0) {
    textureStore(aoOut, vec2<i32>(id.xy), vec4<f32>(1.0, 0.0, 0.0, 1.0));
    return;
  }
  let P = viewPosition(pixel, depth);
  let V = normalize(viewPosition(pixel, 1.0) - P);
  let full = vec2<i32>(params.size.xy) - 1;
  let stored = textureLoad(normals, clamp(vec2<i32>(pixel), vec2<i32>(0), full), 0).xyz;
  let N = normalize((params.view * vec4<f32>(stored * 2.0 - 1.0, 0.0)).xyz);

  let radius = params.settings.x;
  let falloffRange = max(params.settings.y * radius, 0.0001);
  let c0 = params.proj * vec4<f32>(P, 1.0);
  let c1 = params.proj * vec4<f32>(P + vec3<f32>(radius, 0.0, 0.0), 1.0);
  let screenRadius = min(abs(c1.x / c1.w - c0.x / c0.w) * 0.5 * params.size.x, 0.3 * max(params.size.x, params.size.y));
  if (screenRadius < SCALE) {
    textureStore(aoOut, vec2<i32>(id.xy), vec4<f32>(1.0, abs(P.z), 0.0, 1.0));
    return;
  }
  let maxMip = i32(textureNumLevels(depthPyramid)) - 1;
  let noiseSlice = ign(vec2<f32>(id.xy));
  let noiseStep = ign(vec2<f32>(id.xy) + vec2<f32>(17.0, 59.0));

  var visibility = 0.0;
  for (var slice = 0u; slice < SLICES; slice++) {
    let phi = (f32(slice) + noiseSlice) * PI / f32(SLICES);
    let omega = vec2<f32>(cos(phi), -sin(phi));
    let direction = vec3<f32>(omega.x, -omega.y, 0.0);
    let orthoDirection = direction - dot(direction, V) * V;
    let axis = normalize(cross(orthoDirection, V));
    let projected = N - axis * dot(N, axis);
    let projectedLength = length(projected);
    let signN = sign(dot(orthoDirection, projected));
    let cosN = clamp(dot(projected, V) / max(projectedLength, 0.0001), 0.0, 1.0);
    let n = signN * acos(cosN);
    let low0 = cos(n + HALF_PI);
    let low1 = cos(n - HALF_PI);
    var horizon0 = low0;
    var horizon1 = low1;
    for (var step = 0u; step < STEPS; step++) {
      let t = (f32(step) + noiseStep) / f32(STEPS);
      let offsetLength = mix(SCALE, screenRadius, t * t);
      let mip = clamp(i32(floor(log2(offsetLength))) - 3, BASE_MIP, max(maxMip, BASE_MIP));
      let offset = omega * offsetLength;
      let d0 = loadDepth(pixel + offset, mip);
      let d1 = loadDepth(pixel - offset, mip);
      let s0 = viewPosition(pixel + offset, max(d0, 0.000001)) - P;
      let s1 = viewPosition(pixel - offset, max(d1, 0.000001)) - P;
      let l0 = length(s0);
      let l1 = length(s1);
      let w0 = select(0.0, clamp((radius - l0) / falloffRange, 0.0, 1.0), d0 > 0.0);
      let w1 = select(0.0, clamp((radius - l1) / falloffRange, 0.0, 1.0), d1 > 0.0);
      horizon0 = max(horizon0, mix(low0, dot(s0 / max(l0, 0.00001), V), w0));
      horizon1 = max(horizon1, mix(low1, dot(s1 / max(l1, 0.00001), V), w1));
    }
    var h0 = -acos(clamp(horizon1, -1.0, 1.0));
    var h1 = acos(clamp(horizon0, -1.0, 1.0));
    h0 = n + clamp(h0 - n, -HALF_PI, HALF_PI);
    h1 = n + clamp(h1 - n, -HALF_PI, HALF_PI);
    let sinN = sin(n);
    let arc0 = (cosN + 2.0 * h0 * sinN - cos(2.0 * h0 - n)) * 0.25;
    let arc1 = (cosN + 2.0 * h1 * sinN - cos(2.0 * h1 - n)) * 0.25;
    visibility += projectedLength * (arc0 + arc1);
  }
  visibility = clamp(visibility / f32(SLICES), 0.03, 1.0);
  let ao = pow(visibility, params.settings.z);
  textureStore(aoOut, vec2<i32>(id.xy), vec4<f32>(ao, abs(P.z), 0.0, 1.0));
}
`;
}

/**
 * Builds the denoise shader: a 5×5 Gaussian weighted by view-depth similarity.
 *
 * @returns The WGSL.
 *
 * @internal
 */
export function gtaoDenoiseWgsl(): string {
  return `
struct GtaoParams {
  proj: mat4x4<f32>,
  invProj: mat4x4<f32>,
  view: mat4x4<f32>,
  size: vec4<f32>,
  settings: vec4<f32>,
};
@group(0) @binding(0) var<uniform> params: GtaoParams;
@group(0) @binding(1) var rawAo: texture_2d<f32>;
@group(0) @binding(2) var aoOut: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(${String(WORKGROUP)}, ${String(WORKGROUP)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (f32(id.x) >= params.size.z || f32(id.y) >= params.size.w) {
    return;
  }
  let dims = vec2<i32>(textureDimensions(rawAo)) - 1;
  let at = vec2<i32>(id.xy);
  let centre = textureLoad(rawAo, at, 0);
  if (centre.y <= 0.0) {
    textureStore(aoOut, at, vec4<f32>(centre.x, centre.x, centre.x, 1.0));
    return;
  }
  let tolerance = max(centre.y * 0.05, 0.0001);
  var sum = 0.0;
  var weights = 0.0;
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let tap = textureLoad(rawAo, clamp(at + vec2<i32>(x, y), vec2<i32>(0), dims), 0);
      let spatial = exp(-f32(x * x + y * y) / 4.5);
      let similar = max(0.0, 1.0 - abs(tap.y - centre.y) / tolerance);
      let weight = spatial * similar;
      sum += tap.x * weight;
      weights += weight;
    }
  }
  let ao = sum / max(weights, 0.0001);
  textureStore(aoOut, at, vec4<f32>(ao, ao, ao, 1.0));
}
`;
}

/**
 * The plugin code that multiplies a PBR fragment's `occlusion` by the AO texture.
 *
 * @remarks
 * At half resolution the AO texel under the fragment is blended bilinearly from four loads rather
 * than through a sampler, so the result does not depend on the storage texture's sampler. The block
 * scope keeps its names out of the shader's. `input.clipPos` is the fragment's `@builtin(position)`
 * (spike S3).
 *
 * @param scale - Full-resolution pixels per AO pixel.
 * @returns The WGSL for `CUSTOM_FRAGMENT_BEFORE_LIGHTS`.
 *
 * @internal
 */
export function gtaoPluginWgsl(scale: number): string {
  if (scale === 1) {
    return (
      "{let igxAoMax=vec2<i32>(textureDimensions(ignifxAo))-1;" +
      "occlusion*=textureLoad(ignifxAo,clamp(vec2<i32>(input.clipPos.xy),vec2<i32>(0),igxAoMax),0).r;}"
    );
  }
  return (
    "{let igxAoMax=vec2<i32>(textureDimensions(ignifxAo))-1;" +
    `let igxAoF=input.clipPos.xy/${scale.toFixed(1)}-0.5;` +
    "let igxAoB=vec2<i32>(floor(igxAoF));let igxAoT=fract(igxAoF);" +
    "let igxAo00=textureLoad(ignifxAo,clamp(igxAoB,vec2<i32>(0),igxAoMax),0).r;" +
    "let igxAo10=textureLoad(ignifxAo,clamp(igxAoB+vec2<i32>(1,0),vec2<i32>(0),igxAoMax),0).r;" +
    "let igxAo01=textureLoad(ignifxAo,clamp(igxAoB+vec2<i32>(0,1),vec2<i32>(0),igxAoMax),0).r;" +
    "let igxAo11=textureLoad(ignifxAo,clamp(igxAoB+vec2<i32>(1,1),vec2<i32>(0),igxAoMax),0).r;" +
    "occlusion*=mix(mix(igxAo00,igxAo10,igxAoT.x),mix(igxAo01,igxAo11,igxAoT.x),igxAoT.y);}"
  );
}

/**
 * Builds the material plugin that applies the AO texture to indirect light (spike S3).
 *
 * @param scale - Full-resolution pixels per AO pixel.
 * @param texture - Reads the current AO texture; it changes on resize.
 * @returns The plugin, shared by every lit PBR material.
 *
 * @internal
 */
export function createAmbientOcclusionPlugin(scale: number, texture: () => ComputeStorageTexture2D): MaterialPlugin {
  const fragment = { CUSTOM_FRAGMENT_BEFORE_LIGHTS: gtaoPluginWgsl(scale) };
  return {
    name: GTAO_PLUGIN_NAME,
    priority: 600,
    getSamplers: () => [{ texture: "ignifxAo", sampler: "ignifxAoSampler" }],
    // No `getActiveTextures`: the texture is the pass's own, and a material holding a pool reference
    // would stop it from being disposed on resize.
    bindTextures: (out) => {
      out.push({ texture: texture().sampledTexture });
    },
    getCustomCode: (stage) => (stage === "fragment" ? fragment : null),
  };
}

/**
 * Builds the GTAO pass, splices its tasks in after the scene inputs, and returns its handle.
 *
 * @remarks
 * Called once, from the renderer, with a scene-inputs lease the handle now owns. Before the scene is
 * registered (`isFrameGraphBuilt` `false`) `registerScene` records the tasks; afterwards they are
 * recorded here.
 *
 * @param engine - The engine.
 * @param scene - The render scene.
 * @param inputs - A scene-inputs lease; released by {@link AmbientOcclusion.dispose}.
 * @param options - The resolved settings.
 * @param isFrameGraphBuilt - Whether the scene is registered.
 * @returns The handle.
 *
 * @internal
 */
export async function createAmbientOcclusion(
  engine: EngineContext,
  scene: SceneContext,
  inputs: SceneInputs,
  options: AmbientOcclusionOptions,
  isFrameGraphBuilt: boolean,
): Promise<AmbientOcclusion> {
  const shape = gtaoShape(options.quality);
  let current = await buildGpuSet(engine, inputs, shape);
  const retired: { set: GpuSet; frames: number }[] = [];
  const data = new Float32Array(UNIFORM_FLOATS);
  let isDisposed = false;
  let generation = 0;

  const compute: ComputeTask = createComputeTask(engine, GTAO_TASK_NAMES.compute);
  addComputeDispatch(compute, current.gtao);
  addComputeDispatch(compute, current.denoise);
  const params = createExecuteTask(engine, scene, GTAO_TASK_NAMES.params, () => {
    const enabled = writeParams(scene, current, shape, options, data);
    current.gtao.enabled = enabled;
    current.denoise.enabled = enabled;
    if (enabled) {
      updateUniformBuffer(engine, current.uniforms, data);
    }
  });
  const tasks: readonly Task[] = [params, compute];
  const pyramid = frameGraphTasks(scene)?.find((task) => task.name === SCENE_INPUT_TASK_NAMES.depthPyramid);
  if (pyramid === undefined) {
    disposeGpuSet(current);
    inputs.release();
    throw new Error("GTAO needs the scene inputs' depth pyramid task in the frame graph.");
  }
  addTaskAfter(scene, params, pyramid);
  addTaskAfter(scene, compute, params);
  if (isFrameGraphBuilt) {
    const graph = getFrameGraph(scene);
    for (const task of tasks) {
      buildFrameGraphTask(graph, task);
    }
  }

  const plugin = createAmbientOcclusionPlugin(shape.scale, () => current.out);
  const stopWatch = inputs.onChange(() => {
    generation += 1;
    const mine = generation;
    // The pyramid and the input textures were replaced; the bindings name freed ones.
    compute.executionEnabled = false;
    buildGpuSet(engine, inputs, shape).then(
      (next) => {
        if (isDisposed || mine !== generation) {
          disposeGpuSet(next);
          return;
        }
        removeComputeDispatch(compute, current.gtao);
        removeComputeDispatch(compute, current.denoise);
        addComputeDispatch(compute, next.gtao);
        addComputeDispatch(compute, next.denoise);
        retired.push({ set: current, frames: RETIRE_FRAMES });
        current = next;
        compute.executionEnabled = true;
        rebuildPatchedMaterials(scene, plugin);
      },
      (error: unknown) => {
        options.onError(error);
      },
    );
  });

  return {
    get texture(): ComputeStorageTexture2D {
      return current.out;
    },
    update(isSceneRegistered: boolean): void {
      if (isDisposed) {
        return;
      }
      attachPlugin(scene, plugin, isSceneRegistered);
      for (let index = retired.length - 1; index >= 0; index -= 1) {
        const entry = retired[index];
        if (entry !== undefined && --entry.frames <= 0) {
          disposeGpuSet(entry.set);
          retired.splice(index, 1);
        }
      }
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      stopWatch();
      const list = frameGraphTasks(scene);
      for (const task of tasks) {
        // Disable first: a disposed task that still executes is a use-after-free.
        task.executionEnabled = false;
        const index = list?.indexOf(task) ?? -1;
        if (list !== null && index >= 0) {
          list.splice(index, 1);
        }
        task.dispose();
      }
      disposeGpuSet(current);
      for (const entry of retired) {
        disposeGpuSet(entry.set);
      }
      retired.length = 0;
      inputs.release();
    },
  };
}

/**
 * Writes this frame's uniforms from the scene's camera.
 *
 * @param scene - The scene.
 * @param set - The current GPU set, for its sizes.
 * @param shape - The quality's shape.
 * @param options - The settings.
 * @param out - The uniform floats.
 * @returns `false` when there is no camera or its projection does not invert, so the pass skips.
 */
function writeParams(
  scene: SceneContext,
  set: GpuSet,
  shape: GtaoShape,
  options: AmbientOcclusionOptions,
  out: Float32Array,
): boolean {
  const camera = scene.camera;
  if (camera === null) {
    return false;
  }
  const projection = getProjectionMatrix(camera, getEffectiveAspectRatio(camera, set.width, set.height));
  const inverse = invertMat4(projection);
  if (inverse === null) {
    return false;
  }
  copyMat4(projection, out, 0);
  copyMat4(inverse, out, 16);
  copyMat4(getViewMatrix(camera), out, 32);
  out[48] = set.width;
  out[49] = set.height;
  out[50] = set.raw.width;
  out[51] = set.raw.height;
  out[52] = options.radius;
  out[53] = options.falloff;
  out[54] = options.intensity;
  out[55] = shape.slices;
  return true;
}

/**
 * Copies a Lite matrix into a float array.
 *
 * @param matrix - The matrix, column-major.
 * @param out - The destination.
 * @param offset - Where the 16 floats start.
 */
function copyMat4(matrix: Mat4, out: Float32Array, offset: number): void {
  for (let index = 0; index < 16; index += 1) {
    out[offset + index] = matrix[index] ?? 0;
  }
}

/**
 * Creates the textures, shaders and bindings for the current surface size and device.
 *
 * @param engine - The engine.
 * @param inputs - The scene-inputs lease.
 * @param shape - The quality's shape.
 * @returns The set.
 */
async function buildGpuSet(engine: EngineContext, inputs: SceneInputs, shape: GtaoShape): Promise<GpuSet> {
  const width = inputs.depth.width;
  const height = inputs.depth.height;
  const aoWidth = Math.max(1, Math.ceil(width / shape.scale));
  const aoHeight = Math.max(1, Math.ceil(height / shape.scale));
  const [pyramid, normals] = await Promise.all([
    createComputeTextureResource(engine, inputs.depthPyramid, { sampleType: "unfilterable-float" }),
    createComputeTextureResource(engine, inputs.normals, { sampleType: "unfilterable-float" }),
  ]);
  const uniforms = createUniformBuffer(engine, UNIFORM_FLOATS * 4, { label: "ignifx:gtao-params" });
  const raw = createComputeStorageTexture2D(engine, {
    width: aoWidth,
    height: aoHeight,
    format: "rgba16float",
    label: "ignifx:gtao-raw",
    invertY: false,
  });
  const out = createComputeStorageTexture2D(engine, {
    width: aoWidth,
    height: aoHeight,
    format: "rgba8unorm",
    label: "ignifx:gtao",
    invertY: false,
  });
  const gtaoShader = createComputeShader(engine, {
    name: "ignifx:gtao",
    computeSource: gtaoWgsl(shape),
    bindings: [
      computeUniformBufferBinding("params", { group: 0, binding: 0 }),
      computeTextureBinding("depthPyramid", { group: 0, binding: 1, sampleType: "unfilterable-float" }),
      computeTextureBinding("normals", { group: 0, binding: 2, sampleType: "unfilterable-float" }),
      computeStorageTextureBinding("aoOut", { group: 0, binding: 3, format: "rgba16float" }),
    ],
  });
  const denoiseShader = createComputeShader(engine, {
    name: "ignifx:gtao-denoise",
    computeSource: gtaoDenoiseWgsl(),
    bindings: [
      computeUniformBufferBinding("params", { group: 0, binding: 0 }),
      computeTextureBinding("rawAo", { group: 0, binding: 1, sampleType: "float" }),
      computeStorageTextureBinding("aoOut", { group: 0, binding: 2, format: "rgba8unorm" }),
    ],
  });
  const size = { x: Math.ceil(aoWidth / WORKGROUP), y: Math.ceil(aoHeight / WORKGROUP) };
  const gtao = createComputeDispatch(
    gtaoShader,
    createComputeBindingSet(gtaoShader, { params: uniforms, depthPyramid: pyramid, normals, aoOut: raw }),
    { size, enabled: false },
  );
  const denoise = createComputeDispatch(
    denoiseShader,
    createComputeBindingSet(denoiseShader, { params: uniforms, rawAo: raw.computeTexture, aoOut: out }),
    { size, enabled: false },
  );
  return { uniforms, raw, out, shaders: [gtaoShader, denoiseShader], gtao, denoise, width, height };
}

/**
 * Frees a set's GPU objects.
 *
 * @param set - The set.
 */
function disposeGpuSet(set: GpuSet): void {
  set.gtao.enabled = false;
  set.denoise.enabled = false;
  disposeComputeBindingSet(set.gtao.bindings);
  disposeComputeBindingSet(set.denoise.bindings);
  for (const shader of set.shaders) {
    disposeComputeShader(shader);
  }
  disposeComputeStorageTexture2D(set.raw);
  disposeComputeStorageTexture2D(set.out);
  disposeUniformBuffer(set.uniforms);
}

/**
 * Creates a frame-graph task that runs a callback each frame, inside the frame graph.
 *
 * @remarks
 * Lite runs a task's `execute()` fast path instead of its recorded passes
 * (`lib/frame-graph/frame-graph.js`); `record()` and `build()` clear and walk `_passes`, which such
 * a task leaves empty. It runs after Lite's per-frame world-matrix update, unlike `onBeforeRender`.
 *
 * @param engine - The engine.
 * @param scene - The scene.
 * @param name - The task name.
 * @param run - The callback.
 * @returns The task.
 */
function createExecuteTask(engine: EngineContext, scene: SceneContext, name: string, run: () => void): Task {
  const task = {
    name,
    engine,
    scene,
    executionEnabled: true,
    // oxlint-disable-next-line no-underscore-dangle
    _passes: [] as unknown[],
    record(): void {
      // Nothing to record: the work happens in `execute`.
    },
    execute(): number {
      run();
      return 0;
    },
    dispose(): void {
      // Owns nothing.
    },
  };
  return task;
}

/**
 * Gives every lit PBR material in the scene the AO plugin, once.
 *
 * @remarks
 * A walk, for the reasons `./hdr-output.ts`'s `attachLinearOutput` gives: materials come from many
 * places, and a surface shader replaces a material's plugin list.
 *
 * @param scene - The scene.
 * @param plugin - The shared plugin.
 * @param isSceneRegistered - Whether a patched material's pipelines must be rebuilt.
 */
function attachPlugin(scene: SceneContext, plugin: MaterialPlugin, isSceneRegistered: boolean): void {
  const meshes = scene.meshes;
  for (let index = 0; index < meshes.length; index += 1) {
    const material = meshes[index]?.material;
    // Declared non-null, but Lite's mesh factories create meshes with `material: null`.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (material === undefined || material === null || !isPbrMaterial(material)) {
      continue;
    }
    if (getPbrUnlit(material) !== undefined) {
      continue;
    }
    const current = material.plugins ?? [];
    if (current.includes(plugin)) {
      continue;
    }
    material.plugins = [...current, plugin];
    if (isSceneRegistered) {
      rebuildMaterialPipelines(scene, material);
    }
  }
}

/**
 * Rebuilds every material that carries the plugin, so its bind group names the new AO texture.
 *
 * @param scene - The scene.
 * @param plugin - The shared plugin.
 */
function rebuildPatchedMaterials(scene: SceneContext, plugin: MaterialPlugin): void {
  const seen = new Set<Material>();
  const meshes = scene.meshes;
  for (let index = 0; index < meshes.length; index += 1) {
    const material = meshes[index]?.material;
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (material === undefined || material === null || seen.has(material) || !isPbrMaterial(material)) {
      continue;
    }
    seen.add(material);
    if (material.plugins?.includes(plugin) === true) {
      rebuildMaterialPipelines(scene, material);
    }
  }
}
