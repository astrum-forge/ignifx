import {
  addSprite2D,
  clearSprite2DLayer,
  createSprite2DCustomShader,
  createSprite2DLayer,
  disableSprite2DYSort,
  enableSprite2DYSort,
  getSprite2DHandleIndex,
  getSprite2DVisibleBoundsToRef,
  isSprite2DHandleAlive,
  pickSprite2D,
  removeSprite2D,
  setSprite2DShaderParams,
  sprite2DScreenToWorldToRef,
  setSprite2DYSortHandleBias,
  spriteBlendAdditive,
  spriteBlendAlpha,
  spriteBlendMultiply,
  spriteBlendOpaque,
  spriteBlendPremultiplied,
  updateSprite2D,
} from "@babylonjs/lite";
import type {
  Bounds2D,
  Sprite2DCustomShader,
  Sprite2DHandle,
  Sprite2DLayer,
  Sprite2DProps,
  Sprite2DView,
  SpriteAtlas,
  SpriteBlendMode,
  SpritePickInfo,
} from "@babylonjs/lite";

/**
 * The CPU half of the Babylon Lite sprite adapter (`docs/architecture/07-rendering.md` §7,
 * `11-2d-toolkit.md` §1). Nothing in this module touches `engine._device`: a `Sprite2DLayer` is a
 * plain object holding a `Float32Array` of instance data, and every sprite mutation writes into
 * that array (verified in `@babylonjs/lite@1.27.0`, `lib/sprite/sprite-2d.js` lines 14-48 for
 * `createSprite2DLayer` and 73-200 for `writeInstance`/`addSprite2DIndex`). GPU buffers are
 * allocated lazily by the renderer at draw time, which is why the device-only calls live in
 * `./gpu/sprite-renderer.ts` instead.
 *
 * That split is what makes the sprite maths unit-testable under Node: a test fabricates a
 * `SpriteAtlas` with {@link createDataAtlas} and exercises everything here on the null engine.
 *
 * Everything except the blend-mode table is `@internal`.
 */

/**
 * The blend modes `SpriteRenderer.blend` accepts, in the order an inspector should list them.
 *
 * @public
 */
export const SPRITE_BLEND_MODES = ["alpha", "premultiplied", "additive", "multiply", "opaque"] as const;

/**
 * How a sprite's colour combines with what is already in the framebuffer
 * (`docs/architecture/11-2d-toolkit.md` §2.2).
 *
 * @public
 */
export type SpriteBlendName = (typeof SPRITE_BLEND_MODES)[number];

/**
 * Resolves a blend name to the Lite descriptor `createSprite2DLayer` wants.
 *
 * @remarks
 * The descriptors are the module constants `spriteBlendAlpha` (`index.d.ts` 12108),
 * `spriteBlendPremultiplied` (12153), `spriteBlendAdditive` (12102), `spriteBlendMultiply` (12131)
 * and `spriteBlendOpaque` (12147). `SpriteBlendMode` is a type alias of the opaque
 * `SpriteBlendDescriptor` (12122), so the values are compared by identity, never inspected.
 *
 * @param name - The ignifx blend name.
 * @returns The Lite descriptor.
 *
 * @internal
 */
export function blendModeFor(name: SpriteBlendName): SpriteBlendMode {
  switch (name) {
    case "alpha": {
      return spriteBlendAlpha;
    }
    case "premultiplied": {
      return spriteBlendPremultiplied;
    }
    case "additive": {
      return spriteBlendAdditive;
    }
    case "multiply": {
      return spriteBlendMultiply;
    }
    case "opaque": {
      return spriteBlendOpaque;
    }
    default: {
      return spriteBlendAlpha;
    }
  }
}

/**
 * What {@link createLayer} accepts.
 *
 * @internal
 */
export interface LayerOptions {
  /** The blend mode the whole layer draws with. */
  readonly blend: SpriteBlendName;
  /** The draw order; lower draws first. Derived from the sorting-layer index. */
  readonly order: number;
  /** How many sprites to pre-allocate for. */
  readonly capacity: number;
  /** A per-layer custom fragment shader, or `null`. */
  readonly customShader: Sprite2DCustomShader | null;
}

