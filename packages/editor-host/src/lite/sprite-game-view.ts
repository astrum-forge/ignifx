/**
 * The Game panel's view of a 2D scene (`gameViewFrame` through a `Camera2D`): the project's sprite
 * layers drawn by a second Lite sprite renderer into an `OffscreenCanvas` surface of the view's
 * size, each world layer through the level camera's view for that one render. Every Lite claim
 * here was read from the pinned `@babylonjs/lite` 1.34 `index.d.ts` and `lib/sprite/sprite-renderer.js`.
 *
 * - **Why a surface, not a render texture.** A sprite renderer sizes its layers' uniforms from its
 *   surface's canvas (`spriteRendererUpdate` reads `getRenderTargetSize(rr._surface)`), so a target
 *   redirected with `setSpriteRendererTarget` must be the main canvas's size. A surface of its own
 *   (`createSurface` on an `OffscreenCanvas`) has the view's size.
 * - **Drawn only on request.** The renderer stays unregistered, so the animation-frame loop never
 *   draws it; a request registers it, renders that one surface (`renderFrame(engine, 0, [surface])`,
 *   which runs no scene and so no ignifx frame), and unregisters it again.
 * - **The views are swapped, not copied.** A layer has one `view`, which the main sprite pass reads
 *   too. The render is synchronous, so writing the camera's views, rendering and writing the old
 *   ones back happens inside one task and the main pass never sees them.
 * - **Read back by the canvas.** `OffscreenCanvas.convertToBlob` copies the canvas's current
 *   WebGPU texture after the work already submitted, which is the WebGPU readback path for a canvas.
 *
 * The host loads this module with `import()` the first time a 2D scene's game view renders, so it
 * stays out of the host's first chunk (`CONSTITUTION.md` §2.5).
 */

import {
  addSpriteRendererLayer,
  createSpriteRenderer,
  createSurface,
  disposeSpriteRenderer,
  disposeSurface,
  registerSpriteRenderer,
  removeSpriteRendererLayer,
  renderFrame,
  setSurfaceSize,
  unregisterSpriteRenderer,
} from "@babylonjs/lite";
import type { EngineContext, Sprite2DLayer, Sprite2DView, SpriteRenderer, SurfaceContext } from "@babylonjs/lite";

/** One layer to draw and the view to draw it through. */
export interface SpriteLayerDraw {
  /** A Lite `Sprite2DLayer`, as `app.twoD.layers` holds it. */
  readonly layer: object;
  /** The layer-pixel x at the image's top-left. */
  readonly x: number;
  /** The layer-pixel y at the image's top-left. */
  readonly y: number;
  /** Screen pixels per layer pixel. */
  readonly zoom: number;
  /** The view rotation, in radians. */
  readonly rotation: number;
}

/** A colour, each channel `0..1`, straight sRGB. */
export interface SpriteClearColor {
  /** Red. */
  readonly r: number;
  /** Green. */
  readonly g: number;
  /** Blue. */
  readonly b: number;
  /** Opacity. */
  readonly a: number;
}

/** The second sprite pass of one scene view. */
export interface SpriteGameView {
  /**
   * Draws the layers through their views into an image of a size.
   *
   * @param draws - The layers, in draw order, and their views.
   * @param width - The image width in pixels.
   * @param height - The image height in pixels.
   * @param type - `"image/png"` or `"image/jpeg"`.
   * @param quality - The JPEG quality, from 0 to 1.
   * @returns The encoded image.
   */
  render(
    draws: readonly SpriteLayerDraw[],
    width: number,
    height: number,
    type: string,
    quality: number,
  ): Promise<Blob>;
  /** Frees the renderer and its surface. Idempotent. */
  dispose(): void;
}

/**
 * Tells whether a value is a Lite sprite layer: an object with a `view` holding a `positionPx`.
 *
 * @param value - The value.
 * @returns True for a layer.
 */
