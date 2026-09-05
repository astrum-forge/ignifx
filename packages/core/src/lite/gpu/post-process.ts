import {
  addTask,
  buildFrameGraphTask,
  createBloomPostProcessTask,
  createImageProcessingTask,
  createRenderTarget,
  createSmaaPostProcessTask,
  getFrameGraph,
} from "@babylonjs/lite";
import type {
  BloomPostProcessTask,
  EngineContext,
  RenderTarget,
  SceneContext,
  SmaaPostProcessTask,
  SurfaceContext,
  Task,
} from "@babylonjs/lite";

/**
 * Post-processing (`docs/architecture/07-rendering.md` §2.7): the three effects the MVP ships —
 * bloom, SMAA, and image processing — and how they are wired into a scene's frame graph.
 *
 * Everything here is `@internal`, and every entry point needs a device.
 *
 * ## How a task joins the frame graph (verified against `@babylonjs/lite@1.27.0`)
 *
 * A scene's frame graph is an ordered array of tasks. `createSceneContext` appends the default
 * render task, named `"scene"`, at creation; `registerSceneWithShadowSupport` unshifts a task named
 * `"shadow"` in front of it (`lib/scene/scene-core.js`). `getFrameGraph(scene)` returns a
 * `FrameGraph` whose public surface is only `build`/`execute`/`dispose` (`index.d.ts` 5367) — **the
 * default render task itself is not reachable through any public API**, so `addTaskAfter(scene,
 * task, sceneRenderTask)` cannot be written. What can be written is `addTask(scene, task)`, which
 * appends to the end of the array (`lib/frame-graph/frame-graph-actions.js`) and therefore already
 * runs after the render task. {@link appendPostProcessTask} is that call, and a chain of effects is
 * built by appending them in order.
 *
 * There is also no public *remove*: `FrameGraph.dispose` frees everything, and individual tasks can
 * only be neutralised. {@link setPostProcessTaskEnabled} flips `Task.executionEnabled`, which makes
 * the frame graph skip every pass of the task while keeping it recorded
 * (`lib/frame-graph/frame-graph.js`), and {@link disposePostProcessTask} frees its GPU resources.
 * A disabled task costs one array entry and one branch per frame. Both gaps are recorded in
 * ADR-0002's validation table.
 *
 * ## Sources and targets
 *
 * Every post-process task takes a `sourceTexture` and writes to a `targetTexture`, defaulting to
 * the surface's swapchain target.
 *
 * **A chain can never read the swapchain.** `createSurface` configures the canvas context with no
 * `usage` (`lib/engine/surface.js` 30), so its texture is `RENDER_ATTACHMENT` only and binding it
 * as a `sourceTexture` fails WebGPU validation, taking the whole frame's command buffer with it.
 * Writing *into* the swapchain is fine, and both a post-process task and a copy task have a special
 * path for it. So a chain reads the offscreen colour the scene was rendered into
 * (`./render-path.ts`) and ping-pongs through {@link createChainColorTarget} links until its last
 * effect writes {@link surfaceRenderTarget}.
 *
 * `createImageProcessingTask` is the exception that shapes the chain's order: it writes
 * `engine.scRT` unconditionally, with no `targetTexture` at all
 * (`lib/frame-graph/image-processing-task.js`), so it can only ever be the **last** effect.
 */

/**
 * A frame-graph task a `PostProcessStack` records, re-exported under an ignifx name so feature code
 * can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4, coding
 * standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @internal
 */
export type LitePostProcessTask = Task;

/**
 * A colour attachment a post-process task reads or writes, re-exported under an ignifx name.
 *
 * @internal
 */
export type LiteRenderTarget = RenderTarget;

/**
 * The bloom settings an ignifx `PostProcessStack` entry declares.
 *
 * @internal
 */
export interface BloomSettings {
  /** How strongly the glow is mixed back in. */
  readonly weight?: number;
  /** The blur kernel width, in pixels. */
  readonly kernel?: number;
  /** The luminance above which a pixel glows. */
  readonly threshold?: number;
  /** An exposure applied while extracting highlights. */
  readonly exposure?: number;
  /** The fraction of full resolution the blur runs at. */
  readonly scale?: number;
}