/**
 * Creates one Lite sprite layer.
 *
 * @remarks
 * The layer's pivot is pinned to the centre `[0.5, 0.5]`. Lite's sprite pipeline reads **one pivot
 * per layer** out of its uniform block (`lib/sprite/sprite-pipeline.js` lines 25 and 264-265) and
 * ignores `SpriteFrame.pivot` entirely — only the billboard family consumes that
 * (`lib/sprite/billboard-sprite.js` lines 166-167). ignifx therefore keeps the layer centred and
 * offsets each sprite's `positionPx` instead, which is what makes a per-frame pivot and
 * `SpriteRenderer.pivotOverride` possible at all.
 *
 * `depth` stays `"none"`: these layers are drawn by a `SpriteRenderer`, not hosted in the render
 * scene's depth buffer (`index.d.ts` 11877).
 *
 * @param atlas - The atlas every sprite in the layer draws from.
 * @param options - Blend, order, capacity, and an optional custom shader.
 * @returns The layer.
 *
 * @internal
 */
export function createLayer(atlas: SpriteAtlas, options: LayerOptions): Sprite2DLayer {
  return createSprite2DLayer(atlas, {
    blendMode: blendModeFor(options.blend),
    order: options.order,
    capacity: Math.max(1, options.capacity),
    depth: "none",
    pivot: [0.5, 0.5],
    ...(options.customShader === null ? {} : { customShader: options.customShader }),
  });
}

/**
 * A reusable `Sprite2DProps` record, so a per-frame sync allocates nothing.
 *
 * @remarks
 * `positionPx`, `sizePx`, and `color` are mutable tuples Lite reads and never retains
 * (`writeInstance` copies each component out — `lib/sprite/sprite-2d.js` lines 79-167), so one
 * scratch object can be rewritten and re-submitted every frame (coding standards §7).
 *
 * @internal
 */
export interface SpriteScratch {
  /** The props object handed to `addSprite2D`/`updateSprite2D`. */
  readonly props: Sprite2DProps;
}

/**
 * Builds the reusable props record a sync loop writes through.
 *
 * @returns A fresh scratch record; each sync system owns exactly one.
 *
 * @internal
 */
export function createSpriteScratch(): SpriteScratch {
  return {
    props: {
      positionPx: [0, 0],
      sizePx: [0, 0],
      color: [1, 1, 1, 1],
      frame: 0,
      rotation: 0,
      flipX: false,
      flipY: false,
      visible: true,
    },
  };
}

/**
 * Writes every field of the scratch props record.
 *
 * @param scratch - The reusable record.
 * @param xPx - The sprite's position, in layer pixels.
 * @param yPx - The sprite's position, in layer pixels.
 * @param widthPx - The drawn width, in pixels.
 * @param heightPx - The drawn height, in pixels.
 * @param frame - The atlas frame index.
 * @param rotation - The Lite rotation, in radians.
 * @param r - The red tint, `0` to `1`.
 * @param g - The green tint.
 * @param b - The blue tint.
 * @param a - The alpha.
 * @param flipX - Whether the sprite is mirrored horizontally.
 * @param flipY - Whether the sprite is mirrored vertically.
 * @param visible - Whether the sprite draws at all.
 *
 * @internal
 */
// oxlint-disable-next-line max-params -- one call per sprite per frame; an options object would allocate.
export function writeScratch(
  scratch: SpriteScratch,
  xPx: number,
  yPx: number,
  widthPx: number,
  heightPx: number,
  frame: number,
  rotation: number,
  r: number,
  g: number,
  b: number,
  a: number,
  flipX: boolean,
  flipY: boolean,
  visible: boolean,
): void {
  const props = scratch.props;
  props.positionPx[0] = xPx;
  props.positionPx[1] = yPx;
  const size = props.sizePx;
  if (size !== undefined) {
    size[0] = widthPx;
    size[1] = heightPx;
  }
  const color = props.color;
  if (color !== undefined) {
    color[0] = r;
    color[1] = g;
    color[2] = b;
    color[3] = a;
  }
  props.frame = frame;
  props.rotation = rotation;
  props.flipX = flipX;
  props.flipY = flipY;
  props.visible = visible;
}

/**
 * Adds a sprite described by the scratch record.
 *
 * @param layer - The layer to add to.
 * @param scratch - The reusable props record, already written.
 * @returns The stable handle.
 *
 * @internal
 */
export function addSprite(layer: Sprite2DLayer, scratch: SpriteScratch): Sprite2DHandle {
  return addSprite2D(layer, scratch.props);
}

/**
 * Applies the scratch record to an existing sprite.
 *
 * @param handle - The sprite to update.
 * @param scratch - The reusable props record, already written.
 *
 * @internal
 */
export function updateSprite(handle: Sprite2DHandle, scratch: SpriteScratch): void {
  updateSprite2D(handle, scratch.props);
}

