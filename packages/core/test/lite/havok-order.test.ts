import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createHavokWorld,
  createPhysicsBody,
  createPhysicsShape,
  disposePhysics,
  PhysicsMotionType,
  PhysicsShapeType,
  setPhysicsBodyMass,
  setPhysicsBodyShape,
} from "@babylonjs/lite";
import { beforeAll, describe, expect, it } from "vitest";
import { registerFrameCallback, runFrame } from "../../src/lite/loop.js";
import { createNode, disposeNode } from "../../src/lite/node.js";
import { createHeadlessScene, disposeSceneOnly } from "../../src/lite/scene.js";

/**
 * Spike S1.2, Havok half — where Lite's own physics step callback sits relative to the one ignifx
 * registers (`docs/plan/engineering-plan.md` Phase 1, `docs/architecture/00-overview.md` §3.1,
 * ADR-0003).
 *
 * `@babylonjs/lite` and `@babylonjs/havok` are imported here rather than from `src/`: test files are
 * the documented exception to the adapter boundary (coding standards §4), because verifying the
 * adapter means talking to the library it adapts.
 */

/** One frame at 60 Hz, in seconds. */
const FIXED_STEP_SECONDS = 1 / 60;

/** Standard gravity, matching Lite's Havok default of `-9.81` m/s². */
const GRAVITY_Y = -9.81;

/** The loaded Havok WASM module. Typed as `unknown` because Lite types the parameter as `any`. */
let havok: unknown;

/**
 * Loads the Havok WASM module under Node.
 *
 * @remarks
 * `@babylonjs/havok@1.3.14`'s ESM build (`lib/esm/HavokPhysics_es.js`) hard-codes
 * `ENVIRONMENT_IS_WEB = true` and fetches the `.wasm` with `fetch(scriptDirectory + path)`. Node's
 * `fetch` refuses `file:` URLs, so `locateFile` cannot help; the supported escape is Emscripten's
 * `wasmBinary` option, and the bytes come off disk with `node:fs`.
 *
 * @returns The instantiated module.
 */
async function loadHavok(): Promise<unknown> {
  const require = createRequire(import.meta.url);
  const bytes = readFileSync(require.resolve("@babylonjs/havok/lib/esm/HavokPhysics.wasm"));
  // Emscripten wants a plain `ArrayBuffer`; a Node `Buffer` is a view into a pooled one, so copy
  // out exactly this file's bytes.
  const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const module = await import("@babylonjs/havok");
  return module.default({ wasmBinary });
}

