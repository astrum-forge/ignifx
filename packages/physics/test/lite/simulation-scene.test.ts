import {
  createHavokWorld,
  createNullEngine,
  createPhysicsBody,
  createPhysicsShape,
  createSceneContext,
  createTransformNode,
  disposePhysics,
  disposeScene,
  getPhysicsTimestep,
  setPhysicsBodyMass,
  setPhysicsBodyShape,
  setPhysicsTimestep,
  stepScene,
} from "@babylonjs/lite";
import { beforeAll, describe, expect, it } from "vitest";
import { loadHavokForTests } from "./fixtures/havok.js";
import type { SceneContext } from "@babylonjs/lite";

/**
 * **Spike S4.1 — the simulation scene.** The premise ADR-0003 and `09-physics.md` §1 are built on:
 * a Havok world hosted on a **null-engine** scene, stepped by `stepScene` from ignifx's fixed loop,
 * while the same `SceneNode`s are what a render scene draws.
 *
 * `@babylonjs/lite` and `@babylonjs/havok` are imported directly here: `test/lite/**` is the
 * documented exception to the adapter boundary (coding standards §4), because verifying the adapter
 * means talking to the library it adapts.
 */

/** One step at 60 Hz, in seconds. */
const STEP_SECONDS = 1 / 60;

/** Milliseconds in one second. */
const MILLISECONDS = 1000;

/** The Havok module, instantiated once. */
let havok: unknown;

describe("S4.1 · a Havok world on a null-engine scene", () => {
  beforeAll(async () => {
    havok = await loadHavokForTests();
  }, 30_000);

  it("instantiates Havok under Node from wasmBinary bytes", () => {
    // ADR-0003 Validation: `@babylonjs/havok@1.3.14` hard-codes `ENVIRONMENT_IS_WEB` and fetches its
    // `.wasm`, which Node refuses for `file:` URLs. Emscripten's `wasmBinary` is the escape, and it
    // is what `src/lite/havok-module.ts` always uses.
    expect(havok).toBeDefined();
  });

  it("steps a body under gravity on a scene with no render task", () => {
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const node = createTransformNode("body");
    node.position.set(0, 10, 0);
    const world = createHavokWorld(scene, havok, { x: 0, y: -9.81, z: 0 });
    try {
      const shape = createPhysicsShape(world, { type: 3, parameters: { extents: { x: 1, y: 1, z: 1 } } });
      const body = createPhysicsBody(world, node, 2, false);
      setPhysicsBodyShape(world, body, shape);
      setPhysicsBodyMass(world, body, 1);
      setPhysicsTimestep(world, STEP_SECONDS);
      // `setPhysicsTimestep(world, dt)` stores `dt * 1000` in `world._fixedDeltaMs`, which is what
      // keeps Lite's per-step delta equal to ignifx's (`index.d.ts` 10863).
      expect(getPhysicsTimestep(world)).toBeCloseTo(STEP_SECONDS, 12);

      for (let index = 0; index < 60; index += 1) {
        stepScene(engine, scene, STEP_SECONDS * MILLISECONDS);
      }
      expect(node.position.y).toBeLessThan(10);
      expect(node.position.y).toBeGreaterThan(4);
    } finally {
      disposePhysics(world);
      disposeScene(scene);
    }
  });

  it("leaves the simulation scene holding no meshes or lights", () => {
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok);
    try {
      expect(sceneCounts(scene)).toEqual({ meshes: 0, lights: 0 });
    } finally {
      disposePhysics(world);
      disposeScene(scene);
    }
  });

  it("gives two independently stepped worlds bit-identical poses", () => {
    // Spike S4.1's determinism half, at the raw-Lite level: the same construction stepped 600 times
    // in two worlds lands on the same float bits.
    const first = fall(600);
    const second = fall(600);
    expect(first).toBe(second);
  }, 30_000);
});

/**
 * Runs one falling box for `steps` steps and returns its final Y as an exact bit pattern.
 *
 * @param steps - How many fixed steps to run.
 * @returns The final Y, as a hexadecimal float64 bit pattern.
 */
function fall(steps: number): string {
  const engine = createNullEngine();
  const scene = createSceneContext(engine, { defaultRenderTask: false });
  const node = createTransformNode("body");
  node.position.set(0, 20, 0);
  const world = createHavokWorld(scene, havok, { x: 0, y: -9.81, z: 0 });
  try {
    const shape = createPhysicsShape(world, { type: 0, parameters: { radius: 0.5 } });
    const body = createPhysicsBody(world, node, 2, false);
    setPhysicsBodyShape(world, body, shape);
    setPhysicsBodyMass(world, body, 1);
    setPhysicsTimestep(world, STEP_SECONDS);
    for (let index = 0; index < steps; index += 1) {
      stepScene(engine, scene, STEP_SECONDS * MILLISECONDS);
    }
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, node.position.y);
    return view.getBigUint64(0).toString(16);
  } finally {
    disposePhysics(world);
    disposeScene(scene);
  }
}

/**
 * Counts what a scene holds, so the "the simulation scene never holds meshes or lights" claim of
 * `09-physics.md` §1 is asserted rather than assumed.
 *
 * @param scene - The scene to inspect.
 * @returns The mesh and light counts.
 */
function sceneCounts(scene: SceneContext): { meshes: number; lights: number } {
  return { meshes: scene.meshes.length, lights: scene.lights.length };
}
