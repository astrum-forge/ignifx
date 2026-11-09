import { createApp } from "../../../src/app/app.js";
import { createAssetManifest } from "../../../src/assets/manifest.js";
import { createPixelRgba, pixelLuminance, pixelsDiffer, samplePixel } from "../../../src/lite/screenshot.js";
import { createMemorySink } from "../../../src/log/memory-sink.js";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import { rendererInternals } from "../../../src/render/renderer.js";
import type { App, ErrorReport } from "../../../src/app/types.js";
import type { AssetManifestEntry } from "../../../src/assets/types.js";
import type { PixelRgba } from "../../../src/lite/screenshot.js";
import type { MemorySink } from "../../../src/log/memory-sink.js";
import type { RendererImpl } from "../../../src/render/renderer.js";
import type { SettingsInput } from "../../../src/settings/settings-input.js";
import type { World } from "../../../src/world/world.js";

/**
 * A real `createApp({ canvas })` on a WebGPU device, for the render layer's browser suites.
 *
 * It is deliberately the *whole* app rather than a hand-built engine and scene: what the browser
 * project has to prove about Phase 2 is that the components, the settings, the feature opt-ins, the
 * warm-up, and the frame loop line up — and the only way to prove that is to start an app the way a
 * game does and read the pixels it presents.
 *
 * `msaaSamples: 1` throughout, so a single-pixel assertion is exact rather than a resolve of four
 * samples (ADR-0002 Validation).
 */

/** The canvas edge the harness uses when a test names none. Small keeps SwiftShader fast. */
const DEFAULT_SIZE = 64;

/** Options accepted by {@link createBrowserApp}. */
export interface BrowserAppOptions {
  /** The canvas edge, in device pixels. */
  readonly size?: number;
  /** Project settings, merged over the harness's own. */
  readonly settings?: SettingsInput;
  /** Manifest entries, for the tests that load a fixture asset. */
  readonly assets?: readonly AssetManifestEntry[];
  /**
   * `false` leaves the app unstarted so the caller can build its world first and call
   * {@link BrowserApp.start} — the shape a game that loads its scene before starting has, and the
   * one the material warm-up needs (ADR-0014).
   */
  readonly startEmpty?: boolean;
  /** Builds the app in edit mode (ADR-0028). */
  readonly editMode?: boolean;
}

/** A running app on a real device. */
export interface BrowserApp {
  /** The app. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** The rendering service, with its engine-owned half reachable. */
  readonly renderer: RendererImpl;
  /** The canvas it presents to. */
  readonly canvas: HTMLCanvasElement;
  /** Every log record the app produced. */
  readonly log: MemorySink;
  /** Every report `app.onError` emitted. */
  readonly errors: ErrorReport[];
  /** Waits for one animation frame. */
  nextFrame(): Promise<void>;
  /** Waits for several animation frames. */
  advance(frames: number): Promise<void>;
  /** Captures a frame and reads its centre pixel. */
  centrePixel(): Promise<PixelRgba>;
  /** Captures a frame and reads one pixel of it. */
  pixelAt(x: number, y: number): Promise<PixelRgba>;
  /** Starts the app, for a harness built with `startEmpty: false`. */
  start(): Promise<void>;
  /** Stops and disposes the app, and removes the canvas. */
  dispose(): void;
}

/** How many frames a change is given to reach the screen before a test reads it. */
export const SETTLE_FRAMES = 6;

/** The most frames {@link settleRebuilds} waits for a rebuild before it gives up. */
const MAX_REBUILD_FRAMES = 600;

/**
 * Waits until the render sync system has run a renderable rebuild after `before` and owes no more,
 * then {@link SETTLE_FRAMES} more frames so the rebuilt scene reaches the screen.
 *
 * @remarks
 * A mesh added after `app.start()` is drawn only once that rebuild has finished. It runs alongside
 * the frames and takes as long as the machine makes it take, so a fixed frame count reads the clear
 * colour on a loaded runner (`hello-cube.browser.test.ts`, CI run 41671510758).
 *
 * @param harness - The running app.
 * @param before - `renderer.renderableRebuilds` before the change.
 * @param left - How many more frames to wait.
 * @returns A promise that settles once the rebuilt scene has been presented.
 * @throws Error when the rebuild has not finished after {@link MAX_REBUILD_FRAMES} frames.
 */
export async function settleRebuilds(harness: BrowserApp, before: number, left = MAX_REBUILD_FRAMES): Promise<void> {
  const renderer = harness.renderer;
  const isSettled =
    renderer.renderableRebuilds > before &&
    !renderer.needsRenderableRebuild &&
    !renderer.isRebuildInFlight &&
    !renderer.materialCacheResets.unconfirmed;
  if (isSettled) {
    return harness.advance(SETTLE_FRAMES);
  }
  if (left <= 0) {
    throw new Error(`The renderable rebuild had not finished after ${String(MAX_REBUILD_FRAMES)} frames.`);
  }
  await harness.nextFrame();
  return settleRebuilds(harness, before, left - 1);
}

/**
 * Reports whether the renderer still owes a renderable rebuild or a cache-reset confirmation.
 *
 * @param renderer - The app's renderer.
 * @returns `true` while a rebuild is queued or running, or a material cache reset is unconfirmed.
 */
function owesRebuild(renderer: RendererImpl): boolean {
  return renderer.needsRenderableRebuild || renderer.isRebuildInFlight || renderer.materialCacheResets.unconfirmed;
}

