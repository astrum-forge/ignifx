// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of an example's API. The visual suite reads it by name,
// exactly as it reads `examples/hello-cube`'s.

/**
 * `bootExample` — the one call every example's `main.ts` makes
 * (`website/plan/04-examples-platform.md` §4, `08-execution.md` §4.3).
 *
 * It owns everything an example should not have to repeat: finding the canvas, creating the app,
 * registering devtools, catching the browser that has no WebGPU, the query flags the viewer and
 * the two test suites drive an example with, the `postMessage` bridge, the parameter panel, and
 * the pause that a hidden tab implies. **The kit is the only place an example touches the DOM.**
 * What is left in `main.ts` is the scene, which is the lesson.
 *
 * ## The query flags
 *
 * | Flag           | Effect                                                                        |
 * | -------------- | ----------------------------------------------------------------------------- |
 * | `?static=1`    | Stops the clock **before** `app.start()`; the pose is exactly what was authored |
 * | `?seed=<n>`    | Seeds {@link ExampleContext.random}; examples never call `Math.random`          |
 * | `?nopanel=1`   | The parameter panel is not mounted                                             |
 * | `?panel=…`     | `collapsed` or `open`, overriding the panel's own size heuristic                |
 * | `?autoplay=0`  | The scene is built but the loop waits for a click or an `ignifx:resume`        |
 * | `?bench=1`     | Installs the frame-time probe; implies no panel and autoplay                   |
 *
 * `08-execution.md` §4.3 words `?static=1` as "`time.timeScale = 0` after the first frame". This
 * stops the clock **before** `app.start()` instead, which is the one deviation in this file and is
 * deliberate: a single frame at a real delta advances every animating script by an amount that
 * depends on how fast the machine loaded the page, and `tests/visual/README.md` records that as the
 * reason the templates freeze before start rather than after. Freezing first is strictly more
 * deterministic and the flag's purpose — a reproducible capture — is the same.
 *
 * ## Seeded randomness
 *
 * `?seed` drives a mulberry32 generator on {@link ExampleContext.random}. Examples never call
 * `Math.random`, so two loads of one URL scatter the same crates in the same places and a golden
 * cannot rot on a lucky frame.
 */

import { createApp, devtools, input, isIgnifxError, ui } from "ignifx";
// The address-to-URL table `@ignifx/vite-plugin` built from `website/examples/assets/`. Importing
// the virtual module rather than fetching `assets.manifest.json` puts the table in the bundle, so
// the first asset request needs no round trip — and it resolves under `/examples/` because the
// plugin writes its URLs from `resolvedConfig.base`.
import { manifest } from "virtual:ignifx/manifest";
import { createBridge, createStatsReader, installFrameTimeProbe } from "./bridge.ts";
import { showFallback } from "./fallback.ts";
import { createPanel } from "./panel.ts";
import type { Panel, PanelOptions } from "./panel.ts";
import type { App, Extension, SettingsInput } from "ignifx";

declare global {
  interface Window {
    /**
     * Resolves once the example has presented a settled frame, or to `"unsupported"` when the
     * browser has no WebGPU. Assigned before the first `await`, so a test can read it as soon as
     * the document has loaded.
     */
    __ignifxReady: Promise<ExampleStatus>;
  }
}

/** What `window.__ignifxReady` resolves to. */
export type ExampleStatus = "ready" | "unsupported";

/** The query flags, parsed once. */
export interface ExampleFlags {
  /** `?static=1`: the clock is stopped before the first frame. */
  readonly isStatic: boolean;
  /** `?seed=<n>`: the seed {@link ExampleContext.random} was built from. */
  readonly seed: number;
  /** Whether the parameter panel was mounted: false under `?nopanel=1` and `?bench=1`. */
  readonly showPanel: boolean;
  /**
   * `?panel=collapsed` or `?panel=open`, or `"auto"` when the flag is absent — in which case the
   * panel decides from the frame's own size (`panel.ts`'s `prefersCollapsedPanel`). The viewer page
   * may set it; nothing in an example does.
   */
  readonly panelStart: "auto" | "collapsed" | "open";
  /** `?autoplay=0`: the loop waits for a click or an `ignifx:resume` before it starts. */
  readonly autoplay: boolean;
  /** `?bench=1`: the frame-time probe is installed. */
  readonly isBench: boolean;
}

/** What an example's `setup` is handed. */
export interface ExampleContext {
  /** The created app. Not started yet: `setup` runs before `app.start()`. */
  readonly app: App;
  /** The canvas the app draws into, for the rare example that needs its size. */
  readonly canvas: HTMLCanvasElement;
  /** The parsed query flags. */
  readonly flags: ExampleFlags;
  /**
   * The seeded generator every example uses instead of `Math.random`.
   *
   * Declared as a property rather than a method, here and below, so an example can destructure the
   * context — `setup({ app, panel })` — without the type-aware linter warning about an unbound
   * method. Nothing here reads `this`.
   *
   * @returns The next value in `[0, 1)`.
   */
  readonly random: () => number;
  /**
   * Mounts the parameter panel. A no-op returning `null` under `?nopanel=1` or `?bench=1`, so an
   * example needs no branch of its own.
   *
   * @param options - The title and the groups.
   * @returns The panel, or `null` when it was not mounted.
   */
  readonly panel: (options: PanelOptions) => Panel | null;
  /**
   * Runs after `app.start()` and before the frame is called settled — where a `PostProcessStack`'s
   * effects have to be switched on, because a task recorded before the scene is registered samples
   * the swapchain and WebGPU rejects the frame.
   *
   * @param callback - What to run.
   */
  readonly afterStart: (callback: () => void) => void;
}

