import { setGpuTimingEnabled } from "@babylonjs/lite";
import type { EngineContext, EngineOptions } from "@babylonjs/lite";

/**
 * Render diagnostics and engine option mapping (`docs/architecture/07-rendering.md` §1 and §5) —
 * the half that needs no GPU device. `setSurfaceSize`, GPU timing readback, and the resize that
 * re-reads the canvas live in `./gpu/render-diagnostics-gpu.ts`.
 *
 * Everything here is `@internal`.
 *
 * ## Two corrections to `docs/architecture/07-rendering.md` §1
 *
 * 1. It lists `powerPreference` among "engine options exposed by `createApp`". Babylon Lite 1.27.0
 *    has no such option: `EngineOptions` (`index.d.ts` 4709) and `SurfaceOptions`
 *    (`index.d.ts` 12622) do not declare it, and `lib/engine/engine.js` line 47 hard-codes
 *    `requestAdapter({ powerPreference: "high-performance" })`. The only way in is a private
 *    `_adapterOptionsHook`, so ignifx does not expose the option.
 * 2. `SurfaceOptions` also carries `format`, which the document does not mention. It overrides the
 *    swapchain format and must not be an `*-srgb` one — `srgb: true` is how you ask for sRGB
 *    encoding.
 */

/**
 * Installs Babylon Lite's own error-message decoder, so a Lite failure reports prose instead of a
 * numeric code (`docs/architecture/07-rendering.md` §5).
 *
 * @remarks
 * Development only, and **dynamically imported** so that it is development-only in bytes as well as
 * in behaviour: the decoder is a 43 KB lookup table, `createApp`'s `mode` defaults to
 * `"development"`, and a static import therefore put the table in the entry chunk of every
 * production build too (measured on `examples/hello-cube`). `./error-decoding.ts` exists to be that
 * chunk. The call is process-global and idempotent, and it needs no device.
 *
 * It is awaited rather than fired and forgotten, so that a Lite error raised at any point after
 * `createApp` resolves reports prose — a decoder installed a round trip later would leave the first
 * failures reading `#107`.
 *
 * @returns A promise that settles once the decoder is installed.
 *
 * @internal
 */
export async function enableLiteErrorDecoding(): Promise<void> {
  const module = await import("./error-decoding.js");
  module.installLiteErrorDecoder();
}

/**
 * The renderer options `createApp` accepts, in ignifx spelling
 * (`docs/architecture/07-rendering.md` §1).
 *
 * @internal
 */
export interface RendererOptions {
  /** MSAA sample count for the main pass. WebGPU allows only 1 or 4; Lite defaults to 4. */
  readonly msaaSamples?: 1 | 4;
  /** The canvas alpha mode. `"premultiplied"` lets HTML content show through a translucent clear colour. */
  readonly alphaMode?: GPUCanvasAlphaMode;
  /** Render through an sRGB swapchain view so alpha blending is gamma-correct. */
  readonly srgb?: boolean;
  /** Clamps the device pixel ratio the swapchain is sized at. `Infinity` means native. */
  readonly pixelRatio?: number;
  /** A 0.25–1 multiplier on the resolution, implemented by lowering the effective pixel ratio. */
  readonly resolutionScale?: number;
  /** Float64 intermediate precision for world matrices, for large worlds. */
  readonly useHighPrecisionMatrix?: boolean;
  /** Eye-relative upload for large-world coordinates. Requires `useHighPrecisionMatrix`. */
  readonly useFloatingOrigin?: boolean;
  /** Extra WebGPU device limits to request, such as a larger `maxColorAttachmentBytesPerSample`. */
  readonly requiredLimits?: Record<string, GPUSize64 | undefined>;
}

/** The smallest resolution scale `docs/architecture/07-rendering.md` §1 allows. */
const MIN_RESOLUTION_SCALE = 0.25;

/** The largest resolution scale, i.e. no downscaling. */
const MAX_RESOLUTION_SCALE = 1;

