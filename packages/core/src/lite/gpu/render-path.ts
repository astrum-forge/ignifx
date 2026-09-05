import { addTask, createCopyToTextureTask, createRenderTarget, createRenderTask } from "@babylonjs/lite";
import type { EngineContext, RenderTarget, SceneContext, Task } from "@babylonjs/lite";

/**
 * The offscreen render path (`docs/architecture/07-rendering.md` §2.7): the frame graph a scene gets
 * when the project declares `rendering.features.postProcessing`.
 *
 * Everything here needs a device.
 *
 * ## Why the default render task is not good enough
 *
 * `createSceneContext` appends a task named `"scene"` that draws straight into the surface's
 * swapchain target — `surface.scRT` for a single-sample surface, or an MSAA colour target that
 * resolves into `scRT` (`lib/scene/scene-core.js` 74-79). Either way the scene's colour ends up in
 * the swapchain texture, and a post-process pass cannot read it: `createSurface` configures the
 * canvas context with no `usage` (`lib/engine/surface.js` 30), so the swapchain texture is
 * `RENDER_ATTACHMENT` only. Binding it as a sampled texture fails WebGPU validation, the whole
 * frame's command buffer is rejected, and the page presents black. That is exactly what the Phase 2
 * visual suite measured, and it is why this module exists.
 *
 * Lite offers no way to retarget the default task after the fact — `RenderTaskConfig.rt` is read
 * when the task is created, and `FrameGraph`'s public surface is only `build`/`execute`/`dispose`
 * (`index.d.ts` 5367). So the scene is created with `defaultRenderTask: false` and this module
 * builds the replacement.
 *
 * ## The graph it builds
 *
 * ```text
 * [shadow] → scene ──→ sceneColor ──→ present ──→ swapchain
 *                          └─ (a PostProcessStack appends its effects here, and disables present)
 * ```
 *
 * - `scene` is a normal `createRenderTask`. With MSAA it draws into a multisampled colour target
 *   that owns its depth and resolves into `sceneColor` through `rst`; without MSAA it draws into
 *   `sceneColor` directly with a separate depth target, which is the same split Lite's own default
 *   uses (`RenderTaskConfig.depth`, `index.d.ts` 9782).
 * - `sceneColor` is an ordinary `createRenderTarget`, so `buildRenderTarget` allocates it with
 *   `RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC | COPY_DST` (`lib/engine/render-target.js`) —
 *   the `TEXTURE_BINDING` the swapchain lacks.
 * - `present` is a `createCopyToTextureTask` from `sceneColor` to the swapchain. Copying *into* the
 *   swapchain is supported and takes the blit path (`lib/frame-graph/copy-to-texture-task.js`,
 *   `swapAsView`); copying *out of* it is refused (Lite error 80), which is the same limit stated
 *   from the other side.
 * - The swapchain is written every frame whatever else happens: with no chain, `present` does it;
 *   with a chain, the chain's last effect does it and `present` is switched off
 *   ({@link ScenePresenter.setPresentEnabled}).
 *
 * ## Resize
 *
 * Every target here is sized by passing the **surface** as `RenderTargetDescriptor.size`, which
 * `resolveSize` re-reads from `canvas.width`/`canvas.height` on every `buildRenderTarget`
 * (`lib/engine/render-target.js`). A surface resize calls the scene's `_resize`, which is
 * `frameGraph.build()` (`lib/scene/scene-core.js` 67-68): every target is reallocated at the new
 * size and every task re-records, which is also what refreshes the bind groups that captured the old
 * texture views. Nothing here has to observe the canvas itself, and nothing is eagerly allocated —
 * `createRenderTargetTexture` would be, and Lite rejects a surface as its size for exactly that
 * reason.
 */

/** The depth/stencil format Lite's own default render task uses (`lib/scene/scene-core.js` 76-77). */
const DEPTH_STENCIL_FORMAT: GPUTextureFormat = "depth24plus-stencil8";

/**
 * A scene's offscreen render path: the colour a `PostProcessStack` reads, and the compositing blit
 * it takes over from.
 *
 * @internal
 */
export interface ScenePresenter {
  /**
   * The single-sample colour target the scene ends up in — resolved when MSAA is on. It carries
   * `TEXTURE_BINDING`, so it is a legal `sourceTexture` for a post-process task.
   */
  readonly sceneColor: RenderTarget;
  /** The surface's swapchain target, where the last pass of the frame has to land. */
  readonly swapchain: RenderTarget;
  /**
   * Switches the compositing blit on or off.
   *
   * @param enabled - `false` while an effect chain writes the swapchain itself.
   */
  setPresentEnabled(enabled: boolean): void;
  /** Whether the compositing blit currently runs. */
  readonly isPresentEnabled: boolean;
}

/**
 * Builds the scene's render task into an offscreen target and the blit that composites it, and
 * appends both to the scene's frame graph.
 *
 * @remarks
 * Call it immediately after `createSceneContext(engine, { defaultRenderTask: false })` and before
 * `registerScene`: `addTask` appends, so calling it first is what puts `"scene"` ahead of everything
 * a feature adds later, and `registerSceneWithShadowSupport` still unshifts its own `"shadow"` task
 * in front of both.
 *
 * @param engine - The engine, which is also the primary surface.
 * @param scene - The scene created with no default render task.
 * @returns The presenter a `PostProcessStack` builds its chain against.
 *
 * @example
 * ```ts
 * const scene = createSceneContext(engine, { defaultRenderTask: false });
 * const presenter = installOffscreenRenderPath(engine, scene);
 * ```
 *
 * @internal
 */
export function installOffscreenRenderPath(engine: EngineContext, scene: SceneContext): ScenePresenter {
  const isMultisampled = engine.msaaSamples > 1;
  const sceneColor = createRenderTarget({
    lbl: "ignifx:scene-color",
    format: engine.format,
    samples: 1,
    size: engine,
  });
  const colorTarget = isMultisampled
    ? createRenderTarget({
        lbl: "ignifx:scene-color-msaa",
        format: engine.format,
        dFormat: DEPTH_STENCIL_FORMAT,
        samples: engine.msaaSamples,
        size: engine,
      })
    : sceneColor;
  const config: {
    name: string;
    rt: RenderTarget;
    rst?: RenderTarget;
    depth?: RenderTarget;
  } = { name: "scene", rt: colorTarget };
  if (isMultisampled) {
    config.rst = sceneColor;
  } else {
    // A colour target that carries no `dFormat` allocates no depth of its own, so the pass needs a
    // separate one — the arrangement Lite's own single-sample default task uses.
    config.depth = createRenderTarget({
      lbl: "ignifx:scene-depth",
      dFormat: DEPTH_STENCIL_FORMAT,
      samples: 1,
      size: engine,
    });
  }
  addTask(scene, createRenderTask(config, engine, scene));

  const present: Task = createCopyToTextureTask(
    { name: "ignifx:present", sourceTexture: sceneColor, targetTexture: engine.scRT },
    engine,
    scene,
  );
  addTask(scene, present);

  let isPresentEnabled = true;
  return {
    sceneColor,
    swapchain: engine.scRT,
    setPresentEnabled(enabled: boolean): void {
      isPresentEnabled = enabled;
      present.executionEnabled = enabled;
    },
    get isPresentEnabled(): boolean {
      return isPresentEnabled;
    },
  };
}
