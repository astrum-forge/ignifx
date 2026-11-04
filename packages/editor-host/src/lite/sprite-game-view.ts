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
 * - **Built per request.** Each request creates the surface and the renderer, renders that one
 *   surface (`renderFrame(engine, 0, [surface])`, which runs no scene and so no ignifx frame), reads
 *   it back, and disposes both. A live surface stays in `engine.surfaces`, where every main frame
 *   would acquire its texture, and a live renderer keeps its layers' GPU buffers; neither outlives
 *   the request. Pipelines are not rebuilt: Lite's sprite pipeline cache is shared by every renderer
 *   on the device (`acquireSharedSpriteRendererPipelineCache`, `lib/sprite/sprite-renderer.js`).
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
  createSpriteRenderer,
  createSurface,
  disposeSpriteRenderer,
  disposeSurface,
  registerSpriteRenderer,
  renderFrame,
} from "@babylonjs/lite";
import type { EngineContext, Sprite2DLayer, Sprite2DView } from "@babylonjs/lite";

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
 * Draws sprite layers through their views into an image of a size, on a surface and a renderer
 * that exist only for this call.
 *
 * @param engine - The app's Lite engine (`app.lite.engine`).
 * @param draws - The layers, in draw order, and their views.
 * @param size - The image size and the colour it is cleared to.
 * @param size.width - The image width in pixels.
 * @param size.height - The image height in pixels.
 * @param size.clear - The clear colour, as the project's `rendering.clearColor` reads now.
 * @param type - `"image/png"` or `"image/jpeg"`.
 * @param quality - The JPEG quality, from 0 to 1.
 * @returns The encoded image.
 */
export async function renderSpriteGameView(
  engine: EngineContext,
  draws: readonly SpriteLayerDraw[],
  size: { readonly width: number; readonly height: number; readonly clear: SpriteClearColor },
  type: string,
  quality: number,
): Promise<Blob> {
  const { width, height, clear } = size;
  const layers: Sprite2DLayer[] = [];
  const views: SpriteLayerDraw[] = [];
  for (const draw of draws) {
    if (isSpriteLayer(draw.layer)) {
      layers.push(draw.layer);
      views.push(draw);
    }
  }
  const canvas = new OffscreenCanvas(width, height);
  const srgb = engine.format.endsWith("-srgb");
  const surface = createSurface(engine, canvas, { msaaSamples: 1, srgb });
  const decode = (channel: number): number => (srgb ? srgbToLinear(channel) : channel);
  try {
    const renderer = createSpriteRenderer(surface, {
      layers,
      clear: true,
      clearValue: { r: decode(clear.r), g: decode(clear.g), b: decode(clear.b), a: clear.a },
    });
    try {
      const saved: Sprite2DView[] = [];
      for (const [index, layer] of layers.entries()) {
        const draw = views[index];
        const view = layer.view;
        saved.push({ positionPx: [view.positionPx[0], view.positionPx[1]], zoom: view.zoom, rotation: view.rotation });
        if (draw !== undefined) {
          view.positionPx[0] = draw.x;
          view.positionPx[1] = draw.y;
          view.zoom = draw.zoom === 0 ? 1 : draw.zoom;
          view.rotation = draw.rotation;
        }
      }
      registerSpriteRenderer(renderer);
      try {
        renderFrame(engine, 0, [surface]);
      } finally {
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
      // Awaited before the surface goes: the copy reads the work submitted above.
      return await canvas.convertToBlob(type === "image/png" ? { type } : { type, quality });
    } finally {
      // Also unregisters it from the surface.
      disposeSpriteRenderer(renderer);
    }
  } finally {
    disposeSurface(surface);
  }
}