/**
 * The SMAA settings an ignifx `PostProcessStack` entry declares.
 *
 * @internal
 */
export interface SmaaSettings {
  /** The luma difference that counts as an edge. Lite defaults to 0.05. */
  readonly threshold?: number;
  /** How far the pattern search runs along an edge, in pixels. */
  readonly maxSearchSteps?: number;
  /** Whether 45-degree patterns are detected. Off by default, and Lite measured it as no better. */
  readonly diagonalDetection?: boolean;
  /** Whether corner patterns are attenuated. */
  readonly cornerDetection?: boolean;
  /** Set when the source is an sRGB view, so edge detection re-encodes before taking luma. */
  readonly sourceIsSrgb?: boolean;
}

/**
 * The surface's swapchain render target — where the last effect in a chain writes.
 *
 * @param surface - The surface. The engine is its own primary surface.
 * @returns The colour-only target wrapping the swapchain texture.
 *
 * @internal
 */
export function surfaceRenderTarget(surface: SurfaceContext): RenderTarget {
  return surface.scRT;
}

/**
 * Creates one ping-pong colour target for an effect chain, sized to the surface.
 *
 * @remarks
 * An ordinary `createRenderTarget`, not `createRenderTargetTexture`: the lazy kind is allocated by
 * whichever task first *owns* it as a target (`buildRenderTarget` inside `PostProcessTask.record`),
 * with `RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC | COPY_DST`
 * (`lib/engine/render-target.js`), and its size is re-resolved from the surface on every frame-graph
 * build. That is what lets the chain follow a canvas resize; the eager kind cannot, and Lite refuses
 * a `SurfaceContext` as its size for that reason (error 571).
 *
 * The consequence is an ordering rule the chain already keeps: a link must be **written** by an
 * earlier task than the one that reads it, or the reader finds no colour texture and Lite raises
 * error 107.
 *
 * @param surface - The surface whose colour format and size the target matches.
 * @param label - A debug label for the allocated GPU texture.
 * @returns The target.
 *
 * @internal
 */
export function createChainColorTarget(surface: SurfaceContext, label: string): RenderTarget {
  return createRenderTarget({ lbl: label, format: surface.format, samples: 1, size: surface });
}

/**
 * Creates a bloom task.
 *
 * @param engine - The engine that owns its GPU resources.
 * @param scene - The scene it belongs to.
 * @param source - The colour target it reads.
 * @param target - The colour target it writes, or `null` for the surface swapchain.
 * @param settings - The declared tuning.
 * @returns The task. Insert it with {@link appendPostProcessTask}.
 *
 * @example
 * ```ts
 * const bloom = createBloomTask(engine, scene, sceneColor, surfaceRenderTarget(engine), { threshold: 0.9 });
 * appendPostProcessTask(scene, bloom);
 * ```
 *
 * @internal
 */
export function createBloomTask(
  engine: EngineContext,
  scene: SceneContext,
  source: RenderTarget,
  target: RenderTarget | null,
  settings: BloomSettings,
): BloomPostProcessTask {
  const config: {
    name: string;
    sourceTexture: RenderTarget;
    targetTexture: RenderTarget | null;
    weight?: number;
    kernel?: number;
    threshold?: number;
    exposure?: number;
    bloomScale?: number;
  } = { name: "ignifx:bloom", sourceTexture: source, targetTexture: target };
  if (settings.weight !== undefined) {
    config.weight = settings.weight;
  }
  if (settings.kernel !== undefined) {
    config.kernel = settings.kernel;
  }
  if (settings.threshold !== undefined) {
    config.threshold = settings.threshold;
  }
  if (settings.exposure !== undefined) {
    config.exposure = settings.exposure;
  }
  if (settings.scale !== undefined) {
    config.bloomScale = settings.scale;
  }
  return createBloomPostProcessTask(config, engine, scene);
}

/**
 * Creates a subpixel morphological anti-aliasing task.
 *
 * @remarks
 * SMAA needs a single-sample source (Lite error 108), so an MSAA scene must resolve first. The
 * offscreen render path always hands the chain the resolved single-sample colour
 * (`./render-path.ts`, the render task's `rst`).
 *
 * @param engine - The engine that owns its GPU resources.
 * @param scene - The scene it belongs to.
 * @param source - The colour target it reads.
 * @param target - The colour target it writes, or `null` for the surface swapchain.
 * @param settings - The declared tuning.
 * @returns The task.
 *
 * @internal
 */
