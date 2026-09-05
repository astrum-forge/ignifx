import { waitForGpuWork } from "../../../../src/lite/gpu/render-diagnostics-gpu.js";
import { installOffscreenRenderPath } from "../../../../src/lite/gpu/render-path.js";
import { captureFrame } from "../../../../src/lite/gpu/screenshot-capture.js";
import { registerFrameCallback, startRenderLoop, stopRenderLoop } from "../../../../src/lite/loop.js";
import { registerRenderScene } from "../../../../src/lite/render-features.js";
import { createWebGpuEngine, disposeWebGpuEngine } from "../../../../src/lite/render.js";
import { createRenderScene, disposeSceneOnly } from "../../../../src/lite/scene.js";
import { createPixelRgba, samplePixel } from "../../../../src/lite/screenshot.js";
import type { ScenePresenter } from "../../../../src/lite/gpu/render-path.js";
import type { LiteEngine, LiteScene } from "../../../../src/lite/scene.js";
import type { CapturedFrame, PixelRgba } from "../../../../src/lite/screenshot.js";

/**
 * The shared plumbing every GPU test in this directory uses: a canvas, a Lite WebGPU engine, a
 * render scene, a rendered-frame counter, and pixel assertions over `captureScreenshot`.
 *
 * All of it is test-only. It deliberately drives the adapter's own entry points rather than Lite's,
 * so a break in the adapter surfaces here.
 */

/** A running engine, its scene, and the counters a test asserts on. */
export interface RenderHarness {
  /** The canvas the engine presents to. */
  readonly canvas: HTMLCanvasElement;
  /** The Lite engine. */
  readonly engine: LiteEngine;
  /** The scene the engine renders. */
  readonly scene: LiteScene;
  /** The offscreen render path, when the harness was built with `offscreen: true`. */
  readonly presenter: ScenePresenter | null;
  /** How many frames Lite has rendered since the loop started. */
  readonly frameCount: () => number;
  /** Waits for the next animation frame. */
  readonly nextFrame: () => Promise<void>;
  /** Stops the loop and releases the engine, the scene, and the canvas. */
  readonly dispose: () => void;
}

/** How the harness sets up its engine and scene. */
export interface RenderHarnessOptions {
  /** The canvas size, in device pixels. Small keeps SwiftShader fast. */
  readonly size?: number;
  /** MSAA sample count. `1` makes single-pixel assertions exact. */
  readonly msaaSamples?: 1 | 4;
  /** Whether the scene is registered with shadow support. */
  readonly shadows?: boolean;
  /**
   * `true` builds the scene without Lite's default render task and installs ignifx's offscreen
   * render path instead — what `rendering.features.postProcessing` does in a real app.
   */
  readonly offscreen?: boolean;
  /** Runs after the scene is created and before it is registered — the warm-up window. */
  readonly beforeRegister?: (engine: LiteEngine, scene: LiteScene) => void | Promise<void>;
}

/** The canvas edge the harness uses when the caller names none. */
const DEFAULT_SIZE = 64;

/**
 * Builds a canvas, an engine, and a registered scene, and starts the render loop.
 *
 * @param options - Size, sample count, shadow support, and a pre-registration hook.
 * @returns The harness. Always `dispose()` it in a `finally`.
 */
export async function createRenderHarness(options: RenderHarnessOptions = {}): Promise<RenderHarness> {
  const size = options.size ?? DEFAULT_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  document.body.append(canvas);

  const engine = await createWebGpuEngine(canvas, { msaaSamples: options.msaaSamples ?? 1 });
  const offscreen = options.offscreen === true;
  const scene = createRenderScene(engine, { offscreen });
  const presenter = offscreen ? installOffscreenRenderPath(engine, scene) : null;
  let frames = 0;
  registerFrameCallback(scene, () => {
    frames += 1;
  });

  await options.beforeRegister?.(engine, scene);
  await registerRenderScene(scene, { shadows: options.shadows ?? false });
  await startRenderLoop(engine, scene);

  return {
    canvas,
    engine,
    scene,
    presenter,
    frameCount: () => frames,
    nextFrame: () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
    dispose: () => {
      stopRenderLoop(engine);
      disposeSceneOnly(scene);
      disposeWebGpuEngine(engine);
      canvas.remove();
    },
  };
}

/**
 * Waits for a number of animation frames.
 *
 * @remarks
 * Written as a promise chain rather than a loop because waiting for frame `n + 1` genuinely depends
 * on frame `n` having happened — the case `no-await-in-loop` exists to catch is the one where the
 * awaits could have run in parallel, and this is the opposite of that.
 *
 * @param harness - The running harness.
 * @param count - How many frames to wait.
 */
export function advanceFrames(harness: RenderHarness, count: number): Promise<void> {
  return Array.from({ length: count }).reduce<Promise<void>>(
    (chain) => chain.then(() => harness.nextFrame()),
    Promise.resolve(),
  );
}

/**
 * Waits until Lite has actually run the deferred teardown of anything released so far.
 *
 * @remarks
 * `removeFromScene` does not free a mesh's buffers on the spot: it hands the teardown to
 * `retireGpuResources`, which a later `renderFrame` (or `stopEngine`) flushes and which then waits
 * for the GPU queue to drain (`lib/engine/gpu-resource-retirement.js`). Two rendered frames plus a
 * queue fence is comfortably past that point.
 *
 * @param harness - The running harness.
 */
export async function settleGpu(harness: RenderHarness): Promise<void> {
  await advanceFrames(harness, 2);
  await waitForGpuWork(harness.engine);
  await harness.nextFrame();
  await waitForGpuWork(harness.engine);
}

/**
 * Captures a frame and reads one pixel out of it.
 *
 * @param harness - The running harness.
 * @param x - The pixel column, from the left.
 * @param y - The pixel row, from the top.
 * @param out - Receives the colour.
 * @returns `out`.
 */
export async function capturePixel(harness: RenderHarness, x: number, y: number, out: PixelRgba): Promise<PixelRgba> {
  const frame = await captureFrame(harness.engine);
  const sampled = samplePixel(frame, x, y, out);
  if (sampled === null) {
    throw new Error(`(${String(x)}, ${String(y)}) is outside a ${String(frame.width)}x${String(frame.height)} capture`);
  }
  return sampled;
}

/**
 * Captures the centre pixel of a frame.
 *
 * @param harness - The running harness.
 * @returns The colour, in a fresh pixel object.
 */
export async function captureCentrePixel(harness: RenderHarness): Promise<PixelRgba> {
  const frame = await captureFrame(harness.engine);
  const pixel = createPixelRgba();
  const sampled = samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel);
  if (sampled === null) {
    throw new Error("the capture was empty");
  }
  return sampled;
}

/**
 * Captures frames until `predicate` accepts one, or the frame budget runs out.
 *
 * @param harness - The running harness.
 * @param predicate - Decides whether the capture shows what the test is waiting for.
 * @param maxFrames - The largest number of rendered frames to wait.
 * @returns How many frames Lite rendered between the call and the accepted capture, or `null` when
 * the budget ran out.
 */
export function framesUntil(
  harness: RenderHarness,
  predicate: (frame: CapturedFrame) => boolean,
  maxFrames: number,
): Promise<number | null> {
  const start = harness.frameCount();
  const poll = async (): Promise<number | null> => {
    if (harness.frameCount() - start > maxFrames) {
      return null;
    }
    const frame = await captureFrame(harness.engine);
    return predicate(frame) ? harness.frameCount() - start : poll();
  };
  return poll();
}
