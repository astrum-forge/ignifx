// oxlint-disable no-underscore-dangle -- `window.__ignifxFrameTime` is a test hook, and the double
// underscore is what says it is not part of the game's API. The frame-time suite reads it by name.
import { createFrameSample } from "@ignifx/core";
import type { App } from "@ignifx/core";

/**
 * The `?bench=1` hook: `window.__ignifxFrameTime(n)` runs `n` presented frames and answers with the
 * **engine CPU milliseconds** each of them cost.
 *
 * ## Why CPU time and not frames per second
 *
 * The suite that calls this runs Chromium on SwiftShader, a software rasteriser: wall-clock frame
 * rate there measures the rasteriser, not the engine, and would be an order of magnitude off any
 * real device. `app.diagnostics` records per-phase CPU time for every frame
 * (`FrameSample.cpuMs`, one entry per `Phase`), which is the number the coding standards' §7 budget
 * is actually about — "engine CPU per frame" — and the number a change to the engine moves.
 *
 * Per-phase timings are only recorded in a development build. `createApp`'s `mode` defaults to
 * `"development"` and no template overrides it, so a `vite build` of a template still fills them
 * in; if a project sets `mode: "production"`, this probe reports zeros and the harness says so.
 */

declare global {
  interface Window {
    /**
     * Runs `frames` presented frames and answers with the engine CPU milliseconds each cost.
     * Installed only under `?bench=1`.
     */
    __ignifxFrameTime?: (frames: number) => Promise<readonly number[]>;
  }
}

/**
 * Installs `window.__ignifxFrameTime`.
 *
 * @param app - The running app, whose `diagnostics` the probe reads.
 */
export function installFrameTimeProbe(app: App): void {
  const sample = createFrameSample();
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
