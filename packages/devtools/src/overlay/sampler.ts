import { PHASE_COUNT, PHASE_NAMES } from "@ignifx/core";
import type { App, DiagnosticsGroup, FrameSample } from "@ignifx/core";

/**
 * The once-per-frame snapshot the Stats and Timeline panels read
 * (`docs/architecture/15-devtools-and-diagnostics.md` §3, §4).
 *
 * The sampler is the only per-frame code devtools runs, and it allocates nothing: the sample is one
 * long-lived object whose numeric fields are written in place, the per-phase timings live in a
 * preallocated `Float64Array`, and the counter groups are resolved to indices once
 * (coding standards §7).
 */

/** One frame's worth of numbers, written in place by {@link DevtoolsSampler}. */
export interface DevtoolsSample {
  /** The monotonically increasing frame number. */
  frame: number;
  /** Frames per second, exponentially smoothed so the readout does not flicker. */
  fps: number;
  /** The smoothed wall-clock frame time, in milliseconds. */
  frameMs: number;
  /** CPU milliseconds this frame, summed over the phases; `0` outside development builds. */
  cpuMs: number;
  /** The renderer's last GPU frame time, in milliseconds; `0` when the host cannot measure it. */
  gpuMs: number;
  /** Draw calls submitted last frame. */
  drawCalls: number;
  /** How many fixed steps ran this frame. */
  fixedSteps: number;
  /** How many scripts received `update` this frame. */
  scriptsUpdated: number;
  /** How many coroutines were resumed this frame. */
  coroutinesResumed: number;
  /** Live entities, as the scene-tree index last counted them. */
  entities: number;
  /** Live components, as the scene-tree index last counted them. */
  components: number;
  /** Assets whose load finished. */
  assetsLoaded: number;
  /** Assets currently loading. */
  assetsInFlight: number;
  /** Bytes fetched by the asset service so far. */
  assetBytes: number;
  /** `performance.memory.usedJSHeapSize`, or `-1` on a host that does not expose it. */
  heapBytes: number;
  /** CPU milliseconds per phase, indexed by `Phase`; always {@link PHASE_COUNT} long. */
  readonly phaseMs: Float64Array;
}

/**
 * Allocates a zeroed sample.
 *
 * @returns The sample.
 */
export function createDevtoolsSample(): DevtoolsSample {
  return {
    frame: 0,
    fps: 0,
    frameMs: 0,
    cpuMs: 0,
    gpuMs: 0,
    drawCalls: 0,
    fixedSteps: 0,
    scriptsUpdated: 0,
    coroutinesResumed: 0,
    entities: 0,
    components: 0,
    assetsLoaded: 0,
    assetsInFlight: 0,
    assetBytes: 0,
    heapBytes: -1,
    phaseMs: new Float64Array(PHASE_COUNT),
  };
}

/** The phase names, exported so the Timeline panel labels its bands without re-deriving them. */
export const DEVTOOLS_PHASE_NAMES: readonly string[] = PHASE_NAMES;

/**
 * How much of the previous smoothed value each new frame keeps. `0.9` settles in about a fifth of a
 * second at 60 fps, which is slow enough to read and fast enough to see a stall.
 */
const SMOOTHING = 0.9;

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Reads `performance.memory.usedJSHeapSize`, which only Chromium exposes and which the DOM lib does
 * not declare.
 *
 * @returns The heap size in bytes, or `-1` when the host has no such counter.
 */
function readHeapBytes(): number {
  if (typeof performance === "undefined") {
    return -1;
  }
  const memory: unknown = Reflect.get(performance, "memory");
  if (memory === null || typeof memory !== "object") {
    return -1;
  }
  const used: unknown = Reflect.get(memory, "usedJSHeapSize");
  return typeof used === "number" ? used : -1;
}

/**
 * Fills a {@link DevtoolsSample} from `app.diagnostics`, `app.renderer`, and the registered counter
 * groups.
 *
 * @internal
 */
export class DevtoolsSampler {
  /** The sample the panels read. It is one object, rewritten every frame. */
  readonly sample: DevtoolsSample = createDevtoolsSample();

