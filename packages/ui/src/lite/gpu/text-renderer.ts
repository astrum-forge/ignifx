import {
  addTextRendererLayer,
  createTextRenderer,
  disposeTextRenderer,
  enableDeviceLostTextRecovery,
  registerTextRenderer,
  removeTextRendererLayer,
  unregisterTextRenderer,
} from "@babylonjs/lite";
import type { DeviceLostRecoveryHandle, EngineContext, SurfaceContext, TextLayer, TextRenderer } from "@babylonjs/lite";

/**
 * The device-only half of the text adapter: the second Babylon Lite rendering context `@ignifx/ui`
 * puts on the app's surface for `HudText` and `WorldText2D`
 * (`docs/architecture/07-rendering.md` §1, `13-ui.md` §2).
 *
 * A `TextRenderer` opens its own swapchain pass and is registered directly on the engine,
 * independently of any scene — the same shape as `@ignifx/2d`'s sprite renderer. Two of Lite's own
 * statements govern how it is used:
 *
 * - `TextRendererOptions.clear` is *"Default true. Set false for HUD overlays so the text pass
 *   preserves existing scene color"* (`index.d.ts` 12867). A HUD always passes `false`.
 * - `registerTextRenderer` *"Register a text renderer with its surface so the engine updates and
 *   records it each frame"* (9547); `lib/text/text-renderer.js` implements it as
 *   `registerRenderingContext(tr._surface, tr)`, which appends to the surface's context list, and
 *   Lite draws that list in order — so a context registered after the render scene composites on
 *   top of it.
 *
 * The renderer's pixel space is the **backing store**: `createTextRenderer` seeds
 * `_targetWidth`/`_targetHeight` from `surface.canvas.width`/`.height` and `textRendererUpdate`
 * re-reads them every frame (`lib/text/text-renderer.js`). A layer at `positionPx (100, 100)` is
 * therefore at render-target column 100, which is the same space `Camera.worldToScreen` and
 * `app.renderer.captureScreenshot()` answer in — and *not* CSS pixels.
 *
 * Everything here needs `engine._device` on the first frame, so the module lives under `gpu/` and
 * the root Vitest coverage config excludes it; the `browser` project covers it.
 *
 * Everything here is `@internal`.
 */

/**
 * The surface a text renderer draws into.
 *
 * @remarks
 * `EngineContext extends SurfaceContext` (`index.d.ts` 4676) and an engine's index-0 surface *is*
 * the engine itself, so a single-canvas app passes `app.lite.engine` straight through.
 *
 * @internal
 */
export type TextSurface = SurfaceContext;

/**
 * Creates the text renderer and registers it on the engine.
 *
 * @remarks
 * Call this **after** the render scene is registered, so text composites over the frame rather than
 * under it. `clear` is always `false`: a HUD that cleared the swapchain would erase the game.
 *
 * @param surface - The surface to draw into; the engine, for a single-canvas app.
 * @returns The registered renderer.
 *
 * @internal
 */
export function createRegisteredTextRenderer(surface: TextSurface): TextRenderer {
  const renderer = createTextRenderer(surface, { layers: [], clear: false });
  registerTextRenderer(renderer);
  return renderer;
}

/**
 * Adds a layer to a renderer's draw list (`index.d.ts` 214).
 *
 * @param renderer - The text renderer.
 * @param layer - The layer to draw.
 *
 * @internal
 */
export function attachTextLayer(renderer: TextRenderer, layer: TextLayer): void {
  addTextRendererLayer(renderer, layer);
}

/**
 * Removes a layer from a renderer's draw list and frees its per-layer GPU buffers
 * (`index.d.ts` 9671).
 *
 * @param renderer - The text renderer.
 * @param layer - The layer to stop drawing.
 * @returns `true` when the layer was there.
 *
 * @internal
 */
export function detachTextLayer(renderer: TextRenderer, layer: TextLayer): boolean {
  return removeTextRendererLayer(renderer, layer);
}

/**
 * Unregisters and disposes a text renderer (`index.d.ts` 13218 and 4103).
 *
 * @param renderer - The renderer to tear down.
 *
 * @internal
 */
export function destroyTextRenderer(renderer: TextRenderer): void {
  unregisterTextRenderer(renderer);
  disposeTextRenderer(renderer);
}

/**
 * Turns on best-effort WebGPU device-lost recovery for every registered text renderer
 * (`index.d.ts` 4388).
 *
 * @remarks
 * Unlike the sprite adapter, this one has no ordering requirement. Lite's own comment at
 * `index.d.ts` 4383-4384 says that `GlyphStorage` already retains the CPU atlas data needed for
 * reconstruction, so the adapter adds no renderer-specific capture outside the loss path. It is
 * still enabled in `onStart`, before the first layer exists, so the two adapters read the same.
 *
 * @param engine - The engine to protect.
 * @param onRecovered - Called after the replacement device and every rendering context are ready.
 * @param onFailed - Called when reacquisition or rebuilding fails.
 * @returns The handle whose `disable()` turns recovery off again.
 *
 * @internal
 */
export function enableTextDeviceLostRecovery(
  engine: EngineContext,
  onRecovered: () => void,
  onFailed: (error: unknown) => void,
): DeviceLostRecoveryHandle {
  return enableDeviceLostTextRecovery(engine, { onRecovered, onRecoveryFailed: onFailed });
}
