/**
 * `ignifx` public barrel: the umbrella entry point that re-exports `@ignifx/core` and, as each
 * phase lands, the standard extensions (`docs/architecture/00-overview.md` §2). Every symbol is
 * re-exported by name — no `export *` (coding standards §4).
 *
 * Only the core surface exists today. The input, physics, physics-2d, audio, 2d, 3d, and ui
 * re-exports and the one-call `createGame()` arrive with the phases of
 * `docs/plan/engineering-plan.md` that populate those packages.
 *
 * @packageDocumentation
 */

export {
  createHeadlessRuntime,
  createRenderEngine,
  disposeHeadlessRuntime,
  disposeRenderEngine,
  ErrorCode,
  IgnifxError,
  isWebGpuAvailable,
  stepHeadless,
  type HeadlessRuntime,
  type LiteHeadlessHandles,
  type LiteRenderHandles,
  type RenderRuntime,
  type RenderSurface,
} from "@ignifx/core";
