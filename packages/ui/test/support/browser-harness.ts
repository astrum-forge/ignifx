import { createApp, createAssetManifest } from "@ignifx/core";
import { ui } from "../../src/index.js";
import type { UiOptions } from "../../src/index.js";
import type { App, AssetManifestEntry, Extension, RenderCapture, SettingsInput } from "@ignifx/core";

/**
 * The Chromium harness for `@ignifx/ui` (`docs/architecture/07-rendering.md` §1, coding
 * standards §10).
 *
 * The node suites prove the arithmetic; what only a browser can prove is the wiring — that the root
 * really lands over the canvas, that a `pointer-events: auto` child really takes the press, that a
 * focused field really stops keyboard actions, and that Babylon Lite's text pass really puts glyph
 * pixels where the layout said it would.
 *
 * The canvas is laid out inside a `position: fixed` wrapper at the viewport origin, which is what
 * makes a `getBoundingClientRect()` assertion arithmetic rather than a guess: the wrapper is the
 * overlay root's containing block, so a UI unit and a client coordinate share an origin.
 */

/** How many animation frames a change is given to reach the swapchain. */
export const SETTLE_FRAMES = 6;

/** One RGBA8 pixel. */
export interface Rgba {
  /** The red channel, 0-255. */
  readonly r: number;
  /** The green channel. */
  readonly g: number;
  /** The blue channel. */
  readonly b: number;
  /** The alpha channel. */
  readonly a: number;
}

/** A running app with a laid-out canvas and an overlay. */
export interface UiBrowserApp {
  /** The app. */
  readonly app: App;
  /** The canvas the overlay covers. */
  readonly canvas: HTMLCanvasElement;
  /** The fixed-position wrapper both live in. */
  readonly wrapper: HTMLDivElement;
  /** Waits for a number of animation frames. */
  advance(frames?: number): Promise<void>;
  /** Captures the presented frame. */
  capture(): Promise<Capture>;
  /** Disposes the app and removes the wrapper. */
  dispose(): void;
}

/** A captured frame with pixel lookup. */
export interface Capture {
  /** The width, in device pixels. */
  readonly width: number;
  /** The height, in device pixels. */
  readonly height: number;
  /**
   * Reads one pixel.
   *
   * @param x - The column.
   * @param y - The row, from the top.
   * @returns The pixel.
   */
  at(x: number, y: number): Rgba;
}

/** What {@link createUiBrowserApp} accepts. */
export interface UiBrowserOptions {
  /** The canvas's CSS and backing-store width. Defaults to `256`. */
  readonly width?: number;
  /** The canvas's CSS and backing-store height. Defaults to `256`. */
  readonly height?: number;
  /** Project settings. */
  readonly settings?: SettingsInput;
  /** What to pass `ui(...)`. */
  readonly options?: UiOptions;
  /** Extra extensions, registered before `ui()`. */
  readonly extensions?: readonly Extension[];
  /** Manifest entries, for the tests that load a fixture asset. */
  readonly assets?: readonly AssetManifestEntry[];
  /** Whether to start the render loop. Defaults to `true`. */
  readonly autoStart?: boolean;
}

/**
 * Waits for one animation frame.
 *
 * @returns A promise that settles on the next frame.
 */
export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * The URL a checked-in UI fixture is served from. Vitest's browser project serves the repository
 * root, so a repository-relative path is the URL path.
 *
 * @param name - The file name.
 * @returns The absolute URL.
 */
export function fixtureUrl(name: string): string {
  return `/tests/fixtures/assets/ui/${name}`;
}

/**
 * The manifest entries the text suites load.
 *
 * @returns The font and the translation document.
 */
export function fixtureAssets(): readonly AssetManifestEntry[] {
  return [
    { address: "ui/font.ttf", url: fixtureUrl("ShareTechMono-Regular.ttf"), type: "font" },
    { address: "ui/strings.i18n.json", url: fixtureUrl("strings.i18n.json"), type: "i18n" },
  ];
}

/**
 * Wraps a capture in a pixel reader.
 *
 * @param capture - What the renderer read back.
 * @returns The reader.
 */
function readCapture(capture: RenderCapture): Capture {
  return {
    width: capture.width,
    height: capture.height,
    at: (x: number, y: number): Rgba => {
      const offset = (y * capture.width + x) * 4;
      return {
        r: capture.data[offset] ?? 0,
        g: capture.data[offset + 1] ?? 0,
        b: capture.data[offset + 2] ?? 0,
        a: capture.data[offset + 3] ?? 0,
      };
    },
  };
}

/**
 * Builds and starts an app with a laid-out canvas and the UI extension registered.
 *
 * @param options - The canvas size, the settings, the extensions, and the extension options.
 * @returns The running app.
 */
export async function createUiBrowserApp(options: UiBrowserOptions = {}): Promise<UiBrowserApp> {
  const width = options.width ?? 256;
  const height = options.height ?? 256;
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "0px";
  wrapper.style.top = "0px";
  wrapper.style.width = `${String(width)}px`;
  wrapper.style.height = `${String(height)}px`;
  document.body.append(wrapper);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.width = `${String(width)}px`;
  canvas.style.height = `${String(height)}px`;
  wrapper.append(canvas);
  const app = await createApp({
    canvas,
    assets: { manifest: createAssetManifest(options.assets ?? []) },
    extensions: [...(options.extensions ?? []), ui(options.options)],
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  });
  const advance = (frames = SETTLE_FRAMES): Promise<void> =>
    Array.from({ length: frames }).reduce<Promise<void>>((chain) => chain.then(nextFrame), Promise.resolve());
  if (options.autoStart !== false) {
    await app.start();
  }
  const running: UiBrowserApp = {
    app,
    canvas,
    wrapper,
    advance,
    capture: async (): Promise<Capture> => readCapture(await app.renderer.captureScreenshot()),
    dispose: (): void => {
      app.dispose();
      wrapper.remove();
    },
  };
  await advance();
  return running;
}
