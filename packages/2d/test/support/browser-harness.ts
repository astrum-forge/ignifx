import { createApp, createAssetManifest, createMemorySink } from "@ignifx/core";
import { twoD } from "../../src/index.js";
import type { TwoDOptions } from "../../src/index.js";
import type { App, AssetManifestEntry, ErrorReport, MemorySink, SettingsInput, World } from "@ignifx/core";

/**
 * A real `createApp({ canvas })` with `@ignifx/2d` registered, on a WebGPU device.
 *
 * What the browser project has to prove about Phase 6 is the half a headless suite cannot reach:
 * that the sprite renderer registers on the surface **after** the render scene, that a sprite's
 * texels land where `Camera2D` says they will, and that Y-sort, picking and pixel-perfect all agree
 * with the arithmetic the node suites assert. Everything else is already covered on the null engine.
 *
 * `msaaSamples: 1` throughout, so a single-pixel assertion is exact rather than a resolve of four
 * samples (ADR-0002 Validation).
 */

/** The canvas edge the harness uses when a test names none. Small keeps SwiftShader fast. */
const DEFAULT_SIZE = 64;

/** How many frames a change is given to reach the screen before a test reads it. */
export const SETTLE_FRAMES = 6;

/** One pixel of a capture, as straight RGBA bytes. */
export interface Rgba {
  /** The red channel, `0` to `255`. */
  readonly r: number;
  /** The green channel. */
  readonly g: number;
  /** The blue channel. */
  readonly b: number;
  /** The alpha channel. */
  readonly a: number;
}

/** Options accepted by {@link createTwoDBrowserApp}. */
export interface TwoDBrowserOptions {
  /** The canvas width, in device pixels. */
  readonly width?: number;
  /** The canvas height, in device pixels. */
  readonly height?: number;
  /** Project settings, merged over the harness's own. */
  readonly settings?: SettingsInput;
  /** What to pass `twoD(...)`. */
  readonly options?: TwoDOptions;
  /** Manifest entries for the fixture assets a test loads. */
  readonly assets?: readonly AssetManifestEntry[];
  /** `false` leaves the app unstarted so a test can build its world first. */
  readonly autoStart?: boolean;
}

/** A running 2D app on a real device. */
export interface TwoDBrowserApp {
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
  /** Waits for one animation frame. */
  nextFrame(): Promise<void>;
  /** Waits for several animation frames. */
  advance(frames: number): Promise<void>;
  /** Captures a frame and reads one pixel of it. */
  pixelAt(x: number, y: number): Promise<Rgba>;
  /** Captures a frame and reads its centre pixel. */
  centrePixel(): Promise<Rgba>;
  /** Captures a whole frame, for a test that reads many pixels of one capture. */
  capture(): Promise<Capture>;
  /** Starts the app. */
  start(): Promise<void>;
  /** Disposes the app and removes the canvas. */
  dispose(): void;
}

/** A captured frame with a pixel reader. */
export interface Capture {
  /** The capture width, in device pixels. */
  readonly width: number;
  /** The capture height. */
  readonly height: number;
  /**
   * Reads one pixel.
   *
   * @param x - The column, from the left.
   * @param y - The row, from the top.
   * @returns The pixel, or transparent black when the coordinate is outside the frame.
   */
  at(x: number, y: number): Rgba;
}

/** Waits for one animation frame. */
export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** Where a checked-in fixture is served from. */
export function fixtureUrl(name: string): string {
  return `/tests/fixtures/assets/2d/${name}`;
}

/** The manifest entries the 2D fixtures need. */
export function fixtureAssets(): readonly AssetManifestEntry[] {
  return [
    { address: "2d/hero.atlas.json", url: fixtureUrl("hero.atlas.json"), type: "spriteatlas" },
    { address: "2d/hero.png", url: fixtureUrl("hero.png"), type: "texture" },
    { address: "2d/checker.atlas.json", url: fixtureUrl("checker.atlas.json"), type: "spriteatlas" },
    { address: "2d/checker-linear.atlas.json", url: fixtureUrl("checker-linear.atlas.json"), type: "spriteatlas" },
    { address: "2d/checker.png", url: fixtureUrl("checker.png"), type: "texture" },
  ];
}

/**
 * Whether two pixels differ by more than a software rasteriser's noise.
 *
 * @param left - One pixel.
 * @param right - The other.
 * @param tolerance - The per-channel slack, in bytes.
 * @returns `true` when any channel differs by more than the tolerance.
 */
export function pixelsDiffer(left: Rgba, right: Rgba, tolerance = 8): boolean {
  return (
    Math.abs(left.r - right.r) > tolerance ||
    Math.abs(left.g - right.g) > tolerance ||
    Math.abs(left.b - right.b) > tolerance ||
    Math.abs(left.a - right.a) > tolerance
  );
}

/**
 * How near a pixel is to a colour, as the largest per-channel difference.
 *
 * @param pixel - The pixel read back.
 * @param r - The expected red channel.
 * @param g - The expected green channel.
 * @param b - The expected blue channel.
 * @returns The largest per-channel difference, in bytes.
 */
export function distanceTo(pixel: Rgba, r: number, g: number, b: number): number {
  return Math.max(Math.abs(pixel.r - r), Math.abs(pixel.g - g), Math.abs(pixel.b - b));
}

/**
 * Builds a running 2D app on a real WebGPU device.
 *
 * @param options - Canvas size, settings, extension options, and manifest entries.
 * @returns The harness.
 */
export async function createTwoDBrowserApp(options: TwoDBrowserOptions = {}): Promise<TwoDBrowserApp> {
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
    assets: { manifest: createAssetManifest(options.assets ?? []) },
    extensions: [twoD(options.options)],
    settings: {
      ...options.settings,
      rendering: { msaaSamples: 1, ...(options.settings?.["rendering"] as Record<string, unknown> | undefined) },
    },
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  if (options.autoStart !== false) {
    await app.start();
  }

  // Written as a promise chain rather than a loop because waiting for frame `n + 1` genuinely
  // depends on frame `n` having happened.
  const advance = (frames: number): Promise<void> =>
    Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve());

  const capture = async (): Promise<Capture> => {
    const frame = await app.renderer.captureScreenshot();
    return {
      width: frame.width,
      height: frame.height,
      at: (x: number, y: number): Rgba => {
        if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
          return { r: 0, g: 0, b: 0, a: 0 };
        }
        const offset = (y * frame.width + x) * 4;
        return {
          r: frame.data[offset] ?? 0,
          g: frame.data[offset + 1] ?? 0,
          b: frame.data[offset + 2] ?? 0,
          a: frame.data[offset + 3] ?? 0,
        };
      },
    };
  };

  const pixelAt = async (x: number, y: number): Promise<Rgba> => (await capture()).at(x, y);

  return {
    app,
    world: app.world,
    canvas,
    log,
    errors,
    nextFrame,
    advance,
    pixelAt,
    capture,
    centrePixel: (): Promise<Rgba> => pixelAt(width >> 1, height >> 1),
    start: (): Promise<void> => app.start(),
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
}
