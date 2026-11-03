import { addTask, buildFrameGraphTask, createRenderTarget, createRenderTask, getFrameGraph } from "@babylonjs/lite";
import type { Camera, EngineContext, Mesh, RenderTarget, RenderTaskConfig, SceneContext, Task } from "@babylonjs/lite";

/**
 * Render-to-texture (`docs/architecture/07-rendering.md` §2.11): a second pass of the render scene,
 * through another camera, into an offscreen colour target that can be read back.
 *
 * Everything here needs a device, and every Lite claim was read from `@babylonjs/lite@1.34.0`.
 *
 * ## The pass
 *
 * One `createRenderTask` per texture, appended to the render scene's frame graph. Its target is an
 * ordinary `createRenderTarget` of a fixed `{ width, height }`, in the surface's colour format with
 * a depth/stencil attachment of its own, single-sample. The task owns it: `record()` allocates it
 * (`buildRenderTarget`, `RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC | COPY_DST`,
 * `lib/engine/render-target.js` 59) and `dispose()` frees it. The task auto-mirrors the scene's
 * renderables, builds its own pipelines for its target signature, and writes a scene UBO of its own
 * (`_sceneUBO`, `lib/frame-graph/render-task-base.js` 85), so its camera never disturbs the main
 * pass.
 *
 * ## The camera
 *
 * `RenderTaskConfig.cam` is read on every execute (`task._config.cam ?? scene.camera`,
 * `render-task-base.js` 236, 279) from the config object the task keeps by reference (line 77), so
 * re-pointing the pass is one assignment. A `null` camera would fall back to the scene's main
 * camera, so the pass is switched off with `Task.executionEnabled` instead.
 *
 * ## Editor-only meshes
 *
 * A render task draws every visible mesh of its scene; `RenderTaskConfig` has no mesh filter. So
 * the task's `execute` (the frame graph calls it, `lib/frame-graph/frame-graph.js` 16) is wrapped:
 * it hides each visible mesh whose `metadata[excludeKey]` is `true`, runs, and shows them again.
 * The main pass has already drawn the frame by then (the task is appended after it), so the main
 * view never sees them hidden and does not flicker. `drawList` reads `visible` as it encodes
 * (`render-task-base.js` 354), and this task's opaque bundle is only ever encoded inside the
 * wrapper, so it never holds them either.
 *
 * ## Gaps in Lite's public surface
 *
 * - **No task removal.** `FrameGraph` exposes only `build`/`execute`/`dispose`, and a disposed
 *   render task throws from `record()` on the next `frameGraph.build()` (a canvas resize). So the
 *   task is spliced out of `_tasks`, the array `addTask` appends to (`lib/frame-graph/frame-graph.js`),
 *   before it is disposed.
 * - **No texture readback.** Lite reads back only the swapchain (`captureScreenshot`). The read here
 *   copies the target's `_colorTexture` into a mapped buffer through `engine._device`. Queue order
 *   makes it read the last frame submitted before the call.
 */

/** The depth/stencil format Lite's own render tasks use. */
const DEPTH_STENCIL_FORMAT: GPUTextureFormat = "depth24plus-stencil8";

/** WebGPU's `bytesPerRow` alignment for a texture-to-buffer copy. */
const ROW_ALIGNMENT = 256;

/** RGBA8 bytes per pixel. */
const BYTES_PER_PIXEL = 4;

/** The fields of a Lite 1.34 render target that hold its live GPU texture. */
interface TargetInternals {
  /** The colour texture, `null` until the owning task has recorded. */
  _colorTexture?: GPUTexture | null;
}

/** The field of a Lite 1.34 engine that holds its device. */
interface EngineInternals {
  /** The device; replaced after a device-loss recovery, so read on every use. */
  _device?: GPUDevice;
}

/** The field of a Lite 1.34 frame graph that holds its tasks. */
interface FrameGraphInternals {
  /** The tasks, in execute order. */
  _tasks?: Task[];
}

/**
 * One texture's render pass.
 *
 * @internal
 */
export interface LiteRenderTexture {
  /**
   * Points the pass at a camera, or switches it off.
   *
   * @param camera - The camera to render through from the next frame, or `null` to stop.
   */
  setCamera(camera: Camera | null): void;
  /**
   * Reads the texture as it is after the last submitted frame.
   *
   * @returns `width * height * 4` bytes of RGBA8, top row first.
   * @throws Error when the pass has not recorded yet or the engine has no device.
   */
  read(): Promise<Uint8ClampedArray>;
  /** Removes the pass from the frame graph and frees its target. Idempotent. */
  dispose(): void;
}

