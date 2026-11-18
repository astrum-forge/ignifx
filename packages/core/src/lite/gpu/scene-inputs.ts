import {
  addTaskAfter,
  addTaskAtStart,
  buildFrameGraphTask,
  createCopyToTextureTask,
  createDepthPyramid,
  createDepthPyramidTask,
  createGeometryRendererTask,
  createSurfaceRenderTargetTexture,
  disposeRenderTargetTexture,
  GeometryTextureType,
  getFrameGraph,
  onRenderTargetTextureResize,
  withSampledDepthTexture,
} from "@babylonjs/lite";
import type {
  DepthPyramid,
  EngineContext,
  RenderTarget,
  RenderTargetTextureResult,
  SceneContext,
  Task,
  Texture2D,
} from "@babylonjs/lite";

/**
 * Shared scene inputs (`docs/architecture/07-rendering.md` §2.12): one geometry pass that
 * screen-space effects (TAA, GTAO, contact shadows, SSGI) read instead of each drawing the scene
 * again. Its own chunk: the renderer imports it only when an effect asks for it, so a project with
 * no such effect loads none of it and its frame graph has none of these tasks (`CONSTITUTION.md`
 * §2.5).
 *
 * ```text
 * [shadow] → geometry ─→ normals copy ─→ velocity copy ─→ [albedo copy] ─→ depth pyramid → scene → …
 *              ├ depth (depth32float, sampled)
 *              ├ world normal ─(copy)─→ normals
 *              ├ velocity ─(copy)─→ velocity
 *              └ [albedo ─(copy)─→ albedo]
 * ```
 *
 * - **Depth** is a surface-sized `depth32float` target with a sampled facade
 *   (`withSampledDepthTexture`) handed to the geometry task as its depth. Reverse-Z: 0 is
 *   the far plane. `depth24plus-stencil8`, the main pass's format, cannot be bound in compute.
 * - **Normals and velocity** are geometry attachments, which Lite exposes only as task-owned
 *   `RenderTarget`s; compute and effect bindings take a `Texture2D`, so each is copied into a target
 *   that has one (`docs/architecture/07-rendering.md` §8, upstream ask "geometry attachments as
 *   `Texture2D`").
 * - **Albedo** is a third attachment only while a user asked for it ({@link SceneInputsOptions.albedo},
 *   SSGI): the first such acquire replaces the geometry task and its copies with ones that also
 *   write albedo, keeping every target the other users hold. The old tasks keep drawing until the
 *   new geometry task has loaded its material code, so no frame is left without inputs. Albedo
 *   stays until the last lease of any kind is released.
 * - **The depth pyramid** is Lite's `createDepthPyramid`: an `r32float` mip chain where each level
 *   keeps the `max` (in reverse-Z, the nearest surface) of its four children.
 * - **Ref-counted.** {@link SceneInputsHost.acquire} adds the tasks for the first user;
 *   {@link SceneInputs.release} by the last one removes and disposes them.
 * - **Resize and device loss.** The targets are sized by the surface, so `frameGraph.build()`
 *   reallocates them, on a resize and on a recovered device alike. The depth target's resize
 *   callback rebuilds the pyramid (its pipelines belong to one device) and tells every user through
 *   {@link SceneInputs.onChange}, so they can rebind.
 */

/**
 * The frame-graph task names, in the order they run.
 *
 * @internal
 */
export const SCENE_INPUT_TASK_NAMES = {
  geometry: "ignifx:scene-inputs",
  normals: "ignifx:scene-inputs-normals",
  velocity: "ignifx:scene-inputs-velocity",
  albedo: "ignifx:scene-inputs-albedo",
  depthPyramid: "ignifx:scene-inputs-depth-pyramid",
} as const;

/**
 * The texture format of each input.
 *
 * @internal
 */
export const SCENE_INPUT_FORMATS: {
  readonly depth: "depth32float";
  readonly normals: "rgba16float";
  readonly velocity: "rgba16float";
  readonly albedo: "rgba8unorm";
  readonly depthPyramid: "r32float";
} = {
  depth: "depth32float",
  normals: "rgba16float",
  velocity: "rgba16float",
  albedo: "rgba8unorm",
  depthPyramid: "r32float",
};