  readonly #app: App;
  #assets: DiagnosticsGroup | null = null;
  #assetsLoaded = -1;
  #assetsInFlight = -1;
  #assetBytes = -1;
  #render: DiagnosticsGroup | null = null;
  #drawCalls = -1;
  #gpuMs = -1;
  #resolved = false;

  /**
   * Binds a sampler to an app.
   *
   * @param app - The app to sample.
   */
  constructor(app: App) {
    this.#app = app;
  }

  /**
   * Reads this frame's numbers into {@link DevtoolsSampler.sample}.
   *
   * @param entities - The entity count the scene-tree index last produced.
   * @param components - The component count the scene-tree index last produced.
   */
  update(entities: number, components: number): void {
    this.#resolve();
    const app = this.#app;
    const frame = app.diagnostics.frame;
    const sample = this.sample;
    sample.frame = frame.frame;
    const deltaMs = frame.rawDeltaMs;
    sample.frameMs = sample.frameMs === 0 ? deltaMs : sample.frameMs * SMOOTHING + deltaMs * (1 - SMOOTHING);
    sample.fps = sample.frameMs > 0 ? MILLISECONDS_PER_SECOND / sample.frameMs : 0;
    sample.fixedSteps = frame.fixedSteps;
    sample.scriptsUpdated = frame.scriptsUpdated;
    sample.coroutinesResumed = frame.coroutinesResumed;
    let cpu = 0;
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      const value = frame.cpuMs[phase] ?? 0;
      sample.phaseMs[phase] = value;
      cpu += value;
    }
    sample.cpuMs = cpu;
    sample.entities = entities;
    sample.components = components;
    sample.gpuMs = this.#counter(this.#render, this.#gpuMs, app.renderer.gpuFrameTimeMs);
    sample.drawCalls = this.#counter(this.#render, this.#drawCalls, app.renderer.drawCalls);
    sample.assetsLoaded = this.#counter(this.#assets, this.#assetsLoaded, 0);
    sample.assetsInFlight = this.#counter(this.#assets, this.#assetsInFlight, 0);
    sample.assetBytes = this.#counter(this.#assets, this.#assetBytes, 0);
    sample.heapBytes = readHeapBytes();
  }

  /**
   * Copies the whole frame history into a caller-owned array of samples, oldest first, so the
   * Timeline panel plots 300 frames without allocating one object per frame.
   *
   * @param out - The sample to read each frame into; build it with `createFrameSample()`.
   * @param visit - Called once per recorded frame, oldest first.
   */
  history(out: FrameSample, visit: (sample: FrameSample) => void): void {
    const diagnostics = this.#app.diagnostics;
    for (let offset = diagnostics.historyLength - 1; offset >= 0; offset -= 1) {
      visit(diagnostics.readFrame(offset, out));
    }
  }

  /**
   * Reads one counter, falling back to a renderer property when the group is absent.
   *
   * @param group - The group, or `null` when nothing registered it.
   * @param index - The counter index, or `-1` when the group has no such counter.
   * @param fallback - What to answer without the counter.
   * @returns The value.
   */
  #counter(group: DiagnosticsGroup | null, index: number, fallback: number): number {
    if (group === null || index < 0) {
      return fallback;
    }
    return group.get(index);
  }

  /** Resolves the counter groups and their indices once, on the first sampled frame. */
  #resolve(): void {
    if (this.#resolved) {
      return;
    }
    this.#resolved = true;
    const diagnostics = this.#app.diagnostics;
    const render = diagnostics.group("render");
    if (render !== null) {
      this.#render = render;
      this.#drawCalls = indexOf(render, "drawCalls");
      this.#gpuMs = indexOf(render, "gpuFrameTimeMs");
    }
    const assets = diagnostics.group("assets");
    if (assets !== null) {
      this.#assets = assets;
      this.#assetsLoaded = indexOf(assets, "loaded");
      this.#assetsInFlight = indexOf(assets, "inFlight");
      this.#assetBytes = indexOf(assets, "bytesLoaded");
    }
  }
}

/**
 * Resolves a counter name without throwing when a future release drops it.
 *
 * @param group - The group.
 * @param counter - The counter name.
 * @returns The index, or `-1` when the group has no such counter.
 */
function indexOf(group: DiagnosticsGroup, counter: string): number {
  return group.counterNames.indexOf(counter);
}