/**
 * Waits until the renderer has gone `quietFrames` frames without owing or starting a renderable
 * rebuild, so whatever the test changed has reached the screen.
 *
 * @remarks
 * The form of {@link settleRebuilds} for a change that may or may not need a rebuild (a material,
 * a setting, a post-process stack, an asset that loads after `start()`): it never insists on one.
 * The render sync system queues a rebuild one frame after the change and runs it between frames
 * for as long as the machine takes, so a fixed frame count reads the old scene on a loaded runner.
 * A rebuild that starts while it waits restarts the count, so it never waits less than
 * `advance(quietFrames)` would.
 *
 * @param harness - The running app.
 * @param quietFrames - How many frames in a row must pass with no rebuild owed or started.
 * @param left - How many more frames to wait.
 * @returns A promise that settles once the scene has been quiet for `quietFrames` frames.
 * @throws Error when the renderer is still rebuilding after {@link MAX_REBUILD_FRAMES} frames.
 */
export async function settle(
  harness: BrowserApp,
  quietFrames = SETTLE_FRAMES,
  left = MAX_REBUILD_FRAMES,
): Promise<void> {
  if (left <= 0) {
    throw new Error(`The renderer was still rebuilding after ${String(MAX_REBUILD_FRAMES)} frames.`);
  }
  const renderer = harness.renderer;
  if (owesRebuild(renderer)) {
    await harness.nextFrame();
    return settle(harness, quietFrames, left - 1);
  }
  const rebuilds = renderer.renderableRebuilds;
  await harness.advance(quietFrames);
  if (!owesRebuild(renderer) && renderer.renderableRebuilds === rebuilds) {
    return;
  }
  return settle(harness, quietFrames, left - quietFrames);
}

/**
 * Waits for one animation frame.
 *
 * @returns A promise that resolves inside the next frame callback.
 */
export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * The URL a browser test fetches a repository fixture from. Vitest's browser project serves the
 * repository root, so a repository-relative path is the URL path.
 *
 * @param name - The file name inside `tests/fixtures/assets/`.
 * @returns The URL path.
 */
export function fixtureUrl(name: string): string {
  return `/tests/fixtures/assets/${name}`;
}

/** Builds a running app on a real WebGPU device. */
export async function createBrowserApp(options: BrowserAppOptions = {}): Promise<BrowserApp> {
  const size = options.size ?? DEFAULT_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${String(size)}px`;
  canvas.style.height = `${String(size)}px`;
  document.body.append(canvas);

  const log = createMemorySink();
  const errors: ErrorReport[] = [];
  const app = await createApp({
    canvas,
    logSink: log,
    logLevel: "debug",
    editMode: options.editMode === true,
    assets: { manifest: createAssetManifest(options.assets ?? []) },
    settings: {
      ...options.settings,
      rendering: { msaaSamples: 1, ...(options.settings?.["rendering"] as Record<string, unknown> | undefined) },
    },
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  if (options.startEmpty !== false) {
    await app.start();
  }

  // Written as a promise chain rather than a loop because waiting for frame `n + 1` genuinely
  // depends on frame `n` having happened.
  const advance = (frames: number): Promise<void> =>
    Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve());

  const pixelAt = async (x: number, y: number): Promise<PixelRgba> => {
    const frame = await app.renderer.captureScreenshot();
    const pixel = createPixelRgba();
    const sampled = samplePixel(frame, x, y, pixel);
    if (sampled === null) {
      throw new Error(
        `(${String(x)}, ${String(y)}) is outside a ${String(frame.width)}x${String(frame.height)} capture`,
      );
    }
    return sampled;
  };

  return {
    app,
    world: app.world,
    renderer: rendererInternals(app.renderer),
    canvas,
    log,
    errors,
    nextFrame,
    advance,
    pixelAt,
    start: (): Promise<void> => app.start(),
    centrePixel: async (): Promise<PixelRgba> => pixelAt(canvas.width >> 1, canvas.height >> 1),
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
}

/**
 * Adds a camera looking down `+Z` from `-distance`, and a white directional light pointing the same
 * way — the lit-scene setup every visual test starts from.
 *
 * @param harness - The running app.
 * @param distance - How far back the camera sits, in metres.
 * @returns The camera component, for the tests that change its projection.
 */
export function addCameraAndLight(harness: BrowserApp, distance = 4): Camera {
  const eye = harness.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -distance);
  const camera = eye.addComponent(Camera, { near: 0.1, far: 100 });
  const sun = harness.world.createEntity("Sun");
  sun.addComponent(Light, { type: "hemispheric", intensity: 1 });
  return camera;
}

/**
 * Collects the validation errors the next app's GPU device reports outside any error scope.
 *
 * @remarks
 * A rejected command buffer throws nothing in JavaScript: it only raises `uncapturederror`, and the
 * canvas keeps whatever it last showed. Wrapping `requestDevice` reaches the device before Lite
 * records its first frame.
 *
 * @returns The collected messages, and a function that restores `requestDevice`.
 */
export function gpuDeviceErrors(): { readonly errors: string[]; stop(): void } {
  const errors: string[] = [];
  const adapterPrototype = GPUAdapter.prototype;
  // Called below with the adapter as `this`, through `original.call`.
  // oxlint-disable-next-line typescript/unbound-method
  const original = adapterPrototype.requestDevice;
  adapterPrototype.requestDevice = async function requestDevice(
    this: GPUAdapter,
    descriptor?: GPUDeviceDescriptor,
  ): Promise<GPUDevice> {
    const device = await original.call(this, descriptor);
    device.addEventListener("uncapturederror", (event) => {
      errors.push(event.error.message);
    });
    return device;
  };
  return {
    errors,
    stop: (): void => {
      adapterPrototype.requestDevice = original;
    },
  };
}

/** The pixel readers a visual assertion needs, re-exported so a test imports one module. */
export { createPixelRgba, pixelLuminance, pixelsDiffer };
