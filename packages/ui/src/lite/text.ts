import {
  addTextRenderable,
  createDefaultTextData,
  createTextLayer,
  createTextRenderable,
  disposeDefaultTextData,
  disposeTextRenderable,
  setTextLayerPosition,
  updateDefaultTextData,
} from "@babylonjs/lite";
import type {
  DefaultTextData,
  Font,
  SceneContext,
  TextLayer,
  TextLayoutOptions,
  TextRenderable,
  TextRenderer,
} from "@babylonjs/lite";

/**
 * The device-free half of the Babylon Lite text adapter (`docs/architecture/13-ui.md` §2).
 * Everything here shapes text, measures it, and builds the pure-data objects a renderer later
 * draws; nothing touches `engine._device`, which is why this module is **not** under `./gpu/` and
 * is covered by the node suite. Only `createTextRenderer` needs a surface, and that lives in
 * `./gpu/text-renderer.ts`.
 *
 * ## What was verified against `@babylonjs/lite@1.27.0`
 *
 * - `createDefaultTextData(font, fontSizePx, text, textColor?, options?)` (`index.d.ts` 2377)
 *   shapes the string, extracts the glyph outlines, and **owns its own `GlyphStorage`** — the
 *   doc comment at 2375 says so, and `disposeDefaultTextData` (3948) releases both. The returned
 *   `DefaultTextData` carries the laid-out `width` and `height` in pixels (3736-3741), which is
 *   the only text measurement Lite offers.
 * - `updateDefaultTextData(data, text, textColor?)` (13247) re-shapes **with the font size and the
 *   layout options the block was created with** — `lib/text/default-text-data.js` reads
 *   `data._fontSizePx` and `data._options` and never takes new ones — and writes fresh `width`
 *   and `height` onto the block. Changing `fontSize`, `maxWidth`, `align`, `lineHeight`, or the
 *   font therefore means **recreating** the block; changing `text` or `color` does not. Omitting
 *   `textColor` preserves the run's existing colour (13245-13246).
 * - `TextLayoutOptions` (12821) is `{ maxWidth, lineHeight, align, letterSpacing, tabSize }`, in
 *   output pixels, with simple LTR word wrapping.
 * - `align` aligns the lines of a block against **the longest line**, not against `maxWidth`:
 *   measured on the pinned build, `"AAAA\nB"` at 32 px puts the `B` at x 0, 25.92 and 51.84 for
 *   `"left"`, `"center"` and `"right"`, with `width` 69.12 in all three. Centring a block on the
 *   screen is therefore the caller's arithmetic, against {@link measureText}.
 * - Glyph baselines run **downwards in negative y**: line n sits at `-n × fontSizePx × lineHeight`
 *   (`PlacedGlyph`, 8854-8858). A block's first baseline is at the layer's `positionPx`, so its
 *   ascent is above that point.
 * - `createTextLayer(data, options)` (3257) and `createTextRenderable(data, options)` (3264) are
 *   pure object construction; `lib/text/text-renderer.js` and `lib/text/text-renderable.js` build
 *   plain records with `_gpu: null` and allocate GPU resources lazily on the first frame.
 * - **There is no `removeTextRenderable`.** `addTextRenderable(scene, renderable)` (208) pushes a
 *   deferred builder onto the scene (`lib/text/text-renderable.js` 242-249) and Lite exposes no
 *   inverse — `removeFromScene` (9613) takes meshes, lights, cameras, shadow generators, transform
 *   nodes and asset containers, and not a `TextRenderable`. {@link detachSceneText} therefore
 *   empties the block and zeroes its opacity, which makes it draw nothing; the record itself stays
 *   in the scene's renderable list until the scene is disposed. This is reported as a Lite gap.
 *
 * Everything here is `@internal` apart from the type aliases the `.lite` escape hatches name.
 */

/**
 * The Babylon Lite font handle, re-exported under an ignifx name so feature code can name the type
 * without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4).
 *
 * @remarks
 * Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches.
 *
 * @public
 */
export type LiteFont = Font;

/**
 * A shaped block of text, with its glyph storage.
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @public
 */
export type LiteTextData = DefaultTextData;

/**
 * A 2D text layer placed in render-target pixel space.
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @public
 */
export type LiteTextLayer = TextLayer;

/**
 * A scene renderable that draws a block of text in world space.
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @public
 */
export type LiteTextRenderable = TextRenderable;

/**
 * The standalone rendering context that draws 2D text layers onto the swapchain.
 *
 * @remarks
 * Unstable escape-hatch type.
 *
 * @public
 */
export type LiteTextRenderer = TextRenderer;

/**
 * Straight RGBA in `0` to `1`, in the order Lite wants it.
 *
 * @internal
 */
export type TextColor = readonly [number, number, number, number];

/**
 * Everything that decides how a block is laid out. Changing any of it means a new block.
 *
 * @internal
 */
export interface TextShape {
  /** The parsed font. */
  readonly font: LiteFont;
  /** The em size, in render-target pixels. */
  readonly fontSizePx: number;
  /** The string to shape. */
  readonly text: string;
  /** The colour every glyph starts with. */
  readonly color: TextColor;
  /** The wrap width in pixels; `0` or less means no wrapping. */
  readonly maxWidth: number;
  /** Which edge the lines align to, against the longest line. */
  readonly align: "left" | "center" | "right";
  /** The line-height multiplier. */
  readonly lineHeight: number;
}

