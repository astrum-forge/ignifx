import {
  addSpriteRendererLayer,
  createSpriteRenderer,
  disposeSpriteRenderer,
  enableDeviceLostSpriteRecovery,
  registerSpriteRenderer,
  removeSpriteRendererLayer,
  unregisterSpriteRenderer,
} from "@babylonjs/lite";
import type {
  DeviceLostRecoveryHandle,
  EngineContext,
  Sprite2DLayer,
  SpriteRenderer,
  SurfaceContext,
} from "@babylonjs/lite";

/**
 * The device-only half of the sprite adapter: the second rendering context `@ignifx/2d` puts on the
 * app's surface (`docs/architecture/07-rendering.md` §1, `11-2d-toolkit.md` §1).
 *
 * A `SpriteRenderer` opens its own single-sample swapchain pass and is registered directly on the
 * engine, independent of any scene. Lite's own contract (`index.d.ts` 12193-12216) is explicit
 * about ordering: *"Register the renderer **after** `registerScene` so it draws on top"* — and
 * about compositing: `SpriteRendererOptions.clear` *"Default true. Set false for HUD overlays so
 * the sprite pass preserves existing scene color"* (12222).
 *
 * Everything here needs `engine._device`, so the module lives under `gpu/` and the root Vitest
 * coverage config excludes it; the `browser` project covers it.
 *
 * Everything here is `@internal`.
 */

/**
 * The surface a sprite renderer draws into.
 *
 * @remarks
 * `EngineContext extends SurfaceContext` (`index.d.ts` 4676) and an engine's index-0 surface *is*
 * the engine itself, so a single-canvas app passes `app.lite.engine` straight through. This alias
 * exists so callers outside `src/lite/**` never have to name a Lite type.
 *
 * @internal
 */
export type SpriteSurface = SurfaceContext;

/**
 * A straight RGBA clear value, each channel in `0` to `1`.
 *
 * @internal
 */
export interface ClearColor {
  /** The red channel. */
  readonly r: number;
  /** The green channel. */
  readonly g: number;
  /** The blue channel. */
  readonly b: number;
  /** The alpha channel. */
  readonly a: number;
}

/**
 * Creates the sprite renderer and pushes it onto the engine's rendering-context list.
 *
 * @remarks
 * Call this **after** the render scene is registered. `registerSpriteRenderer` appends to
 * `engine._renderingContexts` and Lite draws that list in order, so a context pushed later
 * composites later. It is idempotent (`index.d.ts` 9544).
 *
 * @param surface - The surface to draw into; the engine, for a single-canvas app.
 * @param clear - Whether the sprite pass clears first. `false` in `"mixed"` mode, so the 3D scene's
 * colour survives underneath.
 * @param clearColor - The clear value used when `clear` is `true`, as straight RGBA in `0` to `1`.
 * @param clearColor.r - The red channel.
 * @param clearColor.g - The green channel.
 * @param clearColor.b - The blue channel.
 * @param clearColor.a - The alpha channel.
 * @returns The registered renderer.
 *
 * @internal
 */
export function createRegisteredSpriteRenderer(
  surface: SpriteSurface,
  clear: boolean,
  clearColor: ClearColor,
): SpriteRenderer {
  const renderer = createSpriteRenderer(surface, {
    layers: [],
    clear,
    clearValue: { r: clearColor.r, g: clearColor.g, b: clearColor.b, a: clearColor.a },
  });
  registerSpriteRenderer(renderer);
  return renderer;
}

/**
 * Adds a layer to a renderer's draw list (`index.d.ts` 190).
 *
 * @param renderer - The sprite renderer.
 * @param layer - The layer to draw.
 *
 * @internal
 */
export function attachLayer(renderer: SpriteRenderer, layer: Sprite2DLayer): void {
  addSpriteRendererLayer(renderer, layer);
}

/**
 * Removes a layer from a renderer's draw list (`index.d.ts` 9666).
 *
 * @param renderer - The sprite renderer.
 * @param layer - The layer to stop drawing.
 * @returns `true` when the layer was there.
 *
 * @internal
 */
export function detachLayer(renderer: SpriteRenderer, layer: Sprite2DLayer): boolean {
  return removeSpriteRendererLayer(renderer, layer);
}

/**
 * Unregisters and disposes a sprite renderer (`index.d.ts` 13215 and 4078).
 *
 * @param renderer - The renderer to tear down.
 *
 * @internal
 */
export function destroySpriteRenderer(renderer: SpriteRenderer): void {
  unregisterSpriteRenderer(renderer);
  disposeSpriteRenderer(renderer);
}

/**
 * Turns on best-effort WebGPU device-lost recovery for every registered sprite renderer
 * (`index.d.ts` 4378).
 *
 * @remarks
 * Lite's own documentation is emphatic that ordering matters: *"Enable this before creating or
 * loading sprite textures so their recovery sources are retained"* (`index.d.ts` 4372-4373). The
 * extension therefore calls this in `onStart`, before any atlas or layer exists.
 *
 * @param engine - The engine to protect.
 * @param onRecovered - Called after the replacement device and every rendering context are ready.
 * @param onFailed - Called when reacquisition or rebuilding fails.
 * @returns The handle whose `disable()` turns recovery off again.
 *
 * @internal
 */
export function enableSpriteDeviceLostRecovery(
  engine: EngineContext,
  onRecovered: () => void,
  onFailed: (error: unknown) => void,
): DeviceLostRecoveryHandle {
  return enableDeviceLostSpriteRecovery(engine, { onRecovered, onRecoveryFailed: onFailed });
}
