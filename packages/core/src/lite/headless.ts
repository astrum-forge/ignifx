import {
  createNullEngine,
  createSceneContext,
  disposeScene,
  stepScene,
  type EngineContext,
  type SceneContext,
} from "@babylonjs/lite";
import { ErrorCode, IgnifxError } from "../errors.js";

/**
 * Headless half of the Babylon Lite adapter. Together with `./render.ts` this directory is the only
 * place in the package allowed to import `@babylonjs/lite` (`CONSTITUTION.md` §3.4, coding
 * standards §4). All unit conversion between ignifx seconds and Lite milliseconds happens here
 * (`docs/architecture/00-overview.md` §4).
 */

/** Milliseconds in one second; the only unit conversion this adapter performs. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Babylon Lite objects behind a headless runtime.
 *
 * @remarks
 * Unstable. Lite ships breaking changes in minor releases, so nothing reachable through this
 * property is covered by the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export interface LiteHeadlessHandles {
  /** The Lite null engine backing the runtime. */
  readonly engine: EngineContext;
  /** The Lite scene context advanced by {@link stepHeadless}. */
  readonly scene: SceneContext;
}

/**
 * A GPU-free engine and scene pair used by unit tests, servers, and tools
 * (`CONSTITUTION.md` §3.8). Step it with {@link stepHeadless} and release it with
 * {@link disposeHeadlessRuntime}.
 *
 * @public
 */
export interface HeadlessRuntime {
  /** The unstable Babylon Lite escape hatch. */
  readonly lite: LiteHeadlessHandles;
  /** Whether {@link disposeHeadlessRuntime} has already run. */
  readonly isDisposed: boolean;
}

class HeadlessRuntimeImpl implements HeadlessRuntime {
  readonly #engine: EngineContext;
  readonly #scene: SceneContext;
  #isDisposed = false;

  constructor() {
    this.#engine = createNullEngine();
    this.#scene = createSceneContext(this.#engine, { defaultRenderTask: false });
  }

  get lite(): LiteHeadlessHandles {
    return { engine: this.#engine, scene: this.#scene };
  }

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  step(deltaSeconds: number): void {
    stepScene(this.#engine, this.#scene, deltaSeconds * MILLISECONDS_PER_SECOND);
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    // Verified against @babylonjs/lite@1.27.0: `createNullEngine()` returns an engine that is its
    // own surface but owns no `_context` and no `_device`, while `disposeEngine()` unconditionally
    // calls `surface._context.unconfigure()` and `engine._device.destroy()` — so calling it on a
    // null engine throws. A null engine holds no GPU resources, so disposing the scene is the
    // complete teardown.
    disposeScene(this.#scene);
  }
}

/**
 * Creates a headless runtime: a Babylon Lite null engine plus a scene with no default render task.
 * Two runtimes can exist in the same process without interfering (`CONSTITUTION.md` §3.6).
 *
 * @returns A runtime ready to be stepped.
 *
 * @example
 * ```ts
 * const runtime = createHeadlessRuntime();
 * stepHeadless(runtime, 1 / 60);
 * disposeHeadlessRuntime(runtime);
 * ```
 *
 * @public
 */
export function createHeadlessRuntime(): HeadlessRuntime {
  return new HeadlessRuntimeImpl();
}

/**
 * Advances a headless runtime by one deterministic simulation step.
 *
 * @param runtime - A runtime from {@link createHeadlessRuntime}.
 * @param deltaSeconds - The step length in seconds; the adapter converts it to Lite's milliseconds.
 * @throws IgnifxError with code `IGX-0002` when the runtime is disposed or was not created by ignifx.
 *
 * @public
 */
export function stepHeadless(runtime: HeadlessRuntime, deltaSeconds: number): void {
  const impl = asImpl(runtime);
  if (impl.isDisposed) {
    throw new IgnifxError(ErrorCode.invalidRuntime, "This headless runtime has already been disposed.");
  }
  impl.step(deltaSeconds);
}

/**
 * Releases the scene owned by a headless runtime. Calling it twice is a no-op.
 *
 * @param runtime - A runtime from {@link createHeadlessRuntime}.
 * @throws IgnifxError with code `IGX-0002` when the object was not created by ignifx.
 *
 * @public
 */
export function disposeHeadlessRuntime(runtime: HeadlessRuntime): void {
  asImpl(runtime).dispose();
}

/**
 * Narrows the structural public type to the implementation. The public type is an interface, so
 * the guard has to be nominal rather than shape-based.
 *
 * @param runtime - The candidate runtime handed to a public function.
 * @returns The same object, typed as the implementation.
 */
function asImpl(runtime: HeadlessRuntime): HeadlessRuntimeImpl {
  if (!(runtime instanceof HeadlessRuntimeImpl)) {
    throw new IgnifxError(ErrorCode.invalidRuntime, "This object was not created by createHeadlessRuntime().");
  }
  return runtime;
}