describe("S1.2 · Havok step order against the ignifx callback", () => {
  beforeAll(async () => {
    havok = await loadHavok();
  }, 30_000);

  it("initialises Havok under Node from an explicit wasmBinary", () => {
    expect(havok).toBeDefined();
  });

  it("runs the ignifx callback BEFORE Havok's step when ignifx registers second", () => {
    // `createHavokWorld` unshifts its step callback, exactly as `onBeforeRender` does, and Lite
    // walks `_beforeRender` front to back. "Front of the list" therefore means *first registered
    // runs last*: a callback ignifx registers after `createHavokWorld` observes the world as it
    // was at the end of the previous step, never mid-step.
    const { engine, scene } = createHeadlessScene();
    const node = createNode("falling-body");
    node.position.set(0, 10, 0);

    const world = createHavokWorld(scene, havok);
    const shape = createPhysicsShape(world, { type: PhysicsShapeType.SPHERE, parameters: { radius: 0.5 } });
    const body = createPhysicsBody(world, node, PhysicsMotionType.DYNAMIC);
    setPhysicsBodyShape(world, body, shape);
    setPhysicsBodyMass(world, body, 1);

    // Registered AFTER the physics world, which is the order a world uses: extensions register
    // first, the world's own callback last (`docs/architecture/01-lifecycle-and-time.md` §1).
    const observed: number[] = [];
    registerFrameCallback(scene, () => {
      observed.push(node.position.y);
    });

    try {
      runFrame(engine, scene, FIXED_STEP_SECONDS);
      const afterFirst = node.position.y;
      runFrame(engine, scene, FIXED_STEP_SECONDS);
      const afterSecond = node.position.y;

      // Frame 1: the ignifx callback saw the untouched start position.
      expect(observed[0]).toBe(10);
      // Frame 2: it saw the result of frame 1's step, not of frame 2's.
      expect(observed[1]).toBe(afterFirst);

      // Havok really did step: free fall, one `HP_World_Step` per frame, no accumulator.
      expect(afterFirst).toBeLessThan(10);
      expect(afterFirst).toBeCloseTo(10 + 0.5 * GRAVITY_Y * FIXED_STEP_SECONDS * FIXED_STEP_SECONDS, 3);
      expect(afterSecond).toBeLessThan(afterFirst);
    } finally {
      disposePhysics(world);
      disposeNode(node);
      disposeSceneOnly(scene);
    }
  });

  it("runs the ignifx callback AFTER Havok's step when ignifx registers first", () => {
    // The mirror image, recorded so the ordering rule is unambiguous: registration order alone
    // decides, and ignifx never relies on registering first.
    const { engine, scene } = createHeadlessScene();
    const node = createNode("falling-body");
    node.position.set(0, 10, 0);

    const observed: number[] = [];
    registerFrameCallback(scene, () => {
      observed.push(node.position.y);
    });

    const world = createHavokWorld(scene, havok);
    const shape = createPhysicsShape(world, { type: PhysicsShapeType.SPHERE, parameters: { radius: 0.5 } });
    const body = createPhysicsBody(world, node, PhysicsMotionType.DYNAMIC);
    setPhysicsBodyShape(world, body, shape);
    setPhysicsBodyMass(world, body, 1);

    try {
      runFrame(engine, scene, FIXED_STEP_SECONDS);
      expect(observed[0]).toBeLessThan(10);
      expect(observed[0]).toBe(node.position.y);
    } finally {
      disposePhysics(world);
      disposeNode(node);
      disposeSceneOnly(scene);
    }
  });

  it("steps physics exactly once per scene step at the delta it was given", () => {
    // ADR-0003's premise: Lite performs one `HP_World_Step` per frame with no accumulator, which is
    // why ignifx must host physics on a scene it steps itself with a fixed delta.
    const { engine, scene } = createHeadlessScene();
    const node = createNode("body");
    node.position.set(0, 0, 0);

    const world = createHavokWorld(scene, havok);
    const shape = createPhysicsShape(world, { type: PhysicsShapeType.SPHERE, parameters: { radius: 0.5 } });
    const body = createPhysicsBody(world, node, PhysicsMotionType.DYNAMIC);
    setPhysicsBodyShape(world, body, shape);
    setPhysicsBodyMass(world, body, 1);

    try {
      for (let index = 0; index < 60; index += 1) {
        runFrame(engine, scene, FIXED_STEP_SECONDS);
      }
      // One second of free fall from rest under Lite's default gravity, integrated in 60 steps.
      expect(node.position.y).toBeCloseTo(0.5 * GRAVITY_Y, 0);
      expect(node.position.y).toBeLessThan(-4);
      expect(node.position.y).toBeGreaterThan(-6);
    } finally {
      disposePhysics(world);
      disposeNode(node);
      disposeSceneOnly(scene);
    }
  });

  it("drives two physics scenes in one process without interference", () => {
    // CONSTITUTION.md §3.6, and the shape ADR-0003 needs: a world's simulation scene is its own.
    const first = createHeadlessScene();
    const second = createHeadlessScene();
    const firstNode = createNode("first");
    const secondNode = createNode("second");
    firstNode.position.set(0, 10, 0);
    secondNode.position.set(0, 10, 0);

    const firstWorld = createHavokWorld(first.scene, havok);
    const secondWorld = createHavokWorld(second.scene, havok);
    for (const [world, node] of [
      [firstWorld, firstNode],
      [secondWorld, secondNode],
    ] as const) {
      const shape = createPhysicsShape(world, { type: PhysicsShapeType.SPHERE, parameters: { radius: 0.5 } });
      const body = createPhysicsBody(world, node, PhysicsMotionType.DYNAMIC);
      setPhysicsBodyShape(world, body, shape);
      setPhysicsBodyMass(world, body, 1);
    }

    try {
      for (let index = 0; index < 10; index += 1) {
        runFrame(first.engine, first.scene, FIXED_STEP_SECONDS);
      }
      runFrame(second.engine, second.scene, FIXED_STEP_SECONDS);

      expect(firstNode.position.y).toBeLessThan(secondNode.position.y);
      expect(secondNode.position.y).toBeLessThan(10);
    } finally {
      disposePhysics(firstWorld);
      disposePhysics(secondWorld);
      disposeNode(firstNode);
      disposeNode(secondNode);
      disposeSceneOnly(first.scene);
      disposeSceneOnly(second.scene);
    }
  });
});
