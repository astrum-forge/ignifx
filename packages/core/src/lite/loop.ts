import {
  onBeforeRender,
  registerScene,
  startEngine,
  stepScene,
  stopEngine,
  type EngineContext,
  type SceneContext,
} from "@babylonjs/lite";

/**
 * Frame-driving half of the Babylon Lite adapter: the one before-render callback ignifx registers
 * per world, the headless step, and the browser render loop
 * (`docs/architecture/01-lifecycle-and-time.md` §1, ADR-0003).
 *
 * Everything here is `@internal`; the kernel's `App` is the public surface.
 *
 * ## What Lite does with a before-render callback (verified against `@babylonjs/lite@1.27.0`
 * `lib/scene/scene-core.js` and `lib/engine/null-engine.js`)
 *
 * - `onBeforeRender(scene, cb)` is `scene._beforeRender.unshift(cb)` and the list is walked
 *   front-to-back, so **callbacks registered later run earlier**. Everything Lite registers itself
 *   — the Havok step in `createHavokWorld`, sprite animation, flow graphs — also unshifts, so the
 *   rule is uniform: last registration wins the front of the frame.
 * - There is no unregister function. Lite's own subscribers keep a private closure over
 *   `_beforeRender` and splice themselves out; the public API exposes nothing, which is why
 *   {@link registerFrameCallback} returns a handle guarding a flag instead (ADR-0003).
 * - The delta a callback receives is `scene.fixedDeltaMs > 0 ? scene.fixedDeltaMs :
 *   engine._currentDelta`, and `stepScene(engine, scene, deltaMs)` is exactly
 *   `engine._currentDelta = deltaMs; scene._update()`. ignifx leaves `fixedDeltaMs` at its default
 *   of `0`, so the value {@link runFrame} converts is the value the callback receives, bit for bit.
 */

/** Milliseconds in one second; the only unit conversion this adapter performs (00 §4). */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * The registration returned by {@link registerFrameCallback}. Lite cannot unregister a before-render
 * callback, so the wrapper it holds forever consults this handle and becomes a no-op once
 * {@link unregisterFrameCallback} has run.
 *
 * @internal
 */
export interface FrameCallbackHandle {
  /** Whether the wrapper still forwards frames to the callback. */
  readonly isActive: boolean;
}

/** The same handle from inside this module, where the flag is writable. */
interface MutableFrameCallbackHandle {
  /** Whether the wrapper still forwards frames to the callback. */
  isActive: boolean;
}

/**
 * Registers the **one** Lite before-render callback a world owns
 * (`docs/architecture/01-lifecycle-and-time.md` §1). The whole ignifx frame runs inside it.
 *
 * @remarks
 * Because Lite runs later registrations first, the world registers after every extension has
 * finished `register()` and before `startEngine`, which puts the ignifx frame at the front of the
 * scene's callback list. Extensions never call this themselves.
 *
 * @param scene - The scene to drive; for a world that is the render scene.
 * @param callback - Receives the frame delta **in milliseconds**, exactly as Lite delivers it.
 * @returns A handle that can deactivate the callback.
 *
 * @example
 * ```ts
 * const handle = registerFrameCallback(scene, (deltaMs) => runIgnifxFrame(deltaMs / 1000));
 * unregisterFrameCallback(handle); // the Lite-held closure survives but does nothing
 * ```
 *
 * @internal
 */
export function registerFrameCallback(scene: SceneContext, callback: (deltaMs: number) => void): FrameCallbackHandle {
  const handle: MutableFrameCallbackHandle = { isActive: true };
  onBeforeRender(scene, (deltaMs: number): void => {
    if (handle.isActive) {
      callback(deltaMs);
    }
  });
  return handle;
}

/**
 * Deactivates a frame callback. The closure Lite holds stays in `scene._beforeRender` for the life
 * of the scene — Lite offers no way to remove it — but it stops calling through, so the only
 * residue is one predictable branch per frame. Calling this twice is a no-op.
 *
 * @param handle - A handle from {@link registerFrameCallback}.
 *
 * @internal
 */
export function unregisterFrameCallback(handle: FrameCallbackHandle): void {
  // The public type keeps the flag read-only so nothing outside this module can flip it; readonly
  // does not affect assignability, so no type assertion is needed to widen it here.
  const mutable: MutableFrameCallbackHandle = handle;
  mutable.isActive = false;
}

/**
 * Runs one frame of a scene headlessly: converts ignifx seconds to Lite milliseconds and fires the
 * scene's before-render callbacks. No GPU work is recorded or submitted.
 *
 * @remarks
 * This is the headless driver behind `app.step(deltaSeconds)`
 * (`docs/architecture/01-lifecycle-and-time.md` §8) and the driver ignifx uses for the physics
 * simulation scene in every mode (ADR-0003). The delta arrives at the callback unchanged, so
 * `runFrame(engine, scene, 1 / 60)` delivers exactly `1000 / 60` — the two are the same double.
 * That holds only while `scene.fixedDeltaMs` is `0`, its default; setting it makes Lite ignore the
 * step delta entirely, so ignifx never touches it.
 *
 * @param engine - The engine that owns the scene; a null engine in headless mode.
 * @param scene - The scene to advance.
 * @param deltaSeconds - The step length in seconds.
 *
 * @internal
 */
export function runFrame(engine: EngineContext, scene: SceneContext, deltaSeconds: number): void {
  stepScene(engine, scene, deltaSeconds * MILLISECONDS_PER_SECOND);
}

/**
 * Starts Lite's requestAnimationFrame render loop: registers the scene with the engine, then starts
 * the engine. Resolves once the first frame has been rendered.
 *
 * @remarks
 * Browser and Electron only — a null engine has no render loop, and headless mode calls
 * {@link runFrame} instead. Every frame callback must already be registered when this is called;
 * scenes registered later join on subsequent frames.
 *
 * @param engine - The WebGPU engine to start.
 * @param scene - The scene to register before the first frame.
 *
 * @internal
 */
export async function startRenderLoop(engine: EngineContext, scene: SceneContext): Promise<void> {
  await registerScene(scene);
  await startEngine(engine);
}

/**
 * Starts Lite's requestAnimationFrame render loop on a scene that is **already** registered.
 *
 * @remarks
 * {@link startRenderLoop} registers the scene for you, which is the right call for a test harness.
 * An app cannot use it: `docs/architecture/07-rendering.md` §1 and §1.1 require the feature opt-ins
 * and the material warm-up to happen before registration, and registration itself has to choose
 * between `registerScene` and `registerSceneWithShadowSupport`. `app.start()` therefore calls
 * `registerRenderScene` from `./render-features.ts` itself and then this.
 *
 * @param engine - The WebGPU engine to start.
 * @returns A promise that resolves once the first frame has been rendered.
 *
 * @internal
 */
export async function startEngineLoop(engine: EngineContext): Promise<void> {
  await startEngine(engine);
}

/**
 * Stops Lite's render loop. Safe to call when the loop is not running.
 *
 * @param engine - The engine whose loop should stop.
 *
 * @internal
 */
export function stopRenderLoop(engine: EngineContext): void {
  stopEngine(engine);
}
