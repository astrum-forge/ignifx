import { describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../../src/lite/camera.js";
import { enableSceneDeviceLossRecovery, forceDeviceLossForTesting } from "../../../src/lite/gpu/device-loss.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial } from "../../../src/lite/gpu/mesh.js";
import { captureFrame } from "../../../src/lite/gpu/screenshot-capture.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../../src/lite/light.js";
import { startRenderLoop, stopRenderLoop } from "../../../src/lite/loop.js";
import { createPbrMaterialFromProps } from "../../../src/lite/material.js";
import { createNode } from "../../../src/lite/node.js";
import { registerRenderScene } from "../../../src/lite/render-features.js";
import { createWebGpuEngine, disposeWebGpuEngine } from "../../../src/lite/render.js";
import { createRenderScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import { createPixelRgba, pixelsDiffer, samplePixel } from "../../../src/lite/screenshot.js";
import type { LiteEngine, LiteScene } from "../../../src/lite/scene.js";
import type { PixelRgba } from "../../../src/lite/screenshot.js";

/**
 * Spike S2.3, device-loss half (`docs/architecture/07-rendering.md` §4): recovery enabled **before**
 * any resource exists survives a forced loss and draws the same image again; recovery enabled after
 * the fact is recorded for what it actually does; and forcing a loss with no strategy enabled is a
 * hard error rather than a silent no-op.
 *
 * The engine here is built by hand rather than through the shared harness, because the ordering of
 * `enableDeviceLostSceneRecovery` against resource creation is the whole point.
 */

/** How different two 0–255 channels may be and still count as the same image. */
const PIXEL_TOLERANCE = 6;

/** How long recovery gets before the test gives up, in milliseconds. */
const RECOVERY_TIMEOUT_MS = 15_000;

/** A promise plus the function that settles it. */
interface Deferred<T> {
  /** The promise a test awaits. */
  readonly promise: Promise<T>;
  /** Settles it; handed to a Lite callback. */
  readonly settle: (value: T) => void;
}

/** Placeholder until the promise executor hands over the real resolver. */
function unsettled(): void {
  // Replaced synchronously by the `Promise` constructor.
}

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Builds a promise a Lite callback can settle from outside.
 *
 * @returns The promise and its resolver.
 */
function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = unsettled;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** What a device-loss run observed. */
interface LossRun {
  /** Resolves when Lite reports the loss. */
  readonly lost: Promise<void>;
  /** Resolves when Lite reports a successful recovery. */
  readonly recovered: Promise<void>;
  /** Resolves when Lite reports that recovery failed. */
  readonly failed: Promise<unknown>;
}

/** A built scene plus its teardown. */
interface Fixture {
  /** The engine. */
  readonly engine: LiteEngine;
  /** The scene. */
  readonly scene: LiteScene;
  /** What the recovery callbacks reported. */
  readonly run: LossRun;
  /** Waits for the next animation frame. */
  readonly nextFrame: () => Promise<void>;
  /** Waits for a number of animation frames, sequentially. */
  readonly advanceFrames: (count: number) => Promise<void>;
  /** Tears everything down. */
  readonly dispose: () => void;
}

/**
 * Builds a canvas, an engine, and a red box scene, enabling device-loss recovery either before or
 * after the resources are created.
 *
 * @param enableRecovery - `"before"`, `"after"`, or `"never"`.
 * @returns The fixture.
 */
async function buildFixture(enableRecovery: "before" | "after" | "never"): Promise<Fixture> {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  canvas.style.width = "48px";
  canvas.style.height = "48px";
  document.body.append(canvas);

  const engine = await createWebGpuEngine(canvas, { msaaSamples: 1 });
  const lost = deferred<void>();
  const recovered = deferred<void>();
  const failed = deferred<unknown>();
  const run: LossRun = { lost: lost.promise, recovered: recovered.promise, failed: failed.promise };
  const callbacks = {
    onLost: (): void => {
      lost.settle();
    },
    onRecovered: (): void => {
      recovered.settle();
    },
    onRecoveryFailed: (error: unknown): void => {
      failed.settle(error);
    },
  };

  if (enableRecovery === "before") {
    enableSceneDeviceLossRecovery(engine, callbacks);
  }

  const scene = createRenderScene(engine);
  addLightToScene(scene, createHemisphericLightInWorld(1));
  const box = createBoxMesh(engine, 2);
  setMeshMaterial(box, createPbrMaterialFromProps({ baseColor: [1, 0, 0, 1], metallic: 0, roughness: 1 }));
  addMeshToScene(scene, box);
  const cameraNode = createNode("camera-entity");
  const camera = createCameraUnderNode(cameraNode);
  setCameraPerspective(camera, 60);
  setCameraClipPlanes(camera, 0.1, 100);
  cameraNode.position.set(0, 0, -5);
  setSceneCamera(scene, camera);

  await registerRenderScene(scene, { shadows: false });
  await startRenderLoop(engine, scene);

  if (enableRecovery === "after") {
    enableSceneDeviceLossRecovery(engine, callbacks);
  }

  return {
    engine,
    scene,
    run,
    nextFrame,
    advanceFrames: (count: number) =>
      Array.from({ length: count }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve()),
    dispose: () => {
      stopRenderLoop(engine);
      disposeSceneOnly(scene);
      try {
        disposeWebGpuEngine(engine);
      } catch {
        // A lost device has already been destroyed; disposing it again is not a failure of the
        // thing under test.
      }
      canvas.remove();
    },
  };
}

/**
 * Captures the centre pixel of the next frame.
 *
 * @param engine - The engine to capture.
 * @returns The colour.
 */
async function centrePixel(engine: LiteEngine): Promise<PixelRgba> {
  const frame = await captureFrame(engine);
  const pixel = createPixelRgba();
  if (samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel) === null) {
    throw new Error("the capture was empty");
  }
  return pixel;
}

/**
 * Fails a promise race after a timeout so a stuck recovery is a test failure and not a hang.
 *
 * @param promise - What to wait for.
 * @param what - What is being waited for, for the message.
 * @returns The promise's value.
 */
async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error(`${what} did not happen within ${String(RECOVERY_TIMEOUT_MS)} ms`));
        }, RECOVERY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