/**
 * What a user needs beyond depth, normals, velocity and the depth pyramid.
 *
 * @internal
 */
export interface SceneInputsOptions {
  /** Whether the user reads {@link SceneInputs.albedo}. Default `false`. */
  readonly albedo?: boolean;
}

/**
 * One user's lease on the shared scene inputs.
 *
 * @remarks
 * Every texture is sized like the surface (backing-store pixels) and holds this frame's values for
 * any task that runs after the inputs' tasks, which sit at the start of the frame graph. A resize or
 * a recovered device swaps the GPU textures behind the same objects; bind groups that captured a
 * view must be rebuilt in {@link SceneInputs.onChange}.
 *
 * @internal
 */
export interface SceneInputs {
  /** Scene depth, `depth32float`, reverse-Z (1 near, 0 far). Bind with `sampleType: "depth"`. */
  readonly depth: Texture2D;
  /**
   * The same depth as the single-sample `RenderTarget` it lives in, for Lite tasks that take a
   * `depthTexture` target (contact shadows, SSGI).
   */
  readonly depthTarget: RenderTarget;
  /** World-space normals, `rgba16float`, stored as `n * 0.5 + 0.5`; 0 where nothing was drawn. */
  readonly normals: Texture2D;
  /**
   * Screen-space motion, `rgba16float`: `xy = 0.5 * (previousNdc - currentNdc)`, so UV units with Y
   * up, pointing from where a pixel is now to where it was last frame; 0 where nothing was drawn.
   * Camera motion always counts. Object motion counts for Standard materials only: Lite 1.34's PBR
   * geometry view reprojects the current world position (`pbr-geometry-output-shader.js` line 41),
   * so a moving PBR mesh under a still camera reads 0.
   */
  readonly velocity: Texture2D;
  /**
   * The diffuse albedo of the nearest surface, `rgba8unorm`; 0 where nothing was drawn. `null`
   * until a lease asked for it ({@link SceneInputsOptions.albedo}); read it again after such a
   * lease was acquired, and expect 0 everywhere for the frames it takes the new geometry task to
   * load.
   *
   * For a PBR material it is Lite's linear `surfaceAlbedo`: the base colour without the metallic
   * and specular share, whether or not the material is unlit. For a Standard material Lite writes
   * the diffuse texture's colour, or white without one, and leaves the material's `diffuse` colour
   * out (`lib/material/standard/standard-geometry-output-shader.js`).
   */
  readonly albedo: Texture2D | null;
  /**
   * The depth pyramid, `r32float`, every mip level; level `n` is the `max` of its four children in
   * level `n - 1`. Read with `textureLoad(tex, coord, mip)`. A resize or recovered device replaces
   * this object, so read it again after {@link SceneInputs.onChange}.
   */
  readonly depthPyramid: Texture2D;
  /** How many mip levels {@link SceneInputs.depthPyramid} has. */
  readonly depthPyramidMipCount: number;
  /** `true` once {@link SceneInputs.release} ran. */
  readonly isReleased: boolean;
  /**
   * Registers a callback for when the textures were reallocated (resize, recovered device).
   *
   * @param callback - Runs during the frame graph rebuild, before the next frame is recorded.
   * @returns A function that unregisters it.
   */
  onChange(callback: () => void): () => void;
  /** Ends this lease. The last release removes and disposes the tasks and targets. Idempotent. */
  release(): void;
}

/**
 * The per-scene owner of the shared inputs: one per renderer.
 *
 * @internal
 */
export interface SceneInputsHost {
  /**
   * Leases the inputs, creating the geometry pass for the first user.
   *
   * @param isFrameGraphBuilt - Whether the scene is registered, so new tasks must be recorded now;
   * before registration `registerScene` records them.
   * @param options - What the user needs beyond the default inputs.
   * @returns A lease; call its `release()` when done. `null` once the host is disposed.
   */
  acquire(isFrameGraphBuilt: boolean, options?: SceneInputsOptions): SceneInputs | null;
  /** How many leases are live. */
  readonly userCount: number;
  /** Ends every lease and frees everything. Idempotent. */
  dispose(): void;
}

