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

/** The pixel readers a visual assertion needs, re-exported so a test imports one module. */
export { createPixelRgba, pixelLuminance, pixelsDiffer };
