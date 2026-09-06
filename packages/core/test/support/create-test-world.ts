import { createLayerTable } from "../../src/layers/layer-table.js";
import { createFrameState } from "../../src/lifecycle/frame-state.js";
import { createHeadlessScene, disposeSceneOnly } from "../../src/lite/scene.js";
import { createWorld } from "../../src/world/world.js";
import { TestApp } from "./test-app.js";
import type { RecordingCoroutineHost } from "./test-app.js";
import type { ErrorReport } from "../../src/app/types.js";
import type { FrameStateController } from "../../src/lifecycle/frame-state.js";
import type { WorldInternals } from "../../src/world/world-internals.js";
import type { World } from "../../src/world/world.js";

/** Options accepted by {@link createTestWorld}. */
export interface TestWorldOptions {
  /** The project's layer names. Defaults to a small set the layer tests reuse. */
  readonly layers?: readonly string[];
  /** A deterministic identifier factory, when a test asserts on uids. */
  readonly ulid?: () => string;
}

/** Everything a scene-graph test needs, wired together. */
export interface TestWorld {
  /** The fake app. */
  readonly app: TestApp;
  /** The world under test. */
  readonly world: World;
  /** The frame-state controller, for the "inside a callback" cases. */
  readonly frameState: FrameStateController;
  /** The world's internal lifecycle API. */
  readonly lifecycle: WorldInternals;
  /** The shared log every `RecordingScript` appends to. */
  readonly log: string[];
  /** Every failure the engine reported instead of rethrowing. */
  readonly errors: ErrorReport[];
  /** The recording coroutine scheduler. */
  readonly coroutines: RecordingCoroutineHost;
  /** Lifecycle flush A: `awake` then `onEnable`. */
  flushA(): void;
  /** Lifecycle flush B: `start`. */
  flushB(): void;
  /** The destroy flush. */
  flushDestroy(): void;
  /** Flush A, flush B, then the destroy flush — one frame's worth of lifecycle work. */
  frame(): void;
  /** Disposes the world and releases the Lite scene. */
  dispose(): void;
}

/**
 * The shared log of a world, so `RecordingScript` can find it without a constructor argument.
 * Module scope is fine here: this file is test-only, and the map is keyed by world so two worlds in
 * one process stay independent (`CONSTITUTION.md` §3.6).
 */
const sinks = new WeakMap<World, string[]>();

/**
 * The shared log of a world.
 *
 * @param world - The world.
 * @returns Its log; a fresh one when the world was not built by {@link createTestWorld}.
 */
export function sinkOf(world: World): string[] {
  let sink = sinks.get(world);
  if (sink === undefined) {
    sink = [];
    sinks.set(world, sink);
  }
  return sink;
}

/**
 * Builds a world on a headless Lite scene with a fake app.
 *
 * @param options - The project's layer names and an optional deterministic uid factory.
 * @returns The harness.
 */
export function createTestWorld(options?: TestWorldOptions): TestWorld {
  const { engine, scene } = createHeadlessScene();
  const layerNames = options?.layers ?? ["Default", "Ground", "Player", "Enemy"];
  const app = new TestApp(engine, scene, layerNames);
  const frameState = createFrameState();
  const world = createWorld({
    app,
    scene,
    frameState,
    layers: createLayerTable(layerNames),
    ...(options?.ulid === undefined ? {} : { ulid: options.ulid }),
  });
  app.bindWorld(world, frameState.state);
  const log = sinkOf(world);
  const lifecycle = world.lifecycle;
  return {
    app,
    world,
    frameState,
    lifecycle,
    log,
    errors: app.errors,
    coroutines: app.coroutines,
    flushA: () => {
      lifecycle.flushAwakeAndEnable();
    },
    flushB: () => {
      lifecycle.flushStart();
    },
    flushDestroy: () => {
      lifecycle.flushDestroy();
    },
    frame: () => {
      lifecycle.flushAwakeAndEnable();
      lifecycle.flushStart();
      lifecycle.flushDestroy();
    },
    dispose: () => {
      world.dispose();
      disposeSceneOnly(scene);
    },
  };
}
