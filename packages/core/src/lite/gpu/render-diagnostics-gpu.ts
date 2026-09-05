import {
  getRenderTaskGpuTimings,
  isGpuTimingSupported,
  resizeEngine,
  setGpuTimingEnabled,
  setSurfaceSize,
  waitForGpuIdle,
} from "@babylonjs/lite";
import type { EngineContext, RenderTaskGpuTimings, SurfaceContext } from "@babylonjs/lite";

/**
 * The half of render diagnostics that needs a device (`docs/architecture/07-rendering.md` §1
 * and §5). The pure option mapping and the counters that are plain properties are in
 * `../render-diagnostics.ts`.
 *
 * Everything here is `@internal`.
 *
 * ## Why these need a device (verified against `@babylonjs/lite@1.27.0`)
 *
 * - `isGpuTimingSupported` and `getRenderTaskGpuTimings` both start with
 *   `engine._device.features.has("timestamp-query")` (`lib/engine/engine.js`,
 *   `lib/engine/gpu-task-timing.js`). SwiftShader does not expose that feature, so on the CI
 *   software adapter the snapshot's `status` is `"unsupported"` — which is why coding standards §10
 *   says GPU-timing assertions are skipped there.
 * - `setSurfaceSize` writes `canvas.width`/`canvas.height` (`lib/engine/surface.js`), and a null
 *   engine has no canvas at all.
 * - `resizeEngine` walks the engine's surfaces and re-reads each canvas's client size; for an
 *   `OffscreenCanvas` it is a no-op, because an offscreen canvas has no layout box — that is why
 *   `docs/architecture/07-rendering.md` §1 routes offscreen rendering through
 *   {@link setSurfaceSizePx}.
 */

/**
 * Re-reads every attached canvas's CSS size and resizes its swapchain accordingly.
 *
 * @remarks
 * Lite already does this at the start of every frame of its own render loop
 * (`lib/engine/engine.js`, `startEngine`). Calling it by hand is only needed after changing
 * `maxDevicePixelRatio` outside a frame.
 *
 * @param engine - The engine to resize.
 *
 * @internal
 */
export function resizeToCanvas(engine: EngineContext): void {
  resizeEngine(engine);
}

/**
 * Sets a surface's backing-store size explicitly, in device pixels.
 *
 * @remarks
 * This is the `OffscreenCanvas` path: an offscreen canvas has no layout, so the host thread that
 * owns the visible canvas pushes the size in. Every rendering context on the surface is asked to
 * rebuild its canvas-sized resources.
 *
 * On a **laid-out DOM canvas** the size set here survives exactly one frame: Lite's render loop
 * calls `resizeEngine` at the start of every frame and puts the backing store back to
 * `clientWidth × clientHeight × min(devicePixelRatio, maxDevicePixelRatio)`
 * (`lib/engine/engine.js`, `startEngine`; measured 2026-09-05). Resolution scaling on a DOM canvas
 * therefore goes through `maxDevicePixelRatio`, not through this call — which is exactly what
 * `docs/architecture/07-rendering.md` §1 prescribes.
 *
 * @param surface - The surface to resize. The engine is its own primary surface.
 * @param widthPx - The width, in device pixels.
 * @param heightPx - The height, in device pixels.
 *
 * @internal
 */
export function setSurfaceSizePx(surface: SurfaceContext, widthPx: number, heightPx: number): void {
  setSurfaceSize(surface, widthPx, heightPx);
}

/**
 * Clamps the device pixel ratio a surface's swapchain backing store is sized at.
 *
 * @remarks
 * `SurfaceContext.maxDevicePixelRatio` is documented as "mutable at runtime — set before the next
 * `resizeSurface` to take effect" (`index.d.ts` 12591), which is what makes `renderer.pixelRatio`
 * and `renderer.resolutionScale` live quality knobs rather than creation-time options
 * (`docs/architecture/07-rendering.md` §1). The caller follows it with {@link resizeToCanvas} when
 * it wants the change to land before the next frame.
 *
 * @param surface - The surface to clamp. The engine is its own primary surface.
 * @param maxDevicePixelRatio - The clamp; `Infinity` is unclamped.
 *
 * @internal
 */