/** What {@link bootExample} takes. */
export interface ExampleOptions {
  /** The example's title, used for the panel heading and the log line. */
  readonly title: string;
  /** Extra extensions. `input()`, `ui()` and `devtools()` are always registered, in that order. */
  readonly extensions?: readonly Extension[];
  /** The `rendering`, `time`, `layers` and extension settings, as `createApp` takes them. */
  readonly settings?: SettingsInput;
  /**
   * Builds the world. Runs after `createApp` and before `app.start()`, which is where a load has to
   * be awaited: before the loop runs a completed load settles at once.
   *
   * @param context - The app, the canvas, the flags, the seeded generator and the panel.
   * @returns Nothing, or a promise for when the world is standing.
   */
  setup(context: ExampleContext): Promise<void> | void;
}

/** How many animation frames a scene is given before its image is called settled. */
const SETTLE_FRAMES = 16;

/** How often stats are posted to the viewer, in milliseconds (`08-execution.md` §4.3). */
const STATS_INTERVAL_MS = 500;

/** The seed used when `?seed` is absent, so an unseeded load is still reproducible. */
const DEFAULT_SEED = 1;

/**
 * Builds a mulberry32 generator: 32 bits of state, one multiply and three shifts per value, and
 * the same sequence in every browser.
 *
 * @param seed - The seed. Any 32-bit value.
 * @returns A function answering the next value in `[0, 1)`.
 */
function createRandom(seed: number): () => number {
  // `| 0` is a 32-bit wrap, not a truncation: mulberry32 is defined over a 32-bit state and
  // `Math.trunc` would let the state grow past 2^32 and change the sequence.
  // oxlint-disable unicorn/prefer-math-trunc -- see above.
  let state = seed | 0;
  return (): number => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  // oxlint-enable unicorn/prefer-math-trunc
}

function noop(): void {
  // Nothing to do: the promise executor runs synchronously and replaces this on the next line.
}

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Waits for several animation frames, so a newly built scene has presented.
 *
 * @param frames - How many frames to wait for.
 * @returns A promise that resolves after the last of them.
 */
function settle(frames: number): Promise<void> {
  let chain = Promise.resolve();
  for (let index = 0; index < frames; index += 1) {
    chain = chain.then(nextFrame);
  }
  return chain;
}

/**
 * Reads the flags out of the page's query string.
 *
 * @param search - `window.location.search`.
 * @returns The flags.
 */
function readFlags(search: string): ExampleFlags {
  const query = new URLSearchParams(search);
  const isBench = query.get("bench") === "1";
  const seed = Number(query.get("seed") ?? DEFAULT_SEED);
  const panel = query.get("panel");
  return {
    panelStart: panel === "collapsed" || panel === "open" ? panel : "auto",
    isStatic: query.get("static") === "1" && !isBench,
    seed: Number.isFinite(seed) ? seed : DEFAULT_SEED,
    // A benchmark measures the engine, not the panel's four DOM writes a second.
    showPanel: query.get("nopanel") !== "1" && !isBench,
    autoplay: query.get("autoplay") !== "0" || isBench,
    isBench,
  };
}

/**
 * Mounts the small live region that announces the running state, and answers with the setter.
 *
 * @remarks
 * `04-examples-platform.md` §6 asks that a paused example be announced. A `role="status"` region is
 * the whole of it: the text is only visible while the example is paused (`kit.css` hides the
 * running state), and a screen reader hears the change either way.
 *
 * @returns A function that writes the state.
 */
function createStatusRegion(): (paused: boolean) => void {
  const region = document.createElement("p");
  region.className = "igx-status";
  region.setAttribute("role", "status");
  region.hidden = true;
  document.body.append(region);
  return (paused: boolean): void => {
    region.textContent = paused ? "Paused" : "Running";
    region.hidden = !paused;
  };
}

/**
 * Waits for the visitor to ask for the example to run, under `?autoplay=0`.
 *
 * @remarks
 * The viewer sends `?autoplay=0` when the visitor has `prefers-reduced-motion: reduce` set
 * (`02-design-system.md` §2.6), and then shows its own Play button — which posts `ignifx:resume`.
 * A click on the canvas does the same thing for an example opened standalone.
 *
 * @param canvas - The canvas a click on which starts the example.
 * @returns A promise that resolves on the first click or `ignifx:resume`.
 */
