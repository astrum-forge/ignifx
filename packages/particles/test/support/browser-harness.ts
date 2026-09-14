import { Camera, createApp, createMemorySink, Light } from "@ignifx/core";
import { particles } from "../../src/extension.js";
import type { ParticlesOptions } from "../../src/extension.js";
import type { App, ErrorReport, MemorySink, RenderCapture, World } from "@ignifx/core";

/**
 * A real `createApp({ canvas })` with `@ignifx/particles` registered, on a WebGPU device.
 *
 * `msaaSamples: 1` throughout, so a readback is one sample rather than a resolve of four
 * (ADR-0002). CI renders on SwiftShader, so nothing here asserts a GPU time.
 */

/** The canvas edge the harness uses when a test names none. Small keeps SwiftShader fast. */
const DEFAULT_SIZE = 96;

/** How many frames a newly built material is given to compile and reach the swapchain. */
export const SETTLE_FRAMES = 24;

/** Where a lit particle's key light points. */
const LIGHT_DIRECTION = { x: -0.4, y: -1, z: 0.6 };

/** A running particles app on a real device. */
export interface ParticlesBrowserApp {
  /** The app. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** The canvas it presents to. */
  readonly canvas: HTMLCanvasElement;
  /** Everything the app logged. */
  readonly log: MemorySink;
  /** Every report `app.onError` emitted. */
  readonly errors: ErrorReport[];
  /** The camera entity, looking down `-Z` from `+Z`. */
  readonly camera: Camera;
  /** Waits for several animation frames. */
  advance(frames: number): Promise<void>;
  /** Captures a whole frame. */
  capture(): Promise<RenderCapture>;
  /** Disposes the app and removes the canvas. */
  dispose(): void;
}

/** How {@link createParticlesBrowserApp} sets the app up. */
export interface ParticlesBrowserOptions {
  /** The canvas width, in device pixels. */
  readonly width?: number;
  /** The canvas height, in device pixels. */
  readonly height?: number;
  /** What to pass `particles(...)`. */
  readonly options?: ParticlesOptions;
  /** How far the camera sits from the origin, in metres. */
  readonly cameraDistance?: number;
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
 * Builds a running particles app on a real WebGPU device.
 *
 * @param options - Canvas size, extension options, and the camera distance.
 * @returns The harness. Always `dispose()` it in an `afterEach`.
 */
export async function createParticlesBrowserApp(options: ParticlesBrowserOptions = {}): Promise<ParticlesBrowserApp> {
  const width = options.width ?? DEFAULT_SIZE;
  const height = options.height ?? DEFAULT_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${String(width)}px`;
  canvas.style.height = `${String(height)}px`;
  document.body.append(canvas);

  const log = createMemorySink();
  const errors: ErrorReport[] = [];
  const app = await createApp({
    canvas,
    logSink: log,
    logLevel: "debug",
    extensions: [particles(options.options)],
    settings: { rendering: { msaaSamples: 1 } },
  });
  app.onError.connect((report) => {
    errors.push(report);
  });

  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -(options.cameraDistance ?? 6));
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  const camera = eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });

  const sun = app.world.createEntity("Sun");
  sun.transform.lookAt(LIGHT_DIRECTION);
  sun.addComponent(Light, { type: "directional", intensity: 3 });

  await app.start();

  return {
    app,
    world: app.world,
    canvas,
    log,
    errors,
    camera,
    // Written as a promise chain because waiting for frame `n + 1` genuinely depends on frame `n`.
    advance: (frames: number): Promise<void> =>
      Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve()),
    capture: (): Promise<RenderCapture> => app.renderer.captureScreenshot(),
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
}

/** Where the lit pixels of a capture sit, and how bright they are. */
export interface Centroid {
  /** The brightness-weighted column, in device pixels from the left. */
  readonly x: number;
  /** The brightness-weighted row, in device pixels from the top. */
  readonly y: number;
  /** How many pixels passed the threshold. */
  readonly count: number;
}

/**
 * The brightness-weighted centre of every pixel brighter than a threshold — where the one particle
 * in the frame is.
 *
 * @param frame - The captured frame.
 * @param threshold - The smallest channel sum a pixel must reach to count.
 * @returns The centroid; `count` is `0` when nothing passed.
 */
export function brightCentroid(frame: RenderCapture, threshold = 40): Centroid {
  let weight = 0;
  let x = 0;
  let y = 0;
  let count = 0;
  for (let row = 0; row < frame.height; row += 1) {
    for (let column = 0; column < frame.width; column += 1) {
      const offset = (row * frame.width + column) * 4;
      const luminance = (frame.data[offset] ?? 0) + (frame.data[offset + 1] ?? 0) + (frame.data[offset + 2] ?? 0);
      if (luminance >= threshold) {
        weight += luminance;
        x += column * luminance;
        y += row * luminance;
        count += 1;
      }
    }
  }
  return weight === 0 ? { x: 0, y: 0, count: 0 } : { x: x / weight, y: y / weight, count };
}

/**
 * The average colour of every pixel brighter than a threshold.
 *
 * @param frame - The captured frame.
 * @param threshold - The smallest channel sum a pixel must reach to count.
 * @returns The mean red, green and blue, each `0` to `255`.
 */
export function meanBrightColor(frame: RenderCapture, threshold = 40): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    const red = frame.data[offset] ?? 0;
    const green = frame.data[offset + 1] ?? 0;
    const blue = frame.data[offset + 2] ?? 0;
    if (red + green + blue >= threshold) {
      r += red;
      g += green;
      b += blue;
      count += 1;
    }
  }
  return count === 0 ? { r: 0, g: 0, b: 0 } : { r: r / count, g: g / count, b: b / count };
}
