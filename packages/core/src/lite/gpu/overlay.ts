import {
  addTask,
  addToScene,
  buildFrameGraphTask,
  createHemisphericLight,
  createRenderTarget,
  createRenderTask,
  createSceneContext,
  disposeScene,
  getFrameGraph,
  getRenderingContexts,
  onBeforeRender,
  registerScene,
  unregisterScene,
} from "@babylonjs/lite";
import type { EngineContext, RenderTask, SceneContext } from "@babylonjs/lite";

/**
 * The render overlay (`docs/architecture/07-rendering.md` §2.10, ADR-0031): a second Lite scene drawn
 * over the finished frame, for an editor's gizmos, selection outlines and other helpers.
 *
 * Everything here needs a device.
 *
 * ## Why core does not call `createUtilityLayer`
 *
 * `createUtilityLayer` (`index.d.ts` 4109) builds its scene with Lite's default render task, and
 * `registerScene` (11268) then fixes that task up against the **last** registered rendering
 * context (`lib/scene/swapchain-overlay.js` 11). Two things go wrong in an ignifx app (editor spike
 * S0.2 §3.2):
 *
 * - When `@ignifx/ui`'s text renderer or `@ignifx/2d`'s sprite renderer was registered after the
 *   render scene, it is the last context. It has no frame graph, so Lite configures nothing and the
 *   layer's task clears the frame to transparent black.
 * - With MSAA on, Lite borrows the base scene's multisampled colour view, and switches the layer
 *   off unless that scene resolves straight into the swapchain (`swapchain-overlay.js` 19-27). With
 *   `rendering.features.postProcessing` the render scene resolves into an offscreen target, so the
 *   layer never draws.
 *
 * ## What this module builds instead
 *
 * Only public Lite calls:
 *
 * 1. A scene with no default render task (`createSceneContext`, 3663) that shares the render
 *    scene's camera, plus the hemispheric light `createUtilityLayer` would add, so Lite's gizmo
 *    materials look the same.
 * 2. `registerScene` while its frame graph is **empty**. Lite's fix-up looks for a task that targets
 *    the swapchain (`swapchain-overlay.js` 5-7), finds none, and changes nothing.
 * 3. One render task (`createRenderTask`, 3620) added afterwards and recorded with
 *    `buildFrameGraphTask` (1501). It draws into the swapchain with `clr: false`, so it keeps the
 *    frame's colour, and `sharedRt: true`, so it never builds or frees the swapchain target
 *    (`RenderTaskConfig`, 11635). It has a single-sample depth target of its own, which it clears,
 *    so helpers draw on top of the scene. It never touches the scene's targets, so the scene's MSAA
 *    setting and render path do not matter: it reads whatever the frame's last pass presented.
 *
 * ## Staying last
 *
 * Lite renders the contexts in registration order (`renderFrame`, `lib/engine/engine.js` 246-251),
 * and the 2D and UI extensions register theirs lazily, when the first sprite or text appears. A
 * sprite renderer in `"sprite"` mode clears the frame, so one registered after the overlay would
 * erase it. Each frame the overlay checks `getRenderingContexts` (6921); when a context other than
 * another overlay follows it, it moves itself to the end after the frame: unregister, drop its task
 * so the re-registration again finds no swapchain task, register, and build a fresh task. The frame
 * in between draws no overlay.
 *
 * A screenshot is taken after every context has recorded (`_captureService`, same function), so it
 * includes the overlay.
 */

/** The depth/stencil format Lite's own single-sample scene task uses (`lib/scene/scene-core.js` 76-77). */
const DEPTH_STENCIL_FORMAT: GPUTextureFormat = "depth24plus-stencil8";

/** The name the overlay's task carries in Lite's frame graph and in per-task GPU timings. */
export const OVERLAY_TASK_NAME = "ignifx:overlay";

/** The light `createUtilityLayer` adds by default (`lib/gizmo/utility-layer.js` 24-36). */
const LIGHT_INTENSITY = 2;

/** The ground colour of that light. */
const LIGHT_GROUND = 0.5;

/**
 * The overlay scene and the render scene, in the shape Lite's gizmo constructors take as a
 * `UtilityLayer` (`index.d.ts` 15747).
 *
 * @internal
 */
export interface OverlaySceneHandles {
  /** The overlay scene. Add helpers to it. */
  readonly scene: SceneContext;
  /** The render scene, whose camera the overlay scene follows. */
  readonly mainScene: SceneContext;
}

/**
 * An open overlay scene.
 *
 * @internal
 */
export interface OverlayScene {
  /** The Lite scenes. */
  readonly lite: OverlaySceneHandles;
  /** Unregisters and disposes the overlay scene, its task and its depth target. Idempotent. */
  dispose(): void;
}