/** What the first acquire builds and the last release frees. */
interface SharedInputs {
  readonly depth: RenderTargetTextureResult;
  readonly normals: RenderTargetTextureResult;
  readonly velocity: RenderTargetTextureResult;
  /** The albedo target, once a user asked for it. */
  albedo: RenderTargetTextureResult | null;
  /** The geometry task and its copies; replaced when albedo is added. */
  geometryTasks: readonly Task[];
  /** `true` once {@link teardown} ran, so a late swap frees its tasks instead of inserting them. */
  isTornDown: boolean;
  readonly pyramidTask: Task;
  readonly pyramid: { current: DepthPyramid };
  readonly listeners: Set<() => void>;
  readonly stopResizeWatch: () => void;
}

/**
 * Creates the scene-inputs owner for one scene. It adds nothing to the frame graph until the first
 * {@link SceneInputsHost.acquire}.
 *
 * @param engine - The engine, which is also the primary surface.
 * @param scene - The render scene.
 * @returns The host.
 *
 * @internal
 */
export function createSceneInputsHost(engine: EngineContext, scene: SceneContext): SceneInputsHost {
  let shared: SharedInputs | null = null;
  const leases = new Set<SceneInputs>();
  let isDisposed = false;

  const releaseLease = (lease: SceneInputs): void => {
    if (!leases.delete(lease) || leases.size > 0 || shared === null) {
      return;
    }
    teardown(scene, shared);
    shared = null;
  };

  return {
    acquire(isFrameGraphBuilt: boolean, options?: SceneInputsOptions): SceneInputs | null {
      if (isDisposed) {
        return null;
      }
      const wantsAlbedo = options?.albedo === true;
      shared ??= buildSharedInputs(engine, scene, isFrameGraphBuilt, wantsAlbedo);
      const inputs = shared;
      if (wantsAlbedo && inputs.albedo === null) {
        addAlbedo(engine, scene, inputs, isFrameGraphBuilt);
      }
      let isReleased = false;
      const own = new Set<() => void>();
      const lease: SceneInputs = {
        depth: requireDepthFacade(inputs.depth),
        depthTarget: inputs.depth.rt,
        normals: inputs.normals.texture,
        velocity: inputs.velocity.texture,
        get albedo(): Texture2D | null {
          return inputs.albedo?.texture ?? null;
        },
        get depthPyramid(): Texture2D {
          return inputs.pyramid.current.texture;
        },
        get depthPyramidMipCount(): number {
          return inputs.pyramid.current.mipCount;
        },
        get isReleased(): boolean {
          return isReleased;
        },
        onChange(callback: () => void): () => void {
          inputs.listeners.add(callback);
          own.add(callback);
          return (): void => {
            inputs.listeners.delete(callback);
            own.delete(callback);
          };
        },
        release(): void {
          if (isReleased) {
            return;
          }
          isReleased = true;
          for (const callback of own) {
            inputs.listeners.delete(callback);
          }
          own.clear();
          releaseLease(lease);
        },
      };
      leases.add(lease);
      return lease;
    },
    get userCount(): number {
      return leases.size;
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      for (const lease of leases) {
        lease.release();
      }
    },
  };
}

/**
 * Builds the targets and tasks, and splices the tasks into the frame graph ahead of the scene pass.
 *
 * @param engine - The engine.
 * @param scene - The scene.
 * @param isFrameGraphBuilt - Whether each task must be recorded now.
 * @param withAlbedo - Whether the geometry pass also writes albedo.
 * @returns The shared state.
 */
