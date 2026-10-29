import { createApp, createAssetManifest, createMemorySink } from "@ignifx/core";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";
import { threeD } from "../../src/index.js";
import type { ThreeDOptions } from "../../src/index.js";
import type { App, AssetManifestEntry, ErrorReport, MemorySink, SettingsInput, World } from "@ignifx/core";

/**
 * A real `createApp({ canvas })` with `@ignifx/3d` registered, on a WebGPU device.
 *
 * What the browser project has to prove about Phase 7 is the half a headless suite cannot reach:
 * that a `.glb` really carries four clips and a skeleton, that the `Animator` really poses that
 * skeleton on ignifx's clock, and that a crossfade really reaches Lite's mixer. Everything else —
 * the state machine, navigation, the controllers, the camera rig — is already covered on the null
 * engine.
 *
 * `msaaSamples: 1` throughout, so a pixel comparison is exact rather than a resolve of four samples
 * (ADR-0002 Validation).
 */

/** The canvas edge the harness uses when a test names none. Small keeps SwiftShader fast. */
const DEFAULT_SIZE = 96;

/** How many frames a change is given to reach the screen before a test reads it. */
export const SETTLE_FRAMES = 6;

/** The most frames {@link ThreeDBrowserApp.settle} and {@link ThreeDBrowserApp.stableCapture} wait. */
const MAX_WAIT_FRAMES = 600;

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

/** A captured frame with a pixel reader. */
export interface Capture {
  /** The capture width, in device pixels. */
  readonly width: number;
  /** The capture height. */
  readonly height: number;
  /** The raw RGBA bytes. */
  readonly data: Uint8ClampedArray;
  /**
   * Reads one pixel.
   *
   * @param x - The column, from the left.
   * @param y - The row, from the top.
   * @returns The pixel, or transparent black when the coordinate is outside the frame.
   */
  at(x: number, y: number): Rgba;
}

/** Options accepted by {@link createThreeDBrowserApp}. */
export interface ThreeDBrowserOptions {
  /** The canvas width, in device pixels. */
  readonly width?: number;
  /** The canvas height, in device pixels. */
  readonly height?: number;
  /** Project settings, merged over the harness's own. */
  readonly settings?: SettingsInput;
  /** What to pass `threeD(...)`. */
  readonly options?: ThreeDOptions;
  /** Manifest entries for the fixture assets a test loads. */
  readonly assets?: readonly AssetManifestEntry[];
  /** Whether to build an edit-mode app (ADR-0028). */
  readonly editMode?: boolean;
}

/** A running 3D app on a real device. */
export interface ThreeDBrowserApp {
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
  /** Captures a whole frame. */
  capture(): Promise<Capture>;
  /**
   * Waits until the renderer owes no renderable rebuild, then for {@link SETTLE_FRAMES} more frames.
   *
   * @remarks
   * Adding a model queues a rebuild that runs between frames and takes as long as the machine makes
   * it take; the first skinned model in a page needs a second one for its new layouts. A capture
   * taken before it lands shows the old renderables, so a test waits for it rather than for a frame
   * count.
   */
  settle(): Promise<void>;
  /**
   * Captures frames until two in a row are identical, and returns the last.
   *
   * @remarks
   * Only for a still scene (an edit-mode or paused app), where a frame that still changes is one
   * that has not caught up with the scene yet.
   */
  stableCapture(): Promise<Capture>;
  /** Disposes the app and removes the canvas. */
  dispose(): void;
}

/** Waits for one animation frame. */
export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Where a checked-in 3D fixture is served from.
 *
 * @param name - The file name.
 * @returns The URL the dev server exposes it at.
 */
export function fixtureUrl(name: string): string {
  return `/tests/fixtures/assets/3d/${name}`;
}

/**
 * The manifest entries the 3D fixtures need.
 *
 * @returns The entries.
 */
