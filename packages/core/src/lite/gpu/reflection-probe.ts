import {
  addTask,
  buildFrameGraphTask,
  clearPbrLocalEnvironment,
  createBankedFreeCamera,
  createRenderTarget,
  createRenderTask,
  enablePbrLocalCubemap,
  getFrameGraph,
  getPbrUnlit,
  isPbrMaterial,
  isPbrSkybox,
  setPbrEnvironment,
  setPbrLocalEnvironment,
} from "@babylonjs/lite";
import { rebuildMaterialPipelines } from "../material.js";
import { readOwnerTag } from "../picking.js";
import { readSceneEnvironment } from "./environment.js";
import { colorTextureOf, deviceOf, removeTask } from "./render-texture.js";
import type { NodeTag } from "../node.js";
import type {
  BankedFreeCamera,
  EngineContext,
  EnvironmentTextures,
  Mesh,
  PbrMaterialProps,
  RenderTarget,
  RenderTask,
  SceneContext,
} from "@babylonjs/lite";

/**
 * Reflection probes (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B1). Its own chunk,
 * loaded only when a world has a `ReflectionProbe` (`CONSTITUTION.md` §2.5). Every Lite claim was
 * read from `@babylonjs/lite@1.34.0`.
 *
 * - **Capture.** Lite has no cube capture, so six render tasks (`createRenderTask`, each with its own
 *   `rgba16float` target and a `createBankedFreeCamera` looking down one axis, 90° field of view,
 *   square target) are appended to the frame graph, switched on for the frames that capture, like
 *   `./render-texture.ts`. Faces follow the cube-map convention in Lite's left-handed space: +X, −X
 *   and ±Z faces use +Y as up, +Y uses −Z and −Y uses +Z.
 * - **Cube and mips.** In the next frame's `PreRender`, a small render pipeline of ignifx's own copies
 *   each face into a cube texture, decoding gamma when `rendering.hdr` is off (the faces then hold
 *   tone-mapped sRGB), and box-downsamples the mip chain. It is submitted before Lite's frame, so queue
 *   order makes it read the frame that rendered the faces. Mips are not GGX-prefiltered.
 * - **Environment.** The cube is wrapped in an `EnvironmentTextures` (`index.d.ts` 5598) that shares
 *   the scene environment's BRDF table and spherical harmonics, so diffuse light is unchanged.
 * - **Materials.** `setPbrLocalEnvironment` (box parallax) or `setPbrEnvironment` (no box) per lit PBR
 *   material, then a material rebuild (`index.d.ts` 12612–12654). `enablePbrLocalCubemap` must have
 *   resolved first; it is called when the chunk loads.
 * - **Culling mask.** Render tasks have no mesh filter, so each face task's `execute` hides the meshes
 *   the caller rejects and shows them again, as `./render-texture.ts` does for editor-only meshes.
 */

/** The colour format of the faces and the cube. */
const PROBE_FORMAT: GPUTextureFormat = "rgba16float";

/** The depth/stencil format Lite's own render tasks use. */
const DEPTH_STENCIL_FORMAT: GPUTextureFormat = "depth24plus-stencil8";

/** Each face's view direction and up vector, in cube-face order +X, −X, +Y, −Y, +Z, −Z. */
const FACES: readonly (readonly [number, number, number, number, number, number])[] = [
  [1, 0, 0, 0, 1, 0],
  [-1, 0, 0, 0, 1, 0],
  [0, 1, 0, 0, 0, -1],
  [0, -1, 0, 0, 0, 1],
  [0, 0, 1, 0, 1, 0],
  [0, 0, -1, 0, 1, 0],
];

/** A full-screen triangle that copies, decodes, or (through a linear sampler) box-downsamples. */
const BLIT_WGSL = /* wgsl */ `
struct VsOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VsOut {
  let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VsOut;
  out.position = vec4<f32>(corner * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(corner.x, 1.0 - corner.y);
  return out;
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@fragment fn copy(in: VsOut) -> @location(0) vec4<f32> {
  return vec4<f32>(textureSampleLevel(source, sourceSampler, in.uv, 0.0).rgb, 1.0);
}
@fragment fn decode(in: VsOut) -> @location(0) vec4<f32> {
  let colour = textureSampleLevel(source, sourceSampler, in.uv, 0.0).rgb;
  return vec4<f32>(pow(max(colour, vec3<f32>(0.0)), vec3<f32>(2.2)), 1.0);
}
`;