function buildSharedInputs(
  engine: EngineContext,
  scene: SceneContext,
  isFrameGraphBuilt: boolean,
  withAlbedo: boolean,
): SharedInputs {
  const depth = createSurfaceRenderTargetTexture(
    engine,
    { lbl: "ignifx:scene-inputs-depth", dFormat: SCENE_INPUT_FORMATS.depth, samples: 1, size: engine },
    withSampledDepthTexture,
  );
  const normals = createSurfaceRenderTargetTexture(engine, {
    lbl: "ignifx:scene-inputs-normals",
    format: SCENE_INPUT_FORMATS.normals,
    samples: 1,
    size: engine,
  });
  const velocity = createSurfaceRenderTargetTexture(engine, {
    lbl: "ignifx:scene-inputs-velocity",
    format: SCENE_INPUT_FORMATS.velocity,
    samples: 1,
    size: engine,
  });
  const albedo = withAlbedo ? createAlbedoTarget(engine) : null;
  const geometryTasks = createGeometryTasks(engine, scene, { depth, normals, velocity, albedo });
  const depthFacade = requireDepthFacade(depth);
  const pyramid = { current: newPyramid(engine, depthFacade) };
  // The pyramid task adopts what it is given and disposes it with the graph; a forwarding object
  // lets the inner pyramid be replaced after a resize or a recovered device.
  const forward: DepthPyramid = {
    get texture(): Texture2D {
      return pyramid.current.texture;
    },
    get mipCount(): number {
      return pyramid.current.mipCount;
    },
    build(source: Texture2D, encoder?: GPUCommandEncoder): void {
      pyramid.current.build(source, encoder);
    },
    resize(width: number, height: number): void {
      pyramid.current.resize(width, height);
    },
    dispose(): void {
      pyramid.current.dispose();
    },
  };
  const pyramidTask = createDepthPyramidTask(engine, scene, { pyramid: forward, source: () => depthFacade });
  Reflect.set(pyramidTask, "name", SCENE_INPUT_TASK_NAMES.depthPyramid);

  const last = insertGeometryTasks(scene, geometryTasks, isFrameGraphBuilt);
  addTaskAfter(scene, pyramidTask, last);
  if (isFrameGraphBuilt) {
    buildFrameGraphTask(getFrameGraph(scene), pyramidTask);
  }

  const listeners = new Set<() => void>();
  const stopResizeWatch = onRenderTargetTextureResize(depth, () => {
    pyramid.current.dispose();
    pyramid.current = newPyramid(engine, depthFacade);
    for (const listener of listeners) {
      listener();
    }
  });
  return {
    depth,
    normals,
    velocity,
    albedo,
    geometryTasks,
    isTornDown: false,
    pyramidTask,
    pyramid,
    listeners,
    stopResizeWatch,
  };
}

/**
 * Creates the albedo target.
 *
 * @param engine - The engine, which is also the surface.
 * @returns The target and its sampled facade.
 */
function createAlbedoTarget(engine: EngineContext): RenderTargetTextureResult {
  return createSurfaceRenderTargetTexture(engine, {
    lbl: "ignifx:scene-inputs-albedo",
    format: SCENE_INPUT_FORMATS.albedo,
    samples: 1,
    size: engine,
  });
}

/**
 * Creates the geometry task and one copy per colour attachment.
 *
 * @param engine - The engine.
 * @param scene - The scene.
 * @param targets - The depth the pass writes and the targets its attachments are copied into.
 * @param targets.depth - The depth target.
 * @param targets.normals - The normals target.
 * @param targets.velocity - The velocity target.
 * @param targets.albedo - The albedo target, or `null` to leave albedo out of the pass.
 * @returns The tasks, in the order they run.
 */
function createGeometryTasks(
  engine: EngineContext,
  scene: SceneContext,
  targets: {
    readonly depth: RenderTargetTextureResult;
    readonly normals: RenderTargetTextureResult;
    readonly velocity: RenderTargetTextureResult;
    readonly albedo: RenderTargetTextureResult | null;
  },
): readonly Task[] {
  const textureDescriptions: { type: GeometryTextureType; format: GPUTextureFormat }[] = [
    { type: GeometryTextureType.WORLD_NORMAL, format: SCENE_INPUT_FORMATS.normals },
    { type: GeometryTextureType.LINEAR_VELOCITY, format: SCENE_INPUT_FORMATS.velocity },
  ];
  if (targets.albedo !== null) {
    textureDescriptions.push({ type: GeometryTextureType.ALBEDO, format: SCENE_INPUT_FORMATS.albedo });
  }
  const geometry = createGeometryRendererTask(
    { name: SCENE_INPUT_TASK_NAMES.geometry, size: engine, depthTexture: targets.depth.rt, textureDescriptions },
    engine,
    scene,
  );
  const tasks: Task[] = [
    geometry,
    createCopyToTextureTask(
      {
        name: SCENE_INPUT_TASK_NAMES.normals,
        sourceTexture: requireAttachment(geometry.geometryWorldNormalTexture, "world normal"),
        targetTexture: targets.normals.rt,
      },
      engine,
      scene,
    ),
    createCopyToTextureTask(
      {
        name: SCENE_INPUT_TASK_NAMES.velocity,
        sourceTexture: requireAttachment(geometry.geometryLinearVelocityTexture, "linear velocity"),
        targetTexture: targets.velocity.rt,
      },
      engine,
      scene,
    ),
  ];
  if (targets.albedo !== null) {
    tasks.push(
      createCopyToTextureTask(
        {
          name: SCENE_INPUT_TASK_NAMES.albedo,
          sourceTexture: requireAttachment(geometry.geometryAlbedoTexture, "albedo"),
          targetTexture: targets.albedo.rt,
        },
        engine,
        scene,
      ),
    );
  }
  return tasks;
}