function isSpriteLayer(value: object): value is Sprite2DLayer {
  const view: unknown = Reflect.get(value, "view");
  return typeof view === "object" && view !== null && Array.isArray(Reflect.get(view, "positionPx"));
}

/**
 * Decodes an sRGB channel to linear, for a surface that encodes on write.
 *
 * @param channel - The sRGB value.
 * @returns The linear value.
 */
function srgbToLinear(channel: number): number {
  return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Builds the 2D game view's sprite pass on an engine. Its surface is created on the first render.
 *
 * @param engine - The app's Lite engine (`app.lite.engine`).
 * @param clear - The colour the image is cleared to, as the project's `rendering.clearColor`.
 * @returns The pass.
 */
export function createSpriteGameView(engine: EngineContext, clear: SpriteClearColor): SpriteGameView {
  let canvas: OffscreenCanvas | null = null;
  let surface: SurfaceContext | null = null;
  let renderer: SpriteRenderer | null = null;
  const saved: Sprite2DView[] = [];

  const ensure = (
    width: number,
    height: number,
  ): { canvas: OffscreenCanvas; surface: SurfaceContext; renderer: SpriteRenderer } => {
    if (canvas === null || surface === null || renderer === null) {
      canvas = new OffscreenCanvas(width, height);
      const srgb = engine.format.endsWith("-srgb");
      surface = createSurface(engine, canvas, { msaaSamples: 1, srgb });
      const decode = (channel: number): number => (srgb ? srgbToLinear(channel) : channel);
      renderer = createSpriteRenderer(surface, {
        layers: [],
        clear: true,
        clearValue: { r: decode(clear.r), g: decode(clear.g), b: decode(clear.b), a: clear.a },
      });
    }
    setSurfaceSize(surface, width, height);
    return { canvas, surface, renderer };
  };

  return {
    async render(draws, width, height, type, quality): Promise<Blob> {
      const pass = ensure(width, height);
      const wanted = new Set<object>();
      for (const draw of draws) {
        if (isSpriteLayer(draw.layer)) {
          wanted.add(draw.layer);
          addSpriteRendererLayer(pass.renderer, draw.layer);
        }
      }
      // Collected first: removing a layer changes the list being walked.
      const stale = pass.renderer.layers.filter((layer) => !wanted.has(layer));
      for (const layer of stale) {
        removeSpriteRendererLayer(pass.renderer, layer);
      }
      const layers: Sprite2DLayer[] = [];
      saved.length = 0;
      for (const draw of draws) {
        if (isSpriteLayer(draw.layer)) {
          const view = draw.layer.view;
          layers.push(draw.layer);
          saved.push({
            positionPx: [view.positionPx[0], view.positionPx[1]],
            zoom: view.zoom,
            rotation: view.rotation,
          });
          view.positionPx[0] = draw.x;
          view.positionPx[1] = draw.y;
          view.zoom = draw.zoom === 0 ? 1 : draw.zoom;
          view.rotation = draw.rotation;
        }
      }
      registerSpriteRenderer(pass.renderer);
      try {
        renderFrame(engine, 0, [pass.surface]);
      } finally {
        unregisterSpriteRenderer(pass.renderer);
        for (const [index, layer] of layers.entries()) {
          const old = saved[index];
          if (old !== undefined) {
            layer.view.positionPx[0] = old.positionPx[0];
            layer.view.positionPx[1] = old.positionPx[1];
            layer.view.zoom = old.zoom;
            layer.view.rotation = old.rotation;
          }
        }
      }
      // The copy is taken now, after the submit above, before any later frame.
      return pass.canvas.convertToBlob(type === "image/png" ? { type } : { type, quality });
    },
    dispose(): void {
      if (renderer !== null) {
        disposeSpriteRenderer(renderer);
      }
      if (surface !== null) {
        disposeSurface(surface);
      }
      renderer = null;
      surface = null;
      canvas = null;
    },
  };
}