/** The blit pipelines of one device. */
interface BlitPipelines {
  readonly copy: GPURenderPipeline;
  readonly decode: GPURenderPipeline;
  readonly sampler: GPUSampler;
}

/** Each device's pipelines, the map created on first use (coding standards §4). */
let pipelineCache: WeakMap<GPUDevice, BlitPipelines> | null = null;

/**
 * One probe's capture passes and cube map.
 *
 * @internal
 */
export interface LiteReflectionProbe {
  /** The cube face size in pixels. */
  readonly size: number;
  /** The environment materials reflect, `null` until the first capture resolved. Stable afterwards. */
  readonly environment: EnvironmentTextures | null;
  /**
   * Renders the six faces in the coming frame.
   *
   * @param x - The world X of the capture point.
   * @param y - The world Y.
   * @param z - The world Z.
   * @param near - The near clip distance.
   * @param far - The far clip distance.
   */
  capture(x: number, y: number, z: number, near: number, far: number): void;
  /**
   * Turns the faces the last frame rendered into the cube map, when a capture ran.
   *
   * @param decodeGamma - Whether the faces hold gamma-encoded colour (`rendering.hdr` off).
   * @returns `true` when {@link LiteReflectionProbe.environment} was created by this call.
   */
  resolve(decodeGamma: boolean): boolean;
  /** Removes the passes and frees the textures. Idempotent. */
  dispose(): void;
}

/**
 * Loads Lite's local-cubemap shader path. Resolve it before assigning any probe.
 *
 * @returns A promise that resolves once the path is registered.
 *
 * @internal
 */
export function enableReflectionProbes(): Promise<void> {
  return enablePbrLocalCubemap();
}

/**
 * Creates a probe's six face passes, switched off, at the end of the scene's frame graph.
 *
 * @param engine - The WebGPU engine.
 * @param scene - The registered render scene.
 * @param size - The face size in pixels, a power of two.
 * @param excludeKey - The `metadata` key that, set to `true` on a mesh, keeps it out of the faces.
 * @param accept - Whether a mesh's owner may be captured; `false` hides it during the faces.
 * @returns The probe.
 *
 * @internal
 */
