import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { isWebGpuAvailable } from "../platform/webgpu.js";
import { installOffscreenRenderPath } from "./gpu/render-path.js";
import { createWebGpuEngine, disposeWebGpuEngine } from "./render.js";
import { createHeadlessScene, createRenderScene, disposeSceneOnly } from "./scene.js";
import type { ScenePresenter } from "./gpu/render-path.js";
import type { LiteEngine, LiteScene } from "./scene.js";
import type { RenderSurface } from "../platform/webgpu.js";
import type { EngineOptions } from "@babylonjs/lite";

/**
 * The engine/scene pair an app is built on, and the WebGPU capability gate in front of it
 * (`docs/architecture/01-lifecycle-and-time.md` §1, ADR-0001, ADR-0009). This is what `createApp`
 * calls; it is the only place that decides between the null engine and a real device.
 *
 * Everything here is `@internal`; the app exposes the objects through its documented `.lite`
 * escape hatch and nothing else.
 */

/** A Lite engine and the scene a world renders into. */
export interface EngineHandles {
  /** The engine: a WebGPU engine, or Lite's null engine in headless mode. */
  readonly engine: LiteEngine;
  /** The scene the world's entities live in. */
  readonly scene: LiteScene;
  /** `true` when the engine is the null engine and there is nothing to present to. */
  readonly isHeadless: boolean;
  /**
   * The offscreen render path, when the project declared `rendering.features.postProcessing`;
   * `null` when the scene renders straight into the swapchain the way Lite does by default.
   */
  readonly presenter: ScenePresenter | null;
}

/**
 * Refuses to continue when the host has no WebGPU entry point. ignifx renders only through WebGPU
 * (`CONSTITUTION.md` §1.1), so this is the gate every rendering path runs first.
 *
 * @throws IgnifxError with code `IGX-0701` when `navigator.gpu` is absent.
 *
 * @internal
 */
export function assertWebGpuAvailable(): void {
  if (isWebGpuAvailable()) {
    return;
  }
  throw new IgnifxError(CoreErrorCode.webGpuUnavailable, "WebGPU is not available in this environment.", {
    hint: "Check isWebGpuAvailable() before calling createApp({ canvas }), or run headless instead.",
  });
}

/**
 * Builds the null engine and the scene a headless app runs on
 * (`docs/architecture/01-lifecycle-and-time.md` §8): components that wrap Lite objects still
 * construct, and no GPU work is ever recorded.
 *
 * @returns The engine and scene, marked headless.
 *
 * @example
 * ```ts
 * const handles = createHeadlessEngine();
 * disposeEngineHandles(handles);
 * ```
 *
 * @internal
 */
export function createHeadlessEngine(): EngineHandles {
  const headless = createHeadlessScene();
  return { engine: headless.engine, scene: headless.scene, isHeadless: true, presenter: null };
}

/**
 * Builds a WebGPU engine bound to a canvas and the render scene a world draws into.
 *
 * @remarks
 * `postProcessing` is decided here rather than in `app.start()` with the other rendering features,
 * because it chooses between two frame graphs and a frame graph is built inside `createSceneContext`
 * (`./gpu/render-path.ts`). Everything else about it — the `PostProcessStack` component, the
 * `IGX-0710` guard — hangs off that one decision.
 *
 * @param canvas - The canvas or offscreen canvas to render into.
 * @param options - Device and surface options; see `createWebGpuEngine`.
 * @param features - Which render path to build.
 * @param features.postProcessing - `true` to render into an offscreen target and composite it.
 * @returns The engine, the scene, and the presenter when there is one.
 * @throws IgnifxError with code `IGX-0701` when WebGPU is unavailable.
 *
 * @internal
 */
export async function createRenderEngine(
  canvas: RenderSurface,
  options?: EngineOptions,
  features?: { readonly postProcessing?: boolean },
): Promise<EngineHandles> {
  assertWebGpuAvailable();
  const engine = await createWebGpuEngine(canvas, options);
  const offscreen = features?.postProcessing === true;
  const scene = createRenderScene(engine, { offscreen });
  return {
    engine,
    scene,
    isHeadless: false,
    presenter: offscreen ? installOffscreenRenderPath(engine, scene) : null,
  };
}

/**
 * Releases an engine and its scene, in the order `docs/architecture/07-rendering.md` §7 requires:
 * the scene first, the engine last.
 *
 * @remarks
 * A null engine is never handed to `disposeEngine`: it owns no `_context` and no `_device`, and
 * Lite's disposer reaches for both (ADR-0009 Validation). Disposing its scene is the complete
 * teardown.
 *
 * @param handles - What {@link createHeadlessEngine} or {@link createRenderEngine} returned.
 *
 * @internal
 */
export function disposeEngineHandles(handles: EngineHandles): void {
  disposeSceneOnly(handles.scene);
  if (!handles.isHeadless) {
    disposeWebGpuEngine(handles.engine);
  }
}