/**
 * The pixel size of a laid-out block.
 *
 * @public
 */
export interface TextMetrics {
  /** The width of the longest line, in render-target pixels. */
  readonly width: number;
  /** The number of lines times the line height, in render-target pixels. */
  readonly height: number;
}

/**
 * Shapes a block of text.
 *
 * @param shape - The font, size, string, colour, and layout.
 * @returns The block, which owns its glyph storage.
 *
 * @internal
 */
export function createTextBlock(shape: TextShape): LiteTextData {
  const options: TextLayoutOptions = {
    ...(shape.maxWidth > 0 ? { maxWidth: shape.maxWidth } : {}),
    lineHeight: shape.lineHeight,
    align: shape.align,
  };
  return createDefaultTextData(shape.font, shape.fontSizePx, shape.text, shape.color, options);
}

/**
 * Re-shapes a block's string and colour, reusing its font size and layout options.
 *
 * @param data - The block.
 * @param text - The new string.
 * @param color - The new colour.
 *
 * @internal
 */
export function updateTextBlock(data: LiteTextData, text: string, color: TextColor): void {
  updateDefaultTextData(data, text, color);
}

/**
 * Reads a block's laid-out size.
 *
 * @param data - The block.
 * @returns The width and height, in render-target pixels.
 *
 * @internal
 */
export function measureText(data: LiteTextData): TextMetrics {
  return { width: data.width, height: data.height };
}

/**
 * Releases a block's GPU buffers and its glyph storage.
 *
 * @param data - The block.
 *
 * @internal
 */
export function destroyTextBlock(data: LiteTextData): void {
  disposeDefaultTextData(data);
}

/**
 * Builds a pixel-space layer for a block.
 *
 * @param data - The block to draw.
 * @param order - The sort order within the renderer; lower draws first.
 * @param opacity - The whole-block alpha multiplier.
 * @returns The layer.
 *
 * @internal
 */
export function createPixelTextLayer(data: LiteTextData, order: number, opacity: number): LiteTextLayer {
  return createTextLayer(data, { order, opacity });
}

/**
 * Moves a layer to a pixel position, measured from the render target's top-left corner.
 *
 * @param layer - The layer.
 * @param x - The x position, in render-target pixels.
 * @param y - The y position of the first baseline, in render-target pixels.
 *
 * @internal
 */
export function movePixelTextLayer(layer: LiteTextLayer, x: number, y: number): void {
  setTextLayerPosition(layer, x, y);
}

/**
 * Builds a world-space renderable for a block.
 *
 * @param data - The block to draw.
 * @param opacity - The whole-block alpha multiplier.
 * @returns The renderable.
 *
 * @internal
 */
export function createSceneText(data: LiteTextData, opacity: number): LiteTextRenderable {
  return createTextRenderable(data, { opacity });
}

/**
 * Adds a renderable to a scene's draw list.
 *
 * @remarks
 * One-way: Lite has no `removeTextRenderable`. See the module's own remarks.
 *
 * @param scene - The Lite scene, from `app.lite.scene`.
 * @param renderable - The renderable to draw.
 *
 * @internal
 */
export function attachSceneText(scene: SceneContext, renderable: LiteTextRenderable): void {
  addTextRenderable(scene, renderable);
}

/**
 * Makes a renderable draw nothing, which is as close to removing it as Lite allows.
 *
 * @param renderable - The renderable to silence.
 *
 * @internal
 */
export function detachSceneText(renderable: LiteTextRenderable): void {
  renderable.opacity = 0;
}

/**
 * Releases a renderable's GPU buffers. The block it draws is released separately.
 *
 * @param renderable - The renderable.
 *
 * @internal
 */
export function destroySceneText(renderable: LiteTextRenderable): void {
  disposeTextRenderable(renderable);
}

/**
 * Writes a renderable's world position, in metres.
 *
 * @param renderable - The renderable.
 * @param x - The x position.
 * @param y - The y position.
 * @param z - The z position.
 *
 * @internal
 */
export function moveSceneText(renderable: LiteTextRenderable, x: number, y: number, z: number): void {
  renderable.position.set(x, y, z);
}

/**
 * Writes a renderable's world rotation, as a quaternion.
 *
 * @param renderable - The renderable.
 * @param x - The x component.
 * @param y - The y component.
 * @param z - The z component.
 * @param w - The w component.
 *
 * @internal
 */
export function rotateSceneText(renderable: LiteTextRenderable, x: number, y: number, z: number, w: number): void {
  renderable.rotationQuaternion.set(x, y, z, w);
}

/**
 * Writes a renderable's uniform scale.
 *
 * @remarks
 * A block is laid out in **pixels**, so a world-space renderable is scaled down by
 * `1 / pixelsPerUnit` to occupy a sensible number of metres.
 *
 * @param renderable - The renderable.
 * @param scale - The uniform scale.
 *
 * @internal
 */
export function scaleSceneText(renderable: LiteTextRenderable, scale: number): void {
  renderable.scaling.set(scale, scale, scale);
}