export function createLiteReflectionProbe(
  engine: EngineContext,
  scene: SceneContext,
  size: number,
  excludeKey: string,
  accept: (tag: NodeTag | null) => boolean,
): LiteReflectionProbe {
  const targets: RenderTarget[] = [];
  const tasks: RenderTask[] = [];
  const cameras: BankedFreeCamera[] = [];
  const hidden: Mesh[] = [];
  for (const face of FACES) {
    const target = createRenderTarget({
      lbl: "ignifx:reflection-probe-face",
      format: PROBE_FORMAT,
      dFormat: DEPTH_STENCIL_FORMAT,
      samples: 1,
      size: { width: size, height: size },
    });
    const camera = createBankedFreeCamera(
      { x: 0, y: 0, z: 0 },
      { x: face[0], y: face[1], z: face[2] },
      {
        x: face[3],
        y: face[4],
        z: face[5],
      },
    );
    camera.fov = Math.PI / 2;
    const task = createRenderTask({ name: "ignifx:reflection-probe", rt: target, cam: camera }, engine, scene);
    task.executionEnabled = false;
    const execute = task.execute?.bind(task);
    if (execute === undefined) {
      throw new TypeError("Lite's render task has no execute(); reflection-probe.ts needs updating for this Lite.");
    }
    task.execute = (): number => {
      for (const mesh of scene.meshes) {
        if (mesh.visible !== false && (mesh.metadata?.[excludeKey] === true || !accept(readOwnerTag(mesh)))) {
          mesh.visible = false;
          hidden.push(mesh);
        }
      }
      try {
        return execute();
      } finally {
        for (const mesh of hidden) {
          mesh.visible = true;
        }
        hidden.length = 0;
      }
    };
    addTask(scene, task);
    buildFrameGraphTask(getFrameGraph(scene), task);
    targets.push(target);
    tasks.push(task);
    cameras.push(camera);
  }
  let cube: GPUTexture | null = null;
  let environment: EnvironmentTextures | null = null;
  let isCapturing = false;
  let isDisposed = false;
  return {
    size,
    get environment(): EnvironmentTextures | null {
      return environment;
    },
    capture(x: number, y: number, z: number, near: number, far: number): void {
      if (isDisposed) {
        return;
      }
      for (let index = 0; index < FACES.length; index += 1) {
        const face = FACES[index];
        const camera = cameras[index];
        const task = tasks[index];
        if (face === undefined || camera === undefined || task === undefined) {
          continue;
        }
        camera.position.set(x, y, z);
        camera.target.set(x + face[0], y + face[1], z + face[2]);
        camera.nearPlane = near;
        camera.farPlane = far;
        task.executionEnabled = true;
      }
      isCapturing = true;
    },
    resolve(decodeGamma: boolean): boolean {
      if (isDisposed || !isCapturing) {
        return false;
      }
      isCapturing = false;
      for (const task of tasks) {
        task.executionEnabled = false;
      }
      const device = deviceOf(engine);
      const base = readSceneEnvironment(scene);
      if (device === null || base === null) {
        return false;
      }
      cube ??= device.createTexture({
        label: "ignifx:reflection-probe",
        size: [size, size, FACES.length],
        format: PROBE_FORMAT,
        mipLevelCount: Math.log2(size) + 1,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      if (!blitFaces(device, cube, targets, decodeGamma)) {
        return false;
      }
      if (environment !== null) {
        return false;
      }
      environment = {
        specularCube: cube,
        specularCubeView: cube.createView({ dimension: "cube" }),
        brdfLut: base.brdfLut,
        brdfLutView: base.brdfLutView,
        cubeSampler: base.cubeSampler,
        brdfSampler: base.brdfSampler,
        irradianceSH: base.irradianceSH,
        sphericalHarmonics: base.sphericalHarmonics,
        lodGenerationScale: base.lodGenerationScale,
        lodGenerationOffset: base.lodGenerationOffset ?? 0,
      };
      return true;
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      for (const task of tasks) {
        task.executionEnabled = false;
        removeTask(scene, task);
        task.dispose();
      }
      // Materials still bound to the cube are reassigned by the caller before the next frame; the
      // cube itself is left for the garbage collector, since a bind group in flight may name it.
      cube = null;
      environment = null;
    },
  };
}

/**
 * Copies the six face targets into the cube's first mip and box-downsamples the rest.
 *
 * @param device - The device.
 * @param cube - The cube texture, six layers.
 * @param targets - The face targets, in cube-face order.
 * @param decodeGamma - Whether to decode gamma on the copy.
 * @returns `false` when a face target has no texture yet.
 */
function blitFaces(
  device: GPUDevice,
  cube: GPUTexture,
  targets: readonly RenderTarget[],
  decodeGamma: boolean,
): boolean {
  const pipelines = blitPipelines(device);
  const encoder = device.createCommandEncoder({ label: "ignifx:reflection-probe-mips" });
  for (let face = 0; face < targets.length; face += 1) {
    const target = targets[face];
    const source = target === undefined ? null : colorTextureOf(target);
    if (source === null) {
      return false;
    }
    draw(
      device,
      encoder,
      decodeGamma ? pipelines.decode : pipelines.copy,
      pipelines.sampler,
      source.createView(),
      cubeFace(cube, face, 0),
    );
    for (let mip = 1; mip < cube.mipLevelCount; mip += 1) {
      draw(
        device,
        encoder,
        pipelines.copy,
        pipelines.sampler,
        cubeFace(cube, face, mip - 1),
        cubeFace(cube, face, mip),
      );
    }
  }
  device.queue.submit([encoder.finish()]);
  return true;
}

/**
 * A 2D view of one face and mip of the cube.
 *
 * @param cube - The cube texture.
 * @param face - The layer.
 * @param mip - The mip level.
 * @returns The view.
 */
function cubeFace(cube: GPUTexture, face: number, mip: number): GPUTextureView {
  return cube.createView({
    dimension: "2d",
    baseArrayLayer: face,
    arrayLayerCount: 1,
    baseMipLevel: mip,
    mipLevelCount: 1,
  });
}

/**
 * Encodes one full-screen blit.
 *
 * @param device - The device.
 * @param encoder - The encoder.
 * @param pipeline - The pipeline.
 * @param sampler - The linear sampler.
 * @param source - The view to read.
 * @param destination - The view to write.
 */
function draw(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipeline: GPURenderPipeline,
  sampler: GPUSampler,
  source: GPUTextureView,
  destination: GPUTextureView,
): void {
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: source },
      { binding: 1, resource: sampler },
    ],
  });
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: destination, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
}

