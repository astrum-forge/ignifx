import {
  createNullEngine,
  createSceneContext,
  disposeScene,
  type EngineContext,
  type SceneContext,
} from "@babylonjs/lite";

/**
 * Scene-construction half of the Babylon Lite adapter: the engine/scene pairs a world is built on
 * (`docs/architecture/00-overview.md` §3, ADR-0003). Everything here is `@internal`; the kernel's
 * `World` owns these objects and exposes them only through its documented `.lite` escape hatch.
 *
 * A world needs up to two Lite scenes: the render scene (a default render task, driven by
 * `startRenderLoop`) and, when physics is registered, a null-engine simulation scene stepped by
 * ignifx's own fixed-timestep loop. {@link createHeadlessScene} builds the second one in every mode
 * and the first one too when the app is headless.
 */

/**
 * A GPU-free engine and scene pair.
 *
 * @internal
 */
export interface HeadlessScene {
  /** The Lite null engine. It is its own surface. */
  readonly engine: EngineContext;
  /** A scene with no default render task, advanced with `runFrame`. */
  readonly scene: SceneContext;
}

/**
 * Creates a null engine and a scene with no default render task — the pair every unit test, server,
 * and physics simulation scene runs on (`CONSTITUTION.md` §3.8).
 *
 * @returns The engine and scene. Release the scene with {@link disposeSceneOnly}.
 *
 * @example
 * ```ts
 * const { engine, scene } = createHeadlessScene();
 * runFrame(engine, scene, 1 / 60);
 * disposeSceneOnly(scene);
 * ```
 *
 * @internal
 */
export function createHeadlessScene(): HeadlessScene {
  const engine = createNullEngine();
  return { engine, scene: createSceneContext(engine, { defaultRenderTask: false }) };
}

/**
 * Creates the scene a world actually draws, with or without Lite's default render task.
 *
 * @remarks
 * The engine comes from `createRenderEngine` in `./render.ts`; this module deliberately does not
 * create engines, so the WebGPU capability probe stays in one place.
 *
 * `defaultRenderTask` is the one thing about a scene that cannot be changed afterwards: the task is
 * built inside `createSceneContext` with its render target baked in, and Lite exposes no handle to
 * it (`./gpu/render-path.ts`). A project that declares `rendering.features.postProcessing` gets no
 * default task and `installOffscreenRenderPath` builds the replacement.
 *
 * @param engine - A WebGPU engine.
 * @param options - Scene options.
 * @param options.offscreen - `true` to omit the default render task, for the offscreen path.
 * @returns The scene. Register it and start the loop with `startRenderLoop`.
 *
 * @internal
 */
export function createRenderScene(engine: EngineContext, options?: { readonly offscreen?: boolean }): SceneContext {
  return createSceneContext(engine, { defaultRenderTask: options?.offscreen !== true });
}

/**
 * How many lights a scene currently holds.
 *
 * @remarks
 * `SceneContext.lights` is a plain array Lite appends to in `addToScene`, so reading its length
 * needs no device. The renderer consults it before installing warm-up probes: a probe registered
 * into a scene with **no** lights leaves every later mesh of that family undrawn (measured on
 * SwiftShader 2026-09-05; see `test/render/warm-up.browser.test.ts`).
 *
 * @param scene - The scene to read.
 * @returns The light count.
 *
 * @internal
 */
export function sceneLightCount(scene: SceneContext): number {
  return scene.lights.length;
}

/**
 * Releases a scene's resources without touching its engine.
 *
 * @remarks
 * Disposing only the scene is deliberate and, for a null engine, complete. Verified against
 * `@babylonjs/lite@1.27.0` (ADR-0009 Validation): `createNullEngine()` returns an engine that is its
 * own surface but owns no `_context` and no `_device`, while `disposeEngine()` unconditionally
 * calls `surface._context.unconfigure()` and `engine._device.destroy()` — so calling it on a null
 * engine throws. A null engine holds no GPU resources, so there is nothing else to release. A
 * WebGPU engine is disposed through `disposeRenderEngine` in `./render.ts` instead, after its
 * scenes.
 *
 * @param scene - The scene to release.
 *
 * @internal
 */
export function disposeSceneOnly(scene: SceneContext): void {
  disposeScene(scene);
}

/**
 * The Babylon Lite engine handle an ignifx app owns, re-exported under an ignifx name so that
 * feature code can name the type without importing `@babylonjs/lite`
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches, and it
 * is excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteEngine = EngineContext;

/**
 * The Babylon Lite scene a world renders into (or simulates on), re-exported under an ignifx name
 * for the same reason as {@link LiteEngine}.
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteScene = SceneContext;
