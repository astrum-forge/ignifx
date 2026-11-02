// oxlint-disable no-underscore-dangle -- `window.__ignifxFrameTime` and `window.__ignifxGpuTime` are
// test hooks, and the double underscore says they are not part of the game's API. The frame-time
// and GPU-budget suites read them by name.
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
    /**
     * Turns on per-task GPU timing, runs `frames` presented frames and answers with the GPU
     * milliseconds of each. Installed only under `?bench=1`.
     */
    __ignifxGpuTime?: (frames: number) => Promise<GpuTimeSamples>;
  }
}

/** What `window.__ignifxGpuTime` answers with. */
export interface GpuTimeSamples {
  /** `renderer.taskTimings().status` after the last measured frame. */
  readonly status: string;
  /** `renderer.gpuFrameTimeMs` after each frame. */
  readonly frameMs: readonly number[];
  /** Each frame-graph task's GPU milliseconds, one entry per frame that had a snapshot. */
  readonly taskMs: Readonly<Record<string, readonly number[]>>;
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

/**
 * Installs `window.__ignifxGpuTime`, the GPU half of the `?bench=1` hook.
 *
 * @remarks
 * Only meaningful on a host GPU: the `gpu-budget` Playwright project runs it there, and SwiftShader
 * timestamps measure the software rasteriser. The probe turns `renderer.profileTasks` on, which
 * costs timestamp queries, so it is never on outside a measurement.
 *
 * @param app - The running app, whose `renderer` the probe reads.
 */
export function installGpuTimeProbe(app: App): void {
  window.__ignifxGpuTime = (frames: number): Promise<GpuTimeSamples> =>
    new Promise<GpuTimeSamples>((resolve) => {
      app.renderer.profileTasks = true;
      const frameMs: number[] = [];
      const taskMs: Record<string, number[]> = {};
      let status = "pending";
      const step = (): void => {
        frameMs.push(app.renderer.gpuFrameTimeMs);
        const timings = app.renderer.taskTimings();
        status = timings.status;
        for (const task of timings.tasks) {
          (taskMs[task.name] ??= []).push(task.durationMs);
        }
        if (frameMs.length >= frames) {
          app.renderer.profileTasks = false;
          resolve({ status, frameMs, taskMs });
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
}