/**
 * Puts the geometry task at the start of the frame graph and its copies right after it.
 *
 * @param scene - The scene.
 * @param tasks - What {@link createGeometryTasks} made.
 * @param isFrameGraphBuilt - Whether each task must be recorded now.
 * @returns The last task inserted.
 */
function insertGeometryTasks(scene: SceneContext, tasks: readonly Task[], isFrameGraphBuilt: boolean): Task {
  const [geometry, ...copies] = tasks;
  if (geometry === undefined) {
    throw new Error("The scene inputs have no geometry task.");
  }
  addTaskAtStart(scene, geometry);
  let after = geometry;
  for (const copy of copies) {
    addTaskAfter(scene, copy, after);
    after = copy;
  }
  if (isFrameGraphBuilt) {
    const graph = getFrameGraph(scene);
    for (const task of tasks) {
      buildFrameGraphTask(graph, task);
    }
  }
  return after;
}

/**
 * Replaces the geometry task and its copies with ones that also write albedo.
 *
 * @remarks
 * Lite fixes a geometry task's attachments at creation. The depth, normals and velocity targets,
 * and the pyramid task that reads the depth, stay as they are, so no other user has to rebind.
 *
 * A geometry task draws nothing until its `_preload` has imported the code for the scene's
 * material families, which Lite runs at scene registration only
 * (`lib/frame-graph/geometry-renderer-task.js`, `resolveSourceMaterial`). So in a registered scene
 * the new tasks are created first and swapped in once that promise settles, and the old ones draw
 * until then. The albedo target exists from the start and holds nothing until the swap.
 *
 * @param engine - The engine.
 * @param scene - The scene.
 * @param shared - The shared state, updated in place.
 * @param isFrameGraphBuilt - Whether the scene is registered.
 */
function addAlbedo(engine: EngineContext, scene: SceneContext, shared: SharedInputs, isFrameGraphBuilt: boolean): void {
  shared.albedo = createAlbedoTarget(engine);
  const next = createGeometryTasks(engine, scene, shared);
  const swap = (): void => {
    if (shared.isTornDown) {
      disposeTasks(next);
      return;
    }
    carryPreviousViewProjection(shared.geometryTasks[0], next[0]);
    removeTasks(scene, shared.geometryTasks);
    shared.geometryTasks = next;
    insertGeometryTasks(scene, next, isFrameGraphBuilt);
  };
  const preload: unknown = isFrameGraphBuilt ? Reflect.get(next[0] ?? {}, "_preload") : undefined;
  if (typeof preload !== "function") {
    // Not registered yet: `registerScene` preloads every task. Or Lite renamed the method, and the
    // inputs are empty for the frames the task takes to load by itself.
    swap();
    return;
  }
  // A failed load is Lite's to report when the task first draws; the swap happens either way.
  Promise.resolve(Reflect.apply(preload, next[0], [])).then(swap, swap);
}

/**
 * Hands the previous frame's view-projection from one geometry task to its replacement, so the
 * velocity the new task writes in its first frame is measured from the last frame drawn.
 *
 * @remarks
 * The field is private to Lite (`_previousViewProjection`, `lib/frame-graph/geometry-renderer-task.js`)
 * and starts as zeros. If a later Lite renames it, the first frame's velocity is wrong and TAA
 * drops its history for that frame.
 *
 * @param from - The task being replaced.
 * @param to - The task replacing it.
 */
function carryPreviousViewProjection(from: Task | undefined, to: Task | undefined): void {
  const source: unknown = from === undefined ? undefined : Reflect.get(from, "_previousViewProjection");
  const target: unknown = to === undefined ? undefined : Reflect.get(to, "_previousViewProjection");
  if (source instanceof Float32Array && target instanceof Float32Array && source.length === target.length) {
    target.set(source);
  }
}

