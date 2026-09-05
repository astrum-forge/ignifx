import { createEngine, disposeEngine, type EngineContext } from "@babylonjs/lite";
import { ErrorCode, IgnifxError } from "../errors.js";
import { isWebGpuAvailable, type RenderSurface } from "../webgpu.js";

/**
 * Rendering half of the Babylon Lite adapter. Everything here needs a real GPU, so it is exercised
 * by the Vitest `browser` project (`*.browser.test.ts`) rather than the node project.
 */

/**
 * Babylon Lite objects behind a rendering runtime.
 *
 * @remarks
 * Unstable, for the same reason as `LiteHeadlessHandles`: Lite ships breaking changes in minor
 * releases and this escape hatch carries no stability guarantee.
 *
 * @public
 */
export interface LiteRenderHandles {
  /** The Lite WebGPU engine bound to the canvas. Lite's engine is also its primary surface. */
  readonly engine: EngineContext;
}

/**
 * A WebGPU engine bound to a canvas. Release it with {@link disposeRenderEngine}.
 *
 * @public
 */
export interface RenderRuntime {
  /** The unstable Babylon Lite escape hatch. */
  readonly lite: LiteRenderHandles;
  /** Whether {@link disposeRenderEngine} has already run. */
  readonly isDisposed: boolean;
}

class RenderRuntimeImpl implements RenderRuntime {
  readonly #engine: EngineContext;
  #isDisposed = false;

  constructor(engine: EngineContext) {
    this.#engine = engine;
  }

  get lite(): LiteRenderHandles {
    return { engine: this.#engine };
  }

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    disposeEngine(this.#engine);
  }
}

/**
 * Creates a WebGPU engine bound to `canvas`. The capability probe runs first so that an unsupported
 * browser produces an ignifx error with code `IGX-0001` instead of an opaque Babylon Lite failure.
 *
 * @param canvas - The canvas or offscreen canvas to render into.
 * @returns A runtime owning the engine.
 * @throws IgnifxError with code `IGX-0001` when WebGPU is unavailable.
 *
 * @example
 * ```ts
 * const runtime = await createRenderEngine(document.querySelector("canvas"));
 * disposeRenderEngine(runtime);
 * ```
 *
 * @public
 */
export async function createRenderEngine(canvas: RenderSurface): Promise<RenderRuntime> {
  if (!isWebGpuAvailable()) {
    throw new IgnifxError(
      ErrorCode.webGpuUnavailable,
      "WebGPU is not available in this environment. ignifx renders only through WebGPU; " +
        "check isWebGpuAvailable() before creating an engine.",
    );
  }
  const engine = await createEngine(canvas);
  return new RenderRuntimeImpl(engine);
}

/**
 * Releases the engine owned by a rendering runtime. Calling it twice is a no-op.
 *
 * @param runtime - A runtime from {@link createRenderEngine}.
 * @throws IgnifxError with code `IGX-0002` when the object was not created by ignifx.
 *
 * @public
 */
export function disposeRenderEngine(runtime: RenderRuntime): void {
  if (!(runtime instanceof RenderRuntimeImpl)) {
    throw new IgnifxError(ErrorCode.invalidRuntime, "This object was not created by createRenderEngine().");
  }
  runtime.dispose();
}