export function fixtureAssets(): readonly AssetManifestEntry[] {
  return [
    { address: "3d/rig.glb", url: fixtureUrl("rig.glb"), type: "model" },
    { address: "3d/hero.animator.json", url: fixtureUrl("hero.animator.json"), type: "animator" },
    // `@ignifx/3d` requires `@ignifx/physics`, which loads its `.wasm` through the manifest under
    // the bare file name the Vite plugin copies it to (`docs/architecture/09-physics.md` §7).
    { address: "HavokPhysics.wasm", url: HAVOK_URL },
  ];
}

/** Where Vitest's browser project serves `@babylonjs/havok`'s binary from. */
const HAVOK_URL = "/packages/3d/node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm";

/**
 * How many bytes of two captures differ by more than a software rasteriser's noise.
 *
 * @param left - One capture.
 * @param right - The other.
 * @param tolerance - The per-channel slack, in bytes.
 * @returns The number of differing bytes.
 */
export function differingBytes(left: Capture, right: Capture, tolerance = 6): number {
  let differing = 0;
  const length = Math.min(left.data.length, right.data.length);
  for (let index = 0; index < length; index += 1) {
    if (Math.abs((left.data[index] ?? 0) - (right.data[index] ?? 0)) > tolerance) {
      differing += 1;
    }
  }
  return differing;
}

/**
 * Builds a running 3D app on a real WebGPU device.
 *
 * @param options - Canvas size, settings, extension options, and manifest entries.
 * @returns The harness.
 */
export async function createThreeDBrowserApp(options: ThreeDBrowserOptions = {}): Promise<ThreeDBrowserApp> {
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
    ...(options.editMode === undefined ? {} : { editMode: options.editMode }),
    logSink: log,
    logLevel: "debug",
    assets: { manifest: createAssetManifest(options.assets ?? fixtureAssets()) },
    extensions: [physics(), input(), threeD(options.options)],
    settings: {
      ...options.settings,
      rendering: { msaaSamples: 1, ...(options.settings?.["rendering"] as Record<string, unknown> | undefined) },
    },
  });
  app.onError.connect((report) => {
    errors.push(report);
  });
  await app.start();

  // Written as a promise chain rather than a loop because waiting for frame `n + 1` genuinely
  // depends on frame `n` having happened.
  const advance = (frames: number): Promise<void> =>
    Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve());

  const capture = async (): Promise<Capture> => {
    const frame = await app.renderer.captureScreenshot();
    return {
      width: frame.width,
      height: frame.height,
      data: frame.data,
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

  // `isRebuildInFlight` is `@internal` to `@ignifx/core` (`RendererImpl`); core's own
  // `change-during-rebuild.browser.test.ts` waits on the same flag. Read it by name so a rename
  // fails here loudly instead of passing silently.
  const isRebuildInFlight = (): boolean => {
    const flag: unknown = Reflect.get(app.renderer, "isRebuildInFlight");
    if (typeof flag !== "boolean") {
      throw new TypeError("app.renderer.isRebuildInFlight is gone; update the 3D browser harness.");
    }
    return flag;
  };

  const settle = async (left = MAX_WAIT_FRAMES): Promise<void> => {
    if (!isRebuildInFlight()) {
      await advance(SETTLE_FRAMES);
      if (!isRebuildInFlight()) {
        return;
      }
    }
    if (left <= 0) {
      throw new Error(`The renderer was still rebuilding after ${String(MAX_WAIT_FRAMES)} frames.`);
    }
    await nextFrame();
    return settle(left - 1);
  };

  const stableCapture = async (previous?: Capture, left = MAX_WAIT_FRAMES): Promise<Capture> => {
    const frame = await capture();
    if (previous !== undefined && differingBytes(previous, frame, 0) === 0) {
      return frame;
    }
    if (left <= 0) {
      throw new Error(`The frame was still changing after ${String(MAX_WAIT_FRAMES)} captures.`);
    }
    return stableCapture(frame, left - 1);
  };

  return {
    app,
    world: app.world,
    canvas,
    log,
    errors,
    nextFrame,
    advance,
    capture,
    settle: (): Promise<void> => settle(),
    stableCapture: (): Promise<Capture> => stableCapture(),
    dispose: (): void => {
      app.dispose();
      canvas.remove();
    },
  };
}
