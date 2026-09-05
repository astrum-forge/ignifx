/**
 * A canvas ignifx can render into: a DOM canvas on the main thread, or an `OffscreenCanvas`
 * transferred to a worker. Declared here so public signatures do not depend on a Babylon Lite type.
 *
 * @public
 */
export type RenderSurface = HTMLCanvasElement | OffscreenCanvas;

/**
 * Reports whether the current environment exposes a WebGPU entry point. This is a capability probe
 * only: it does not request an adapter, so it never blocks and never allocates GPU resources.
 * ignifx is WebGPU-only (`CONSTITUTION.md` §1.1), so this is the gate every renderer path runs first.
 *
 * @returns `true` when `navigator.gpu` is present.
 *
 * @example
 * ```ts
 * if (!isWebGpuAvailable()) {
 *   showWebGpuUnsupportedPage();
 * }
 * ```
 *
 * @public
 */
export function isWebGpuAvailable(): boolean {
  // `@webgpu/types` declares `navigator.gpu` as always present, so a `!== undefined` check would be
  // statically dead. Probing with `in` reflects what Node and pre-WebGPU browsers actually expose
  // and needs no type assertion (coding standards §5.2).
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
