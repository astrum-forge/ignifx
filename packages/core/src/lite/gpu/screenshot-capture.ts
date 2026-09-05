import { captureScreenshot } from "@babylonjs/lite";
import type { CapturedFrame } from "../screenshot.js";
import type { SurfaceContext } from "@babylonjs/lite";

/**
 * Frame capture (`docs/architecture/07-rendering.md` §5). The readers over the result are pure and
 * live in `../screenshot.ts`; taking the capture needs a running render loop, so it is here.
 *
 * Everything here is `@internal`.
 *
 * ## Timing (verified against `@babylonjs/lite@1.27.0` `lib/engine/screenshot.js`)
 *
 * `captureScreenshot(surface)` does **not** read the swapchain when it is called. It pushes a
 * pending request onto the surface and lazily loads the readback service; the request is served at
 * the end of the next rendered frame, from `renderFrame`'s command encoder
 * (`lib/engine/engine.js`). Two consequences for tests:
 *
 * 1. The promise never settles unless the engine's `requestAnimationFrame` loop is running. Under
 *    the null engine, or after `stopEngine`, awaiting it hangs.
 * 2. Because the first call also has to import the readback module, the frame it lands on is not
 *    necessarily the very next one. A capture therefore reflects "a frame at or after this call",
 *    which is what a visual assertion wants anyway.
 */

/**
 * Captures the surface's next presented frame.
 *
 * @param surface - The surface to capture. The engine is its own primary surface.
 * @returns The frame, as tightly packed RGBA8 with the top row first. Read it with `samplePixel`
 * from `../screenshot.ts`.
 *
 * @example
 * ```ts
 * const frame = await captureFrame(engine);
 * samplePixel(frame, frame.width >> 1, frame.height >> 1, pixel);
 * ```
 *
 * @internal
 */
export function captureFrame(surface: SurfaceContext): Promise<CapturedFrame> {
  return captureScreenshot(surface);
}