/**
 * Builds an overlay scene and registers it after every rendering context on the surface.
 *
 * @remarks
 * Call it only after the render scene is registered: the overlay draws after it because it is
 * registered after it.
 *
 * @param engine - The WebGPU engine, which is also the primary surface.
 * @param mainScene - The render scene whose camera the overlay follows.
 * @param isPeer - Answers whether a rendering context is another overlay, which may follow this one.
 * @param onDispose - Called once when the overlay is disposed.
 * @returns The overlay, drawing from the next frame.
 *
 * @example
 * ```ts
 * const overlay = await openOverlayScene(engine, scene, () => false, () => {});
 * overlay.dispose();
 * ```
 *
 * @internal
 */
export async function openOverlayScene(
  engine: EngineContext,
  mainScene: SceneContext,
  isPeer: (context: object) => boolean,
  onDispose: () => void,
): Promise<OverlayScene> {
  const overlay = new LiteOverlayScene(engine, mainScene, isPeer, onDispose);
  await overlay.attach();
  return overlay;
}

/** The overlay scene, its registration and its place in the context list. */
class LiteOverlayScene implements OverlayScene {
  readonly lite: OverlaySceneHandles;

  readonly #engine: EngineContext;

  readonly #scene: SceneContext;

  readonly #isPeer: (context: object) => boolean;

  readonly #onDispose: () => void;

  #isDisposed = false;

  #isMoving = false;

  /**
   * Creates the scene, with the light `createUtilityLayer` would add, following the render scene's
   * camera. It is not registered yet.
   *
   * @param engine - The WebGPU engine.
   * @param mainScene - The render scene.
   * @param isPeer - Answers whether a rendering context is another overlay.
   * @param onDispose - Called once when the overlay is disposed.
   */
  constructor(
    engine: EngineContext,
    mainScene: SceneContext,
    isPeer: (context: object) => boolean,
    onDispose: () => void,
  ) {
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    scene.name = OVERLAY_TASK_NAME;
    scene.camera = mainScene.camera;
    const light = createHemisphericLight([0, 1, 0], LIGHT_INTENSITY);
    light.groundColor = [LIGHT_GROUND, LIGHT_GROUND, LIGHT_GROUND];
    addToScene(scene, light);
    this.lite = { scene, mainScene };
    this.#engine = engine;
    this.#scene = scene;
    this.#isPeer = isPeer;
    this.#onDispose = onDispose;
    onBeforeRender(scene, () => {
      // The render scene's camera can change from frame to frame (the highest-priority `Camera` wins).
      if (scene.camera !== mainScene.camera) {
        scene.camera = mainScene.camera;
      }
      this.#keepLast();
    });
  }

  /**
   * Registers the scene at the end of the context list and builds its task.
   *
   * @returns A promise that settles once the overlay draws from the next frame.
   */
  async attach(): Promise<void> {
    // Registered while its frame graph is empty, so Lite's swapchain fix-up finds nothing to change.
    await registerScene(this.#scene);
    if (this.#isDisposed) {
      return;
    }
    const task = createOverlayTask(this.#engine, this.#scene);
    addTask(this.#scene, task);
    buildFrameGraphTask(getFrameGraph(this.#scene), task);
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    unregisterScene(this.#scene);
    disposeScene(this.#scene);
    this.#onDispose();
  }

  /** Schedules a move to the end of the context list when a context that is not an overlay follows. */
  #keepLast(): void {
    if (this.#isMoving || !this.#isFollowed()) {
      return;
    }
    // Not now: Lite is walking the context list. The microtask runs once the frame has been submitted.
    this.#isMoving = true;
    queueMicrotask(() => {
      void this.#moveToEnd().finally(() => {
        this.#isMoving = false;
      });
    });
  }

  /**
   * Whether a rendering context other than another overlay is registered after this one.
   *
   * @returns `true` when the overlay has to move.
   */
  #isFollowed(): boolean {
    const contexts = getRenderingContexts(this.#engine);
    for (let index = contexts.indexOf(this.#scene) + 1; index < contexts.length; index += 1) {
      const context = contexts[index];
      if (context !== undefined && !this.#isPeer(context)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Re-registers the overlay at the end of the context list.
   *
   * @returns A promise that settles once it draws last.
   */
  async #moveToEnd(): Promise<void> {
    if (this.#isDisposed) {
      return;
    }
    unregisterScene(this.#scene);
    // Disposing the graph drops the task, which also frees its depth target.
    getFrameGraph(this.#scene).dispose();
    await this.attach();
  }
}

/**
 * Creates the overlay's render task: into the swapchain, keeping its colour, over a depth buffer of
 * its own that it clears.
 *
 * @param engine - The engine.
 * @param scene - The overlay scene.
 * @returns The task, not yet added to a frame graph.
 */
function createOverlayTask(engine: EngineContext, scene: SceneContext): RenderTask {
  return createRenderTask(
    {
      name: OVERLAY_TASK_NAME,
      rt: engine.scRT,
      sharedRt: true,
      depth: createRenderTarget({
        lbl: "ignifx:overlay-depth",
        dFormat: DEPTH_STENCIL_FORMAT,
        samples: 1,
        size: engine,
      }),
      clr: false,
    },
    engine,
    scene,
  );
}
