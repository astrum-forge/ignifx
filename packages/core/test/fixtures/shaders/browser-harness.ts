import { createApp } from "../../../src/app/app.js";
import { createPixelRgba, samplePixel } from "../../../src/lite/screenshot.js";
import { createMemorySink } from "../../../src/log/memory-sink.js";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import { createMaterialAsset } from "../../../src/render/material-asset.js";
import { loadPostEffectSupport } from "../../../src/render/post-effect-support.js";
import { SHADER_ASSET_TYPE, ShaderAsset } from "../../../src/render/shader-asset.js";
import { shaderMaterialDefinition } from "../../../src/render/shader-material-definition.js";
import { parseShaderDeclaration } from "../../../src/render/shader-pragma.js";
import { loadShaderSupport, loadSurfaceShaderSupport } from "../../../src/render/shader-support.js";
import type { App, ErrorReport } from "../../../src/app/types.js";
import type { AssetHandle } from "../../../src/assets/types.js";
import type { PixelRgba } from "../../../src/lite/screenshot.js";
import type { MemorySink } from "../../../src/log/memory-sink.js";
import type { MaterialAsset } from "../../../src/render/material-asset.js";
import type { World } from "../../../src/world/world.js";

/**
 * A real `createApp({ canvas })` with the shader layer registered, for the custom-WGSL browser
 * suite.
 *
 * It builds its own app rather than reusing `test/render/support/browser-harness.ts` because the
 * shader layer needs one extra thing that harness cannot pass: the `PreRender` uniform system, which
 * `src/extension/core-extension.ts` will register once this wave is integrated but which this brief
 * does not own. Shaders are supplied as strings and published straight into the asset cache, so no
 * fixture file and no network are involved.
 */

/** The canvas edge the harness uses. Small keeps SwiftShader fast. */
const DEFAULT_SIZE = 48;

/** How many frames a change is given to reach the screen before a test reads it. */
export const SHADER_SETTLE_FRAMES = 14;

/** A running app with the shader layer registered. */
export interface ShaderBrowserApp {
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
  /** Publishes a shader and a `"shader"` material built on it. */
  shaderMaterial(
    address: string,
    source: string,
    values?: Readonly<Record<string, number | readonly number[]>>,
  ): AssetHandle<MaterialAsset>;
  /** Waits for several animation frames. */
  advance(frames: number): Promise<void>;
  /** Captures a frame and reads its centre pixel. */
  centrePixel(): Promise<PixelRgba>;
  /** Starts the app. */
  start(): Promise<void>;
  /** Stops and disposes the app, and removes the canvas. */
  dispose(): void;
}

/** How {@link createShaderBrowserApp} sets the app up. */
export interface ShaderBrowserAppOptions {
  /** The canvas edge, in device pixels. */
  readonly size?: number;
  /** `false` leaves the app unstarted so the caller can warm materials up first. */
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
 * Builds an app on a real WebGPU device with a camera, a light, and the shader layer registered.
 *
 * @param options - The canvas size, and whether to start.
 * @returns The harness. Always `dispose()` it in a `finally` or an `afterEach`.
 */
export async function createShaderBrowserApp(options: ShaderBrowserAppOptions = {}): Promise<ShaderBrowserApp> {
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
    settings: { rendering: { msaaSamples: 1 } },
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  // The adapter is normally loaded by the `.wgsl` loader; these tests publish sources directly.
  // These harnesses publish `.wgsl` sources directly, so they load what the loader would.
  await Promise.all([loadShaderSupport(), loadSurfaceShaderSupport(), loadPostEffectSupport()]);

  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -3);
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  const sun = app.world.createEntity("Sun");
  sun.addComponent(Light, { type: "hemispheric", intensity: 1 });

  const publishShader = (address: string, source: string): AssetHandle<ShaderAsset> =>
    app.assets.register(new ShaderAsset(address, source, parseShaderDeclaration(source, address)), {
      type: SHADER_ASSET_TYPE,
      address,
    });

  if (options.start !== false) {
    await app.start();
  }

  return {
    app,
    world: app.world,
    canvas,
    log,
    errors,
    publishShader,
    shaderMaterial: (
      address: string,
      source: string,
      values: Readonly<Record<string, number | readonly number[]>> = {},
    ): AssetHandle<MaterialAsset> => {
      publishShader(address, source);
      return createMaterialAsset(app, shaderMaterialDefinition({ shader: address, values }), []);
    },
    // Written as a promise chain because waiting for frame `n + 1` genuinely depends on frame `n`.
    advance: (frames: number): Promise<void> =>
      Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve()),
    centrePixel: async (): Promise<PixelRgba> => {
      const frame = await app.renderer.captureScreenshot();
      const pixel = createPixelRgba();
      const sampled = samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel);
      if (sampled === null) {
        throw new Error("the capture was empty");
      }
      return sampled;
    },
    start: (): Promise<void> => app.start(),
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
}