function waitForPlay(canvas: HTMLCanvasElement): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      canvas.removeEventListener("click", done);
      window.removeEventListener("message", onMessage);
      resolve();
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data: unknown = event.data;
      if (typeof data === "object" && data !== null && "type" in data && data.type === "ignifx:resume") {
        done();
      }
    };
    canvas.addEventListener("click", done);
    window.addEventListener("message", onMessage);
  });
}

/**
 * Boots an example.
 *
 * @remarks
 * Call it once, at the top level of `main.ts`, and let it own the lifecycle. It never throws: a
 * browser with no WebGPU gets the fallback panel, and any other failure reaches `window.onerror`
 * as an uncaught error rather than a swallowed rejection, which is what makes the visual suite's
 * `pageerror` listener useful.
 *
 * @param options - The title, the extensions, the settings and the `setup` that builds the world.
 *
 * @example
 * ```ts
 * bootExample({
 *   title: "Hello cube",
 *   settings: { rendering: { features: { shadows: true } } },
 *   setup({ app, panel }) {
 *     // …build the world, then declare the panel
 *   },
 * });
 * ```
 */
export function bootExample(options: ExampleOptions): void {
  // Assigned before the first `await` (`08-execution.md` §4.3): a test reads it as soon as the
  // document has loaded, and a promise that does not exist yet reads as `undefined`.
  let announce: (status: ExampleStatus) => void = noop;
  window.__ignifxReady = new Promise<ExampleStatus>((resolve) => {
    announce = resolve;
  });

  void run(options).then(announce, (error: unknown) => {
    announce("unsupported");
    // Rethrown out of the promise chain so it reaches `window.onerror` as an uncaught error rather
    // than a swallowed rejection. Examples never log through `console` (coding standards §5.5).
    setTimeout(() => {
      throw error;
    }, 0);
  });
}

/**
 * The body of {@link bootExample}, as a promise so the caller can keep its resolver synchronous.
 *
 * @param options - What `bootExample` was given.
 * @returns The status `window.__ignifxReady` resolves to.
 */
async function run(options: ExampleOptions): Promise<ExampleStatus> {
  const canvas = document.querySelector("#game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('an ignifx example needs a <canvas id="game"> element on the page.');
  }

  const flags = readFlags(window.location.search);
  const bridge = createBridge();

  let app: App;
  try {
    app = await createApp({
      canvas,
      settings: options.settings ?? {},
      assets: { manifest },
      // `input()` before `ui()`: the UI host finds the input service's focus flags structurally at
      // registration time, which is what makes a click on the panel stop at the panel. `devtools()`
      // last, so its overlay samples what every other system just wrote.
      extensions: [input(), ui(), ...(options.extensions ?? []), devtools()],
    });
  } catch (error) {
    // IGX-0701 is the one failure a shipped game must handle itself: the browser has no WebGPU and
    // ignifx has no fallback renderer by decision (ADR-0001).
    if (isIgnifxError(error) && error.code === "IGX-0701") {
      showFallback(canvas);
      bridge.postUnsupported();
      return "unsupported";
    }
    throw error;
  }

  const random = createRandom(flags.seed);
  let panel: Panel | null = null;
  const afterStart: (() => void)[] = [];
  const context: ExampleContext = {
    app,
    canvas,
    flags,
    random,
    panel: (panelOptions: PanelOptions): Panel | null => {
      if (!flags.showPanel) {
        return null;
      }
      // `exactOptionalPropertyTypes` is on, so `collapsed` is either set or absent — never
      // `undefined` — and "absent" is what lets the panel apply its own size heuristic.
      panel = createPanel(
        app,
        flags.panelStart === "auto" ? panelOptions : { ...panelOptions, collapsed: flags.panelStart === "collapsed" },
      );
      return panel;
    },
    afterStart: (callback: () => void): void => {
      afterStart.push(callback);
    },
  };

  await options.setup(context);

  if (flags.isStatic) {
    // Before `start()`, not after the first frame — see the module comment.
    app.time.timeScale = 0;
  }
  if (flags.isBench) {
    installFrameTimeProbe(app);
  }
  if (!flags.autoplay) {
    await waitForPlay(canvas);
  }

  await app.start();
  for (const callback of afterStart) {
    callback();
  }
  await settle(SETTLE_FRAMES);

  const setStatus = createStatusRegion();
  const stats = createStatsReader(app);
  let paused = false;
  const stopListening = bridge.listen({
    onPause(): void {
      if (paused) {
        return;
      }
      paused = true;
      app.pause();
      setStatus(true);
    },
    onResume(): void {
      if (!paused) {
        return;
      }
      paused = false;
      app.resume();
      setStatus(false);
    },
  });
  const timer = window.setInterval((): void => {
    // Nothing is posted while paused, which is what `tests/visual`'s viewer check asserts and what
    // makes a paused frame free.
    if (!paused) {
      bridge.postStats(stats.frameMs(), app.renderer.drawCalls);
    }
  }, STATS_INTERVAL_MS);
  window.addEventListener("pagehide", (): void => {
    window.clearInterval(timer);
    stopListening();
    panel?.dispose();
  });

  bridge.postReady();
  app.log.info(`${options.title} running:`, app.renderer.drawCalls, "draw calls");
  return "ready";
}