/**
 * Removes a sprite, tolerating a handle whose sprite is already gone.
 *
 * @remarks
 * Lite removes by swapping the last sprite into the freed slot
 * (`lib/sprite/sprite-2d-handle.js`, `onRemoveIndex`), so **indices move** while handles do not.
 * Anything that maps a Lite sprite index back to an ignifx component has to apply the same
 * swap rule.
 *
 * @param handle - The sprite to remove.
 * @returns `true` when a sprite was removed.
 *
 * @internal
 */
export function removeSprite(handle: Sprite2DHandle): boolean {
  if (!isSprite2DHandleAlive(handle)) {
    return false;
  }
  removeSprite2D(handle);
  return true;
}

/**
 * Reads the dense index a handle currently occupies.
 *
 * @param handle - The sprite.
 * @returns The index, or `-1` when the sprite is gone.
 *
 * @internal
 */
export function spriteIndexOf(handle: Sprite2DHandle): number {
  return isSprite2DHandleAlive(handle) ? getSprite2DHandleIndex(handle) : -1;
}

/**
 * Removes every sprite from a layer, keeping the layer itself.
 *
 * @param layer - The layer to empty.
 *
 * @internal
 */
export function clearLayer(layer: Sprite2DLayer): void {
  clearSprite2DLayer(layer);
}

/**
 * Turns Y-sorting on or off for a layer.
 *
 * @remarks
 * Lite sorts **ascending** on `positionPx.y + bias` (`lib/sprite/sprite-2d-y-sort.js`, `keyAt` and
 * `comesBefore`). Layer pixels run +Y **down**, so a sprite higher up the screen has the smaller
 * key and draws first — behind — which is exactly the top-down painter's order ignifx wants.
 *
 * @param layer - The layer.
 * @param enabled - Whether to Y-sort.
 *
 * @internal
 */
export function setYSort(layer: Sprite2DLayer, enabled: boolean): void {
  if (enabled) {
    enableSprite2DYSort(layer);
    return;
  }
  disableSprite2DYSort(layer);
}

/**
 * Applies `orderInLayer` as a Y-sort bias on one sprite.
 *
 * @remarks
 * The bias is added to the sprite's pixel Y before sorting, so it has to be large enough to beat
 * any plausible Y difference: {@link Y_SORT_BIAS_STEP} pixels per unit of `orderInLayer`. A
 * negative `orderInLayer` therefore pulls a sprite behind its neighbours and a positive one pushes
 * it in front, which is what `orderInLayer` means when Y-sort is off too.
 *
 * @param handle - The sprite.
 * @param orderInLayer - The component's `orderInLayer`.
 *
 * @internal
 */
export function setYSortOrder(handle: Sprite2DHandle, orderInLayer: number): void {
  setSprite2DYSortHandleBias(handle, orderInLayer * Y_SORT_BIAS_STEP);
}

/**
 * How many layer pixels one unit of `orderInLayer` is worth as a Y-sort bias.
 *
 * @remarks
 * A million pixels is 10 000 world metres at the default PPU of 100 — far larger than any 2D scene,
 * so `orderInLayer` always dominates world Y, and equal `orderInLayer` values fall back to Y.
 *
 * @internal
 */
export const Y_SORT_BIAS_STEP = 1_000_000;

/**
 * Writes a layer's view: where the camera looks, how far in, and how it is turned.
 *
 * @remarks
 * `Sprite2DView.positionPx` is the layer-pixel point that lands at the viewport's **top-left**, not
 * its centre (`sprite2DWorldToScreenToRef` in `lib/sprite/sprite-2d-view.js` subtracts it before
 * scaling, and the vertex shader maps `v.x / screenWidth * 2 - 1`). {@link centreView} does the
 * centring arithmetic so callers can think in centres.
 *
 * @param view - The view to write.
 * @param xPx - The top-left corner, in layer pixels.
 * @param yPx - The top-left corner, in layer pixels.
 * @param zoom - The scale; must not be zero, which Lite rejects with a `RangeError`.
 * @param rotation - The view rotation, in radians.
 *
 * @internal
 */
export function writeView(view: Sprite2DView, xPx: number, yPx: number, zoom: number, rotation: number): void {
  view.positionPx[0] = xPx;
  view.positionPx[1] = yPx;
  view.zoom = zoom === 0 ? 1 : zoom;
  view.rotation = rotation;
}