/**
 * Creates a texture's render pass, switched off, at the end of the render scene's frame graph.
 *
 * @remarks
 * Call it only once the scene is registered: the task is recorded at once, which allocates its
 * target.
 *
 * @param engine - The WebGPU engine.
 * @param scene - The registered render scene.
 * @param width - The width in pixels.
 * @param height - The height in pixels.
 * @param excludeKey - The `metadata` key that, set to `true` on a mesh, keeps it out of the pass.
 * @returns The pass.
 *
 * @internal
 */
export function createLiteRenderTexture(
  engine: EngineContext,
  scene: SceneContext,
  width: number,
  height: number,
  excludeKey: string,
): LiteRenderTexture {
  const target: RenderTarget = createRenderTarget({
    lbl: "ignifx:render-texture",
    format: engine.format,
    dFormat: DEPTH_STENCIL_FORMAT,
    samples: 1,
    size: { width, height },
  });
  const config: RenderTaskConfig = { name: "ignifx:render-texture", rt: target, cam: null };
  const task = createRenderTask(config, engine, scene);
  task.executionEnabled = false;
  const execute = task.execute?.bind(task);
  if (execute === undefined) {
    throw new TypeError("Lite's render task has no execute(); render-texture.ts needs updating for this Lite.");
  }
  const hidden: Mesh[] = [];
  task.execute = (): number => {
    for (const mesh of scene.meshes) {
      if (mesh.visible !== false && mesh.metadata?.[excludeKey] === true) {
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
  let isDisposed = false;
  return {
    setCamera(camera: Camera | null): void {
      if (isDisposed) {
        return;
      }
      config.cam = camera;
      task.executionEnabled = camera !== null;
    },
    async read(): Promise<Uint8ClampedArray> {
      const texture = isDisposed ? null : colorTextureOf(target);
      const device = deviceOf(engine);
      if (texture === null || device === null) {
        throw new Error("The render texture has no GPU texture to read.");
      }
      return readTexture(device, texture, width, height);
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      task.executionEnabled = false;
      removeTask(scene, task);
      task.dispose();
    },
  };
}

/**
 * A render target's live colour texture.
 *
 * @param target - The target.
 * @returns The texture, or `null` before the owning task has recorded.
 */
function colorTextureOf(target: RenderTarget): GPUTexture | null {
  // Boundary assertion (coding standards §5.2): the field Lite 1.34 keeps, documented above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const internals = target as RenderTarget & TargetInternals;
  // oxlint-disable-next-line no-underscore-dangle
  return internals._colorTexture ?? null;
}

/**
 * An engine's current device.
 *
 * @param engine - The engine.
 * @returns The device, or `null` for an engine without one.
 */
function deviceOf(engine: EngineContext): GPUDevice | null {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const internals = engine as EngineContext & EngineInternals;
  // oxlint-disable-next-line no-underscore-dangle
  return internals._device ?? null;
}

/**
 * Takes a task out of a scene's frame graph, so the next rebuild does not record it.
 *
 * @param scene - The scene.
 * @param task - The task.
 */
function removeTask(scene: SceneContext, task: Task): void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const graph = getFrameGraph(scene) as ReturnType<typeof getFrameGraph> & FrameGraphInternals;
  // oxlint-disable-next-line no-underscore-dangle
  const tasks = graph._tasks;
  if (!Array.isArray(tasks)) {
    // A Lite upgrade renamed the field: fail here, not on the next rebuild (07-rendering §2.11).
    throw new TypeError("Lite's FrameGraph has no _tasks array; render-texture.ts needs updating for this Lite.");
  }
  const index = tasks.indexOf(task);
  if (index >= 0) {
    tasks.splice(index, 1);
  }
}

/**
 * Copies a colour texture into tightly packed RGBA8.
 *
 * @param device - The device that owns the texture.
 * @param texture - An 8-bit RGBA or BGRA texture with `COPY_SRC`.
 * @param width - The width to read.
 * @param height - The height to read.
 * @returns The pixels, top row first, red first.
 */
async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const rowBytes = width * BYTES_PER_PIXEL;
  const bytesPerRow = Math.ceil(rowBytes / ROW_ALIGNMENT) * ROW_ALIGNMENT;
  const buffer = device.createBuffer({
    label: "ignifx:render-texture-read",
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({ label: "ignifx:render-texture-read" });
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height });
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const out = new Uint8ClampedArray(rowBytes * height);
    for (let row = 0; row < height; row += 1) {
      out.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes), row * rowBytes);
    }
    if (texture.format.startsWith("bgra")) {
      for (let index = 0; index < out.length; index += BYTES_PER_PIXEL) {
        const blue = out[index] ?? 0;
        out[index] = out[index + 2] ?? 0;
        out[index + 2] = blue;
      }
    }
    return out;
  } finally {
    buffer.destroy();
  }
}