/**
 * Removes the tasks from the frame graph and frees every task and target.
 *
 * @param scene - The scene.
 * @param shared - What {@link buildSharedInputs} built.
 */
function teardown(scene: SceneContext, shared: SharedInputs): void {
  shared.isTornDown = true;
  shared.stopResizeWatch();
  shared.listeners.clear();
  removeTasks(scene, [...shared.geometryTasks, shared.pyramidTask]);
  // Tasks still waiting for their swap were never in the graph: its callback frees them.
  disposeRenderTargetTexture(shared.depth);
  disposeRenderTargetTexture(shared.normals);
  disposeRenderTargetTexture(shared.velocity);
  if (shared.albedo !== null) {
    disposeRenderTargetTexture(shared.albedo);
  }
}

/**
 * Takes tasks out of the frame graph and disposes them.
 *
 * @param scene - The scene.
 * @param tasks - The tasks.
 */
function removeTasks(scene: SceneContext, tasks: readonly Task[]): void {
  for (const task of tasks) {
    // Disable first: a disposed task that still executes is a use-after-free.
    task.executionEnabled = false;
    removeFrameGraphTask(scene, task);
  }
  disposeTasks(tasks);
}

/**
 * Disposes tasks that are not in a frame graph.
 *
 * @param tasks - The tasks.
 */
function disposeTasks(tasks: readonly Task[]): void {
  for (const task of tasks) {
    task.executionEnabled = false;
    task.dispose();
  }
}

/**
 * Takes a task out of the scene's frame graph.
 *
 * @remarks
 * Lite 1.34 has no public remove (`index.d.ts` 206–217 add only), and a disposed task left in the
 * graph is recorded again by the next `frameGraph.build()` against freed targets. The task list is
 * the private `_tasks` array every `addTask*` splices (`lib/frame-graph/frame-graph-actions.js`).
 * If a later Lite renames it, the task stays in, disabled.
 *
 * @param scene - The scene.
 * @param task - The task to remove.
 */
function removeFrameGraphTask(scene: SceneContext, task: Task): void {
  const tasks = frameGraphTasks(scene);
  const index = tasks?.indexOf(task) ?? -1;
  if (tasks !== null && index >= 0) {
    tasks.splice(index, 1);
  }
}

/**
 * The scene's frame-graph task list, or `null` when Lite no longer exposes it.
 *
 * @param scene - The scene.
 * @returns The live array (Lite's own), or `null`.
 *
 * @internal
 */
export function frameGraphTasks(scene: SceneContext): Task[] | null {
  const tasks: unknown = Reflect.get(getFrameGraph(scene), "_tasks");
  return isTaskList(tasks) ? tasks : null;
}

/**
 * Whether a value is Lite's task array.
 *
 * @param value - The value read from the frame graph.
 * @returns `true` for an array.
 */
function isTaskList(value: unknown): value is Task[] {
  return Array.isArray(value);
}

/**
 * Creates a depth pyramid the size of the depth facade's current texture.
 *
 * @param engine - The engine, whose current device owns the pipelines.
 * @param depth - The depth facade.
 * @returns The pyramid.
 */
function newPyramid(engine: EngineContext, depth: Texture2D): DepthPyramid {
  return createDepthPyramid(engine, { width: depth.width, height: depth.height, reduce: "max" });
}

/**
 * The sampled depth facade of the depth target.
 *
 * @param depth - The depth target, created with `withSampledDepthTexture`.
 * @returns The facade.
 */
function requireDepthFacade(depth: RenderTargetTextureResult): Texture2D {
  if (depth.depthTexture === null) {
    throw new Error("Lite built the scene-inputs depth target without a sampled depth facade.");
  }
  return depth.depthTexture;
}

/**
 * A geometry attachment the task was asked for.
 *
 * @param target - The accessor's value.
 * @param what - The attachment, for the error.
 * @returns The attachment.
 */
function requireAttachment(target: RenderTarget | null, what: string): RenderTarget {
  if (target === null) {
    throw new Error(`Lite's geometry task built no ${what} attachment.`);
  }
  return target;
}