/**
 * Centres a view on a layer-pixel point.
 *
 * @param view - The view to write.
 * @param centreXPx - The point to centre on, in layer pixels.
 * @param centreYPx - The point to centre on, in layer pixels.
 * @param widthPx - The viewport width, in pixels.
 * @param heightPx - The viewport height, in pixels.
 * @param zoom - The scale.
 * @param rotation - The view rotation, in radians.
 *
 * @internal
 */
// oxlint-disable-next-line max-params -- called once per camera per frame; an options object would allocate.
export function centreView(
  view: Sprite2DView,
  centreXPx: number,
  centreYPx: number,
  widthPx: number,
  heightPx: number,
  zoom: number,
  rotation: number,
): void {
  const safeZoom = zoom === 0 ? 1 : zoom;
  const inverse = 1 / safeZoom;
  const halfWidth = widthPx * 0.5 * inverse;
  const halfHeight = heightPx * 0.5 * inverse;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  view.positionPx[0] = centreXPx - halfWidth * cos - halfHeight * sin;
  view.positionPx[1] = centreYPx + halfWidth * sin - halfHeight * cos;
  view.zoom = safeZoom;
  view.rotation = rotation;
}

/**
 * Writes the layer-pixel bounds a view can currently see, for chunk culling.
 *
 * @param view - The view.
 * @param widthPx - The viewport width.
 * @param heightPx - The viewport height.
 * @param out - The bounds to write.
 * @returns `out`.
 *
 * @internal
 */
export function visibleBounds<TOut extends Bounds2D>(
  view: Sprite2DView,
  widthPx: number,
  heightPx: number,
  out: TOut,
): TOut {
  return getSprite2DVisibleBoundsToRef(view, widthPx, heightPx, out);
}

/**
 * A mutable point in a layer's pixel space.
 *
 * @internal
 */
export interface LayerPoint {
  /** The layer-space x. */
  x: number;
  /** The layer-space y. */
  y: number;
}

/**
 * Unprojects a viewport pixel into the layer-pixel space a layer's sprites live in.
 *
 * @param view - The layer's view.
 * @param screenXPx - The viewport x, from the left edge.
 * @param screenYPx - The viewport y, from the top edge.
 * @param out - The point to write: its `x` and `y` take the layer-space coordinates.
 * @returns `out`.
 *
 * @internal
 */
export function screenToLayer(view: Sprite2DView, screenXPx: number, screenYPx: number, out: LayerPoint): LayerPoint {
  return sprite2DScreenToWorldToRef(view, screenXPx, screenYPx, out);
}

/**
 * Picks the topmost sprite under a **layer-pixel** point.
 *
 * @remarks
 * This is the trap in Lite's picking API, and it is not in the declaration: despite the parameter
 * names, `pickSprite2D` compares `xPx`/`yPx` directly against each sprite's stored `positionPx` and
 * **never applies the layer's view** (`lib/sprite/picking/pick-sprite-2d.js` lines 26-27). A
 * viewport pixel therefore has to be unprojected with {@link screenToLayer} first, per layer,
 * because a world layer and a screen-space layer carry different views.
 *
 * @param layers - The layers to test, in draw order.
 * @param xPx - The layer-space x.
 * @param yPx - The layer-space y.
 * @returns The hit, or `null`.
 *
 * @internal
 */
export function pickSprite(layers: readonly Sprite2DLayer[], xPx: number, yPx: number): SpritePickInfo | null {
  return pickSprite2D(layers, xPx, yPx);
}

/**
 * Compiles a WGSL fragment body into a layer shader (`index.d.ts` 3160).
 *
 * @remarks
 * The body is compiled on demand and the result is pure data, so one compiled shader can back many
 * layers. `Sprite2DLayerOptions.customShader` is only read at creation and
 * `Sprite2DLayer.customShader` is `readonly` — a layer's shader cannot be swapped later.
 *
 * @param fragment - The WGSL fragment body.
 * @returns The compiled shader.
 *
 * @internal
 */
export function compileLayerShader(fragment: string): Sprite2DCustomShader {
  return createSprite2DCustomShader({ fragment });
}

/**
 * Writes a custom shader's `fx.params` vec4 for one layer.
 *
 * @param layer - The layer.
 * @param x - The first component.
 * @param y - The second component.
 * @param z - The third component.
 * @param w - The fourth component.
 *
 * @internal
 */
export function setShaderParams(layer: Sprite2DLayer, x: number, y: number, z: number, w: number): void {
  setSprite2DShaderParams(layer, [x, y, z, w]);
}