/**
 * Translates ignifx renderer options into the `EngineOptions & SurfaceOptions` union `createEngine`
 * takes.
 *
 * @remarks
 * `pixelRatio` and `resolutionScale` collapse into Lite's single `maxDevicePixelRatio`: the scale
 * multiplies the clamp, and a clamp of `Infinity` is first resolved against the host's own device
 * pixel ratio so that scaling `Infinity` still means something. The scale is clamped to
 * 0.25 – 1 rather than rejected, because it is a live quality knob, not API misuse.
 *
 * @param options - The declared renderer options.
 * @param devicePixelRatio - The host's device pixel ratio, used only when `pixelRatio` is omitted
 * or infinite and a `resolutionScale` is present.
 * @returns Options for `createEngine`. Fields the caller left out are omitted so Lite's own
 * defaults apply.
 *
 * @example
 * ```ts
 * const engine = await createEngine(canvas, toLiteEngineOptions({ msaaSamples: 1, resolutionScale: 0.5 }, 2));
 * ```
 *
 * @internal
 */
export function toLiteEngineOptions(options: RendererOptions, devicePixelRatio: number): EngineOptions {
  const result: {
    msaaSamples?: 1 | 4;
    alphaMode?: GPUCanvasAlphaMode;
    srgb?: boolean;
    maxDevicePixelRatio?: number;
    useHighPrecisionMatrix?: boolean;
    useFloatingOrigin?: boolean;
    requiredLimits?: Record<string, GPUSize64 | undefined>;
  } = {};
  if (options.msaaSamples !== undefined) {
    result.msaaSamples = options.msaaSamples;
  }
  if (options.alphaMode !== undefined) {
    result.alphaMode = options.alphaMode;
  }
  if (options.srgb !== undefined) {
    result.srgb = options.srgb;
  }
  if (options.useHighPrecisionMatrix !== undefined) {
    result.useHighPrecisionMatrix = options.useHighPrecisionMatrix;
  }
  if (options.useFloatingOrigin !== undefined) {
    result.useFloatingOrigin = options.useFloatingOrigin;
  }
  if (options.requiredLimits !== undefined) {
    result.requiredLimits = options.requiredLimits;
  }
  const maxDevicePixelRatio = resolveMaxDevicePixelRatio(options, devicePixelRatio);
  if (maxDevicePixelRatio !== null) {
    result.maxDevicePixelRatio = maxDevicePixelRatio;
  }
  return result;
}

/**
 * Folds `pixelRatio` and `resolutionScale` into the one clamp Lite understands.
 *
 * @param options - The declared renderer options.
 * @param devicePixelRatio - The host's device pixel ratio.
 * @returns The clamp to pass to Lite, or `null` when the caller asked for neither.
 *
 * @internal
 */
export function resolveMaxDevicePixelRatio(options: RendererOptions, devicePixelRatio: number): number | null {
  const { pixelRatio, resolutionScale } = options;
  if (resolutionScale === undefined) {
    return pixelRatio ?? null;
  }
  const scale = Math.min(Math.max(resolutionScale, MIN_RESOLUTION_SCALE), MAX_RESOLUTION_SCALE);
  const base = pixelRatio === undefined || !Number.isFinite(pixelRatio) ? devicePixelRatio : pixelRatio;
  return base * scale;
}

/**
 * The number of GPU draw calls the engine issued in its last rendered frame, summed across every
 * surface.
 *
 * @param engine - The engine to read. A null engine always reports `0`.
 * @returns The draw call count.
 *
 * @internal
 */
export function readDrawCallCount(engine: EngineContext): number {
  return engine.drawCallCount;
}

/**
 * The GPU time the last measured frame took, in milliseconds.
 *
 * @remarks
 * `0` until GPU timing is enabled and a measured frame has completed, and the value trails the
 * current frame by one or two because the timestamp readback is asynchronous and off the render
 * critical path (`index.d.ts` 4676). Reading it therefore does not perturb it.
 *
 * @param engine - The engine to read.
 * @returns The frame time, in milliseconds.
 *
 * @internal
 */
export function readGpuFrameTimeMs(engine: EngineContext): number {
  return engine.gpuFrameTimeMs;
}

/**
 * Turns whole-frame GPU timing off and resets the reported frame time to zero.
 *
 * @remarks
 * Only the "off" direction is here: turning timing **on** probes
 * `engine._device.features.has("timestamp-query")` and so needs a real device
 * (`lib/engine/engine.js`). That half lives in `./gpu/render-diagnostics-gpu.ts`.
 *
 * @param engine - The engine to stop measuring.
 *
 * @internal
 */
export function disableGpuTiming(engine: EngineContext): void {
  setGpuTimingEnabled(engine, false);
}
