import { createEngine, disposeEngine } from "@babylonjs/lite";
import type { LiteEngine } from "./scene.js";
import type { RenderSurface } from "../platform/webgpu.js";

/**
 * The GPU half of the Babylon Lite adapter: the two calls that need a real WebGPU device. They are
 * unreachable from Node, so this file is the one the root Vitest coverage config excludes
 * (`vitest.config.ts`); everything the null engine can exercise lives in `./engine.ts`,
 * `./scene.ts`, `./loop.ts`, and `./node.ts`.
 *
 * Coverage comes from the Vitest `browser` project (`*.browser.test.ts`) instead.
 */

/**
 * Creates a Babylon Lite WebGPU engine bound to a canvas.
 *
 * @remarks
 * The WebGPU capability gate runs in `./engine.ts` *before* this is called, so an unsupported
 * browser produces `IGX-0701` rather than an opaque Lite failure (`CONSTITUTION.md` §1.1).
 *
 * @param canvas - The canvas or offscreen canvas to render into.
 * @returns The engine. Lite's engine is also its primary surface.
 *
 * @internal
 */
export async function createWebGpuEngine(canvas: RenderSurface): Promise<LiteEngine> {
  return createEngine(canvas);
}

/**
 * Releases a WebGPU engine and the device behind it.
 *
 * @remarks
 * Only ever called for a WebGPU engine: `disposeEngine` unconditionally reaches for
 * `surface._context` and `engine._device`, neither of which a null engine has, so calling it on one
 * throws (ADR-0009 Validation). The headless path disposes its scene and stops there.
 *
 * @param engine - The engine to release.
 *
 * @internal
 */
export function disposeWebGpuEngine(engine: LiteEngine): void {
  disposeEngine(engine);
}
