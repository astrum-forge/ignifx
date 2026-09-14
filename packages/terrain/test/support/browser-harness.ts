import { createApp, createMemorySink } from "@ignifx/core";
import { terrain } from "../../src/extension.js";
import type { App, AssetHandle, ErrorReport, MemorySink, World } from "@ignifx/core";

/**
 * A real `createApp({ canvas })` with `@ignifx/terrain` registered, on a WebGPU device.
 *
 * What a browser suite has to prove is the half a headless app cannot reach: that the chunk meshes
 * reach the scene, that the generated splat shader compiles, and that hiding a chunk removes its
 * draw. `msaaSamples: 1` keeps a single-pixel assertion exact.
 */

/** The canvas edge used when a test names none. Small keeps SwiftShader fast. */
const DEFAULT_SIZE = 64;

/** How many frames a change is given to reach the screen before a test reads it. */
export const SETTLE_FRAMES = 8;

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

/** Options accepted by {@link createTerrainBrowserApp}. */
export interface TerrainBrowserOptions {
  /** The canvas width, in device pixels. */
  readonly width?: number;
  /** The canvas height, in device pixels. */
  readonly height?: number;
  /** Address to body, for the injected `fetch`. */
  readonly files?: Readonly<Record<string, ArrayBuffer | Uint8Array | string>>;
}

/** A running terrain app on a real device. */
export interface TerrainBrowserApp {
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
  /** Waits for several animation frames. */
  advance(frames: number): Promise<void>;
  /** Captures a frame and reads one pixel of it. */
  pixelAt(x: number, y: number): Promise<Rgba>;
  /** Captures a frame and reads its centre pixel. */
  centrePixel(): Promise<Rgba>;
  /** Loads an address and waits for it. */
  load<T>(address: string): Promise<AssetHandle<T>>;
  /** Starts the app. */
  start(): Promise<void>;
  /** Disposes the app and removes the canvas. */
  dispose(): void;
}

/**
 * Waits for one animation frame.
 *
 * @returns A promise that settles on the next frame.
 */
export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Answers asset reads from a table, and lets `data:` URLs through to the platform.
 *
 * @param files - Address to body.
 * @returns A `fetch` the asset service can read through.
 */
function tableFetch(files: Readonly<Record<string, ArrayBuffer | Uint8Array | string>>): typeof globalThis.fetch {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("data:")) {
      return globalThis.fetch(input);
    }
    const address = url.replace(/^assets\//u, "");
    const body = files[url] ?? files[address] ?? null;
    if (body === null) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    // `Response` accepts a `Uint8Array` at runtime; the DOM typing names `BodyInit`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Promise.resolve(new Response(body as BodyInit, { status: 200 }));
  };
}

/**
 * Builds a running terrain app on a real WebGPU device.
 *
 * @param options - Canvas size and the fixture table.
 * @returns The harness, not yet started.
 */
export async function createTerrainBrowserApp(options: TerrainBrowserOptions = {}): Promise<TerrainBrowserApp> {
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
    fetch: tableFetch(options.files ?? {}),
    extensions: [terrain()],
    settings: { rendering: { msaaSamples: 1 } },
  });
  app.onError.connect((report) => {
    errors.push(report);
  });

  const advance = (frames: number): Promise<void> =>
    Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve());

  const pixelAt = async (x: number, y: number): Promise<Rgba> => {
    const frame = await app.renderer.captureScreenshot();
    const offset = (y * frame.width + x) * 4;
    return {
      r: frame.data[offset] ?? 0,
      g: frame.data[offset + 1] ?? 0,
      b: frame.data[offset + 2] ?? 0,
      a: frame.data[offset + 3] ?? 0,
    };
  };

  return {
    app,
    world: app.world,
    canvas,
    log,
    errors,
    advance,
    pixelAt,
    centrePixel: (): Promise<Rgba> => pixelAt(width >> 1, height >> 1),
    load: async <T>(address: string): Promise<AssetHandle<T>> => {
      const handle = app.assets.load<T>(address);
      await handle.promise;
      return handle;
    },
    start: (): Promise<void> => app.start(),
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
}
