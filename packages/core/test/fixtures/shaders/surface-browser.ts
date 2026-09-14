import { createApp } from "../../../src/app/app.js";
import { createPixelRgba, samplePixel } from "../../../src/lite/screenshot.js";
import { createMemorySink } from "../../../src/log/memory-sink.js";
import { loadPostEffectSupport } from "../../../src/render/post-effect-support.js";
import { SHADER_ASSET_TYPE, ShaderAsset } from "../../../src/render/shader-asset.js";
import { parseShaderDeclaration } from "../../../src/render/shader-pragma.js";
import { loadShaderSupport, loadSurfaceShaderSupport } from "../../../src/render/shader-support.js";
import type { App, ErrorReport } from "../../../src/app/types.js";
import type { AssetHandle } from "../../../src/assets/types.js";
import type { PixelRgba } from "../../../src/lite/screenshot.js";
import type { MemorySink } from "../../../src/log/memory-sink.js";
import type { SettingsInput } from "../../../src/settings/settings-input.js";
import type { World } from "../../../src/world/world.js";

/**
 * A real `createApp({ canvas })` for the surface-shader and post-effect browser suites.
 *
 * It builds its own app rather than reusing `test/render/support/browser-harness.ts` because these
 * two suites need a different set of feature opt-ins per test — `materialPlugins`, `shadows`, and
 * `postProcessing` in different combinations — and because they publish `.wgsl` sources straight
 * into the asset cache rather than fetching a fixture file.
 *
 * `msaaSamples: 1` throughout, so a single-pixel assertion is exact rather than a resolve of four
 * samples (ADR-0002 Validation).
 */

/** How many frames a change is given to reach the screen before a test reads it. */
export const SURFACE_SETTLE_FRAMES = 16;

/** A running app for a surface-shader or post-effect test. */
export interface SurfaceBrowserApp {
  /** The app. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** The canvas it presents to. */
  readonly canvas: HTMLCanvasElement;
  /** Every log record the app produced. */
  readonly log: MemorySink;
  /** Every report `app.onError` emitted. */
  readonly errors: ErrorReport[];
  /** Publishes a `.wgsl` source into the asset cache under an address. */
  publishShader(address: string, source: string): AssetHandle<ShaderAsset>;
  /** Waits for several animation frames. */
  advance(frames: number): Promise<void>;
  /** Captures a frame and reads one pixel of it. */
  pixelAt(x: number, y: number): Promise<PixelRgba>;
  /** Captures a frame and reads its centre pixel. */
  centrePixel(): Promise<PixelRgba>;
  /** The mean luminance of a whole captured frame, 0 to 1. */
  meanLuminance(): Promise<number>;
  /** Starts the app. */
  start(): Promise<void>;
  /** Stops and disposes the app, and removes the canvas. */
  dispose(): void;
}

/** How {@link createSurfaceBrowserApp} sets the app up. */
export interface SurfaceBrowserAppOptions {
  /** The canvas edge, in device pixels. Small keeps SwiftShader fast. */
  readonly size?: number;
  /** Project settings, merged over `msaaSamples: 1`. */
  readonly settings?: SettingsInput;
  /** `false` leaves the app unstarted so the caller can build its world first. */
  readonly start?: boolean;
}

/**
 * Waits for one animation frame.
 *
 * @returns A promise that resolves inside the next frame callback.
 */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Builds an app on a real WebGPU device, with the shader adapter loaded.
 *
 * @remarks
 * The adapter is awaited because a surface shader's 1x1 sampler fallbacks come from it, and a test
 * that publishes a `ShaderAsset` directly skips the `.wgsl` loader that normally awaits it.
 *
 * @param options - The canvas size, the settings, and whether to start.
 * @returns The harness. Always `dispose()` it in an `afterEach`.
 */
export async function createSurfaceBrowserApp(options: SurfaceBrowserAppOptions = {}): Promise<SurfaceBrowserApp> {
  const size = options.size ?? 64;
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
    settings: {
      ...options.settings,
      rendering: { msaaSamples: 1, ...(options.settings?.["rendering"] as Record<string, unknown> | undefined) },
    },
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  // These harnesses publish `.wgsl` sources directly, so they load what the loader would.
  await Promise.all([loadShaderSupport(), loadSurfaceShaderSupport(), loadPostEffectSupport()]);
  if (options.start !== false) {
    await app.start();
  }

  const pixelAt = async (x: number, y: number): Promise<PixelRgba> => {
    const frame = await app.renderer.captureScreenshot();
    const pixel = createPixelRgba();
    const sampled = samplePixel(frame, x, y, pixel);
    if (sampled === null) {
      throw new Error(`(${String(x)}, ${String(y)}) is outside the capture`);
    }
    return sampled;
  };

  return {
    app,
    world: app.world,
    canvas,
    log,
    errors,
    publishShader: (address: string, source: string): AssetHandle<ShaderAsset> =>
      app.assets.register(new ShaderAsset(address, source, parseShaderDeclaration(source, address)), {
        type: SHADER_ASSET_TYPE,
        address,
      }),
    // Written as a promise chain because waiting for frame `n + 1` genuinely depends on frame `n`.
    advance: (frames: number): Promise<void> =>
      Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve()),
    pixelAt,
    centrePixel: (): Promise<PixelRgba> => pixelAt(canvas.width >> 1, canvas.height >> 1),
    meanLuminance: async (): Promise<number> => {
      const frame = await app.renderer.captureScreenshot();
      let total = 0;
      for (let index = 0; index < frame.data.length; index += 4) {
        total += 0.2126 * (frame.data[index] ?? 0);
        total += 0.7152 * (frame.data[index + 1] ?? 0);
        total += 0.0722 * (frame.data[index + 2] ?? 0);
      }
      return total / ((frame.data.length / 4) * 255);
    },
    start: (): Promise<void> => app.start(),
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
}