describe("S2.3 · device loss with recovery enabled first", () => {
  it("reports the loss, recovers, and draws the same image again", async () => {
    const fixture = await buildFixture("before");
    try {
      const before = await centrePixel(fixture.engine);
      expect(before.r).toBeGreaterThan(100);

      forceDeviceLossForTesting(fixture.engine);
      await within(fixture.run.lost, "onLost");
      await within(fixture.run.recovered, "onRecovered");

      await fixture.advanceFrames(4);
      const after = await centrePixel(fixture.engine);
      expect(pixelsDiffer(before, after, PIXEL_TOLERANCE)).toBe(false);
    } finally {
      fixture.dispose();
    }
  }, 30_000);
});

describe("S2.3 · device loss with recovery enabled after the resources exist", () => {
  it("still recovers the scene: Lite rebuilds meshes from the CPU copies it always keeps", async () => {
    // `docs/architecture/07-rendering.md` §4 requires the call before any resource is created. That
    // rule protects *textures*, whose recovery source is only stamped on textures created after the
    // capture is installed (`lib/engine/device-lost-recovery-capture.js`). Geometry has no such
    // dependency — `_cpuPositions` and friends are retained by every mesh factory — so a scene of
    // untextured meshes recovers either way. This test records that, so the rule is understood as
    // "textures need it", not as folklore.
    const fixture = await buildFixture("after");
    try {
      const before = await centrePixel(fixture.engine);
      forceDeviceLossForTesting(fixture.engine);
      await within(fixture.run.lost, "onLost");
      await within(fixture.run.recovered, "onRecovered");

      await fixture.advanceFrames(4);
      const after = await centrePixel(fixture.engine);
      expect(pixelsDiffer(before, after, PIXEL_TOLERANCE)).toBe(false);
    } finally {
      fixture.dispose();
    }
  }, 30_000);
});

describe("S2.3 · forcing a loss with no recovery strategy", () => {
  it("throws rather than destroying the device silently", async () => {
    const fixture = await buildFixture("never");
    try {
      expect(() => {
        forceDeviceLossForTesting(fixture.engine);
      }).toThrow();
    } finally {
      fixture.dispose();
    }
  }, 30_000);
});