export function createSmaaTask(
  engine: EngineContext,
  scene: SceneContext,
  source: RenderTarget,
  target: RenderTarget | null,
  settings: SmaaSettings,
): SmaaPostProcessTask {
  const config: {
    name: string;
    sourceTexture: RenderTarget;
    targetTexture: RenderTarget | null;
    threshold?: number;
    maxSearchSteps?: number;
    diagonalDetection?: boolean;
    cornerDetection?: boolean;
    sourceIsSrgb?: boolean;
  } = { name: "ignifx:smaa", sourceTexture: source, targetTexture: target };
  if (settings.threshold !== undefined) {
    config.threshold = settings.threshold;
  }
  if (settings.maxSearchSteps !== undefined) {
    config.maxSearchSteps = settings.maxSearchSteps;
  }
  if (settings.diagonalDetection !== undefined) {
    config.diagonalDetection = settings.diagonalDetection;
  }
  if (settings.cornerDetection !== undefined) {
    config.cornerDetection = settings.cornerDetection;
  }
  if (settings.sourceIsSrgb !== undefined) {
    config.sourceIsSrgb = settings.sourceIsSrgb;
  }
  return createSmaaPostProcessTask(config, engine, scene);
}

/**
 * Creates a task that applies the scene's exposure, contrast, and tone mapping as a full-screen
 * pass, straight onto the swapchain.
 *
 * @remarks
 * It has no target of its own: `execute` begins a render pass on `engine.scRT._colorView` every
 * frame (`lib/frame-graph/image-processing-task.js`), so it is always the last task of a chain. It
 * samples with `textureLoad` at the fragment's own pixel coordinate, so `source` must be the same
 * size as the swapchain — which every target sized to the surface is.
 *
 * Only needed when the scene has no `Environment` component driving `setSceneImageProcessing`; the
 * two are alternatives, not a chain (`docs/architecture/07-rendering.md` §2.7).
 *
 * @param engine - The engine that owns its GPU resources.
 * @param scene - The scene it belongs to.
 * @param source - The colour target it grades. `resolveImageProcessingTexture` accepts a
 * `RenderTarget` and reads its colour texture.
 * @returns The task.
 *
 * @internal
 */
export function createImageProcessingPass(engine: EngineContext, scene: SceneContext, source: RenderTarget): Task {
  return createImageProcessingTask({ name: "ignifx:image-processing", source }, engine, scene);
}

/**
 * Appends a post-process task to a scene's frame graph, after the render pass and after every task
 * appended before it, and records it so it runs from the next frame.
 *
 * @remarks
 * `addTask` only puts the task in the array; its passes are recorded when the frame graph is built.
 * `buildFrameGraphTask` (`index.d.ts` 1403) records and initialises **just this task**, which is
 * what makes a task added to a live scene take effect without rebuilding — and reallocating — every
 * other task's resources.
 *
 * @param scene - The scene whose frame graph to extend.
 * @param task - The task to append.
 *
 * @internal
 */
export function appendPostProcessTask(scene: SceneContext, task: Task): void {
  addTask(scene, task);
  buildFrameGraphTask(getFrameGraph(scene), task);
}

/**
 * Switches a post-process task on or off without removing it from the frame graph.
 *
 * @remarks
 * The only way to stop a task: Lite exposes no removal. A disabled task keeps its GPU resources and
 * its recorded passes, and costs one branch per frame.
 *
 * @param task - The task to gate.
 * @param enabled - `false` to skip every pass of the task.
 *
 * @internal
 */
export function setPostProcessTaskEnabled(task: Task, enabled: boolean): void {
  task.executionEnabled = enabled;
}

/**
 * Frees a post-process task's GPU resources.
 *
 * @remarks
 * Disable it first: the task stays in the frame graph, and a disposed task that still executes is a
 * use-after-free.
 *
 * @param task - The task to release.
 *
 * @internal
 */
export function disposePostProcessTask(task: Task): void {
  task.dispose();
}
