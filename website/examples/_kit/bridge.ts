// oxlint-disable no-underscore-dangle -- `window.__ignifxFrameTime` is a harness hook, and the
// double underscore is what says it is not part of an example's API. `tests/visual/tests/
// frame-time.spec.ts` reads it by name, exactly as it reads the templates' probe.

/**
 * Everything inside an example frame that talks to something outside it: the viewer page it is
 * embedded in (`website/plan/04-examples-platform.md` §3, `08-execution.md` §4.3) and the
 * frame-budget harness (`tests/visual/tests/frame-time.spec.ts`).
 *
 * ## The `postMessage` protocol
 *
 * The frame is same-origin with the viewer, so the protocol exists for isolation rather than for
 * security: the example is a complete page that also happens to run inside an `<iframe>`, and the
 * viewer's toolbar has to be able to pause it and show its figures without reaching into its
 * document. Every message is posted to `window.parent` with `targetOrigin = location.origin`, so a
 * page on another origin that frames an example is told nothing.
 *
 * ## Which millisecond `frameMs` reports
 *
 * `frameMs` is **engine CPU milliseconds** — the sum of `FrameSample.cpuMs` over the frame's
 * phases, taken from `app.diagnostics` — and not a wall-clock frame time or a GPU time. Three
 * reasons, in order of weight:
 *
 * 1. It is the number the repository's own budgets are written against (coding standards §7,
 *    `benchmarks/baselines.json`), so a figure on the website and a figure in CI mean the same
 *    thing.
 * 2. It is the number an engine change moves. Wall-clock frame time on a visitor's machine is
 *    mostly their compositor and their GPU, and `tests/visual/tests/frame-time.spec.ts`'s header
 *    records the measurement that says so.
 * 3. `app.renderer.gpuFrameTimeMs` and `taskTimings()` need `profileTasks` and report
 *    `"unsupported"` wherever the browser withholds timestamp queries, which is most browsers.
 *
 * The trade-off is honest but worth stating: `frameMs` is what the engine costs, not what the
 * frame costs. The viewer labels it "engine CPU".
 *
 * Per-phase timings are only recorded in a development build (`app.diagnostics.isDevelopment`);
 * `createApp`'s `mode` defaults to `"development"` and no example overrides it, so a `vite build`
 * of an example still fills them in. When it does not, every sample is zero and the reader says so
 * rather than reporting a suspiciously fast game.
 */

import { createFrameSample } from "ignifx";
import type { App, FrameSample } from "ignifx";

declare global {
  interface Window {
    /**
     * Runs `frames` presented frames and answers with the engine CPU milliseconds each cost.
     * Installed only under `?bench=1`; the same hook, with the same name and the same units, that
     * `templates/*\/src/frame-time-probe.ts` installs.
     */
    __ignifxFrameTime?: (frames: number) => Promise<readonly number[]>;
  }
}

/** The `{ type: "ignifx:stats" }` message, posted every 500 ms while an example runs. */
export interface StatsMessage {
  /** The discriminant. */
  readonly type: "ignifx:stats";
  /** Engine CPU milliseconds for a recent frame, as the module comment defines it. */
  readonly frameMs: number;
  /** Draw calls in the last presented frame, from `app.renderer.drawCalls`. */
  readonly drawCalls: number;
}

/** Everything an example frame posts to the page that embedded it. */
export type FrameMessage =
  | StatsMessage
  | { readonly type: "ignifx:ready" }
  | { readonly type: "ignifx:unsupported"; readonly code: "IGX-0701" };

/** Everything the viewer posts into an example frame. */
export type ViewerMessage = { readonly type: "ignifx:pause" } | { readonly type: "ignifx:resume" };

/** What {@link Bridge.listen} calls when the viewer, or the browser, asks for a state change. */
export interface BridgeHandlers {
  /** The viewer pressed Pause, or the tab was hidden. */
  onPause: () => void;
  /** The viewer pressed Play, or the tab came back. */
  onResume: () => void;
}

/** The frame's end of the protocol. */
export interface Bridge {
  /** Posts `ignifx:ready`, once, after the first settled frame. */
  postReady(): void;
  /**
   * Posts one `ignifx:stats`.
   *
   * @param frameMs - Engine CPU milliseconds.
   * @param drawCalls - Draw calls in the last presented frame.
   */
  postStats(frameMs: number, drawCalls: number): void;
  /** Posts `ignifx:unsupported` with the WebGPU error code. */
  postUnsupported(): void;
  /**
   * Starts listening for viewer commands and page-visibility changes.
   *
   * @param handlers - What to run on pause and on resume.
   * @returns A function that stops listening.
   */
  listen(handlers: BridgeHandlers): () => void;
}

/** How many recent frames the stats reader takes a median over. About half a second at 60 Hz. */
const STATS_WINDOW_FRAMES = 30;

/**
 * Posts one message to whatever framed this page.
 *
 * @param message - The message.
 */
function post(message: FrameMessage): void {
  window.parent.postMessage(message, window.location.origin);
}