/**
 * The device's blit pipelines.
 *
 * @param device - The device.
 * @returns The pipelines, created on first use.
 */
function blitPipelines(device: GPUDevice): BlitPipelines {
  pipelineCache ??= new WeakMap();
  const cached = pipelineCache.get(device);
  if (cached !== undefined) {
    return cached;
  }
  const module = device.createShaderModule({ label: "ignifx:reflection-probe-blit", code: BLIT_WGSL });
  const pipeline = (entryPoint: string): GPURenderPipeline =>
    device.createRenderPipeline({
      label: `ignifx:reflection-probe-${entryPoint}`,
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint, targets: [{ format: PROBE_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
  const created: BlitPipelines = {
    copy: pipeline("copy"),
    decode: pipeline("decode"),
    sampler: device.createSampler({ magFilter: "linear", minFilter: "linear" }),
  };
  pipelineCache.set(device, created);
  return created;
}

/**
 * What a material reflects: a probe's environment, where it sits, and its projection box.
 *
 * @internal
 */
export interface LiteProbeBinding {
  /** The probe's environment. */
  readonly environment: EnvironmentTextures;
  /** The capture position. */
  readonly position: readonly [number, number, number];
  /** The full size of the projection box, or `null` for none. */
  readonly box: readonly [number, number, number] | null;
}

/**
 * Calls `visit` for every mesh whose material is a lit, non-skybox PBR material.
 *
 * @param scene - The scene.
 * @param visit - Receives the material and the mesh's world position.
 *
 * @internal
 */
export function forEachReflectiveMesh(
  scene: SceneContext,
  visit: (material: PbrMaterialProps, x: number, y: number, z: number) => void,
): void {
  const meshes = scene.meshes;
  for (let index = 0; index < meshes.length; index += 1) {
    const mesh = meshes[index];
    const material = mesh?.material;
    // Declared non-null, but Lite's mesh factories create meshes with `material: null`.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (mesh === undefined || material === undefined || material === null || !isPbrMaterial(material)) {
      continue;
    }
    if (getPbrUnlit(material) !== undefined || isPbrSkybox(material)) {
      continue;
    }
    const world = mesh.worldMatrix;
    visit(material, world[12] ?? 0, world[13] ?? 0, world[14] ?? 0);
  }
}

/**
 * Points a PBR material at a probe, or back at the scene environment, and rebuilds it.
 *
 * @param scene - The registered scene.
 * @param material - The material.
 * @param binding - The probe, or `null` for the scene environment.
 *
 * @internal
 */
export function assignReflectionProbe(
  scene: SceneContext,
  material: PbrMaterialProps,
  binding: LiteProbeBinding | null,
): void {
  if (binding === null) {
    clearPbrLocalEnvironment(material);
  } else if (binding.box === null) {
    setPbrEnvironment(material, binding.environment);
  } else {
    setPbrLocalEnvironment(material, binding.environment, {
      shape: "box",
      capturePosition: binding.position,
      projectionPosition: binding.position,
      projectionSize: binding.box,
    });
  }
  rebuildMaterialPipelines(scene, material);
}