export function setSurfaceMaxDevicePixelRatio(surface: SurfaceContext, maxDevicePixelRatio: number): void {
  surface.maxDevicePixelRatio = maxDevicePixelRatio;
}

/**
 * Reads the clamp currently in force on a surface.
 *
 * @param surface - The surface to read.
 * @returns The clamp; `Infinity` when it is unclamped.
 *
 * @internal
 */
export function readSurfaceMaxDevicePixelRatio(surface: SurfaceContext): number {
  return surface.maxDevicePixelRatio;
}

/**
 * Reads a surface's current backing-store size, in device pixels.
 *
 * @remarks
 * `SurfaceContext.canvas` is the `RenderCanvas` the swapchain is configured against
 * (`index.d.ts` 12591), so its `width`/`height` are the render target's pixel dimensions — which is
 * what a camera needs for its aspect ratio and for screen/world conversions. A null engine has no
 * canvas, so the component layer only calls this on a device-backed app.
 *
 * @param surface - The surface to measure. The engine is its own primary surface.
 * @param out - Receives the size.
 * @param out.width - Receives the width, in device pixels.
 * @param out.height - Receives the height, in device pixels.
 * @returns `out`, for chaining.
 *
 * @internal
 */
export function readSurfaceSizePx(
  surface: SurfaceContext,
  out: { width: number; height: number },
): { width: number; height: number } {
  const canvas = surface.canvas;
  out.width = canvas.width;
  out.height = canvas.height;
  return out;
}

/**
 * Reports whether the device can measure GPU time at all.
 *
 * @param engine - The engine to probe.
 * @returns `true` when the device exposes WebGPU timestamp queries.
 *
 * @internal
 */
export function isGpuTimingAvailable(engine: EngineContext): boolean {
  return isGpuTimingSupported(engine);
}

/**
 * Turns whole-frame GPU timing on, so `readGpuFrameTimeMs` starts reporting.
 *
 * @remarks
 * Silently does nothing when the device has no timestamp query support. `disableGpuTiming` in
 * `../render-diagnostics.ts` is the other direction and needs no device.
 *
 * @param engine - The engine to measure.
 *
 * @internal
 */
export function enableGpuTiming(engine: EngineContext): void {
  setGpuTimingEnabled(engine, true);
}

/**
 * Reads the latest per-task GPU timing snapshot.
 *
 * @remarks
 * Check `status` first: `"unsupported"` on a device without timestamp queries, `"disabled"` until
 * per-task timing is switched on, `"pending"` until the first readback lands, `"error"` when the
 * readback failed. `tasks` is in frame execution order and its names are the frame graph's own —
 * `"shadow"`, `"scene"`, and whatever a post-process task was named.
 *
 * @param engine - The engine to read.
 * @returns The snapshot.
 *
 * @internal
 */
export function readRenderTaskGpuTimings(engine: EngineContext): RenderTaskGpuTimings {
  return getRenderTaskGpuTimings(engine);
}

/**
 * Waits until every command buffer submitted so far has finished on the GPU.
 *
 * @remarks
 * Two uses. First, it is the fence a test needs before asserting that a released resource is really
 * gone: Lite defers every teardown to `retireGpuResources`, which only runs after a frame has
 * flushed the retirement batch and the queue has drained
 * (`lib/engine/gpu-resource-retirement.js`). Second, it is the natural point to sample a benchmark
 * at, because it is the only public GPU fence Lite offers.
 *
 * @param engine - The engine to wait on.
 * @returns A promise that resolves when the queue is idle.
 *
 * @internal
 */
export function waitForGpuWork(engine: EngineContext): Promise<void> {
  return waitForGpuIdle(engine);
}