/**
 * Builds the frame's end of the viewer protocol.
 *
 * @returns The bridge. It is safe to use on a page that is not framed: `window.parent` is
 * `window` there, and the messages land on the example's own window where nothing listens.
 *
 * @example
 * ```ts
 * const bridge = createBridge();
 * const stop = bridge.listen({ onPause: () => app.pause(), onResume: () => app.resume() });
 * bridge.postReady();
 * ```
 */
export function createBridge(): Bridge {
  return {
    postReady(): void {
      post({ type: "ignifx:ready" });
    },
    postStats(frameMs: number, drawCalls: number): void {
      post({ type: "ignifx:stats", frameMs, drawCalls });
    },
    postUnsupported(): void {
      post({ type: "ignifx:unsupported", code: "IGX-0701" });
    },
    listen(handlers: BridgeHandlers): () => void {
      const onMessage = (event: MessageEvent<unknown>): void => {
        // Same-origin only: a page on another origin that frames an example may watch it, but it
        // may not drive it (`CONSTITUTION.md` §9.1 in spirit — nothing outside decides what runs).
        if (event.origin !== window.location.origin) {
          return;
        }
        const data: unknown = event.data;
        if (typeof data !== "object" || data === null || !("type" in data)) {
          return;
        }
        // A boundary assertion (coding standards §5.2): `type` is narrowed to a string below, and
        // anything that is not one of the two commands is ignored.
        const type: unknown = data.type;
        if (type === "ignifx:pause") {
          handlers.onPause();
        } else if (type === "ignifx:resume") {
          handlers.onResume();
        }
      };
      const onVisibility = (): void => {
        if (document.visibilityState === "hidden") {
          handlers.onPause();
        } else {
          handlers.onResume();
        }
      };
      window.addEventListener("message", onMessage);
      document.addEventListener("visibilitychange", onVisibility);
      return (): void => {
        window.removeEventListener("message", onMessage);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    },
  };
}

/** Reads the engine's own per-frame cost out of an app's diagnostics history. */
export interface StatsReader {
  /**
   * The median engine CPU milliseconds over the most recent frames.
   *
   * @returns The median, or `0` when the build records no per-phase timings.
   */
  frameMs(): number;
}

/**
 * Builds a stats reader over an app's diagnostics ring buffer.
 *
 * @remarks
 * A median over the last {@link STATS_WINDOW_FRAMES} frames rather than the last frame alone: one
 * frame's cost swings by a factor of three on a shadow-map rebuild, and a readout that jumps like
 * that reads as noise rather than as a measurement. `app.diagnostics` retains 300 frames, so the
 * window is already in memory and this allocates one sample and one array, once.
 *
 * @param app - The running app.
 * @returns The reader.
 */
export function createStatsReader(app: App): StatsReader {
  const sample: FrameSample = createFrameSample();
  const samples: Float64Array = new Float64Array(STATS_WINDOW_FRAMES);
  return {
    frameMs(): number {
      const count = Math.min(STATS_WINDOW_FRAMES, app.diagnostics.historyLength);
      if (count === 0) {
        return 0;
      }
      for (let offset = 0; offset < count; offset += 1) {
        app.diagnostics.readFrame(offset, sample);
        let total = 0;
        for (let phase = 0; phase < sample.cpuMs.length; phase += 1) {
          total += sample.cpuMs[phase] ?? 0;
        }
        samples[offset] = total;
      }
      const sorted = samples.subarray(0, count).toSorted();
      const middle = Math.floor(count / 2);
      if (count % 2 === 1) {
        return sorted[middle] ?? 0;
      }
      return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
    },
  };
}

/**
 * Installs `window.__ignifxFrameTime`, the `?bench=1` hook.
 *
 * @remarks
 * Byte for byte the same protocol as `templates/*\/src/frame-time-probe.ts`: one chained
 * `requestAnimationFrame` per presented frame, one number per frame, engine CPU milliseconds
 * summed over the phases. That is what lets `tests/visual/tests/frame-time.spec.ts` measure an
 * example with no change at all — it opens `?bench=1`, waits for `window.__ignifxReady`, and calls
 * `window.__ignifxFrameTime(n)`.
 *
 * @param app - The running app, whose `diagnostics` the probe reads.
 */
export function installFrameTimeProbe(app: App): void {
  const sample: FrameSample = createFrameSample();
  window.__ignifxFrameTime = (frames: number): Promise<readonly number[]> =>
    new Promise<readonly number[]>((resolve) => {
      const out: number[] = [];
      // A chained `requestAnimationFrame` rather than an awaited loop: one callback per presented
      // frame is exactly what is being measured, and it keeps the sampler off the microtask queue.
      const step = (): void => {
        // Offset 0 is the frame that just ended, which is the one this callback woke on.
        app.diagnostics.readFrame(0, sample);
        let total = 0;
        for (let phase = 0; phase < sample.cpuMs.length; phase += 1) {
          total += sample.cpuMs[phase] ?? 0;
        }
        out.push(total);
        if (out.length >= frames) {
          resolve(out);
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
}
