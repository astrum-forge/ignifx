/**
 * `@ignifx/core` public barrel. Explicit named re-exports only — no `export *`
 * (coding standards §4).
 *
 * @packageDocumentation
 */

export { ErrorCode, IgnifxError } from "./errors.js";
export {
  createHeadlessRuntime,
  disposeHeadlessRuntime,
  stepHeadless,
  type HeadlessRuntime,
  type LiteHeadlessHandles,
} from "./lite/headless.js";
export { createRenderEngine, disposeRenderEngine, type LiteRenderHandles, type RenderRuntime } from "./lite/render.js";
export { isWebGpuAvailable, type RenderSurface } from "./webgpu.js";
