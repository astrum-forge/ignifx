/**
 * Where a shaped block goes on the screen (`docs/architecture/13-ui.md` §2).
 *
 * Pure arithmetic, so the node suite covers all nine anchors with no GPU and no DOM.
 *
 * ## What Lite gives, and what it does not
 *
 * A `DefaultTextData` reports the laid-out `width` and `height` of the block and nothing else — no
 * ascent, no descent, no baseline offset (`index.d.ts` 3736-3741). Glyph baselines run downwards
 * in negative y from the layer's `positionPx`, verified on the pinned build: `"A\nB\nC"` at 32 px
 * with `lineHeight` 2 places the three baselines at y `0`, `-64`, `-128`.
 *
 * So the **first baseline** is at `positionPx.y`, and the box the reader perceives starts one em
 * above it. `ascentOf` is that approximation, stated once here rather than guessed at in three
 * components: an em is the right order of magnitude for every Latin face and it is what makes
 * `anchor: "topLeft"` put the text just inside the top-left corner rather than half off-screen.
 */

/**
 * The nine points of a rectangle a block can be anchored to.
 *
 * @public
 */
export const HUD_ANCHORS = [
  "topLeft",
  "top",
  "topRight",
  "left",
  "center",
  "right",
  "bottomLeft",
  "bottom",
  "bottomRight",
] as const;

/**
 * Which point of the render target a `HudText`'s position is measured from, and which point of the
 * block sits there.
 *
 * @public
 */
export type HudAnchor = (typeof HUD_ANCHORS)[number];

/** The horizontal fraction of each anchor: `0` at the left edge, `1` at the right. */
const ANCHOR_X: Readonly<Record<HudAnchor, number>> = Object.freeze({
  topLeft: 0,
  top: 0.5,
  topRight: 1,
  left: 0,
  center: 0.5,
  right: 1,
  bottomLeft: 0,
  bottom: 0.5,
  bottomRight: 1,
});

/** The vertical fraction of each anchor: `0` at the top edge, `1` at the bottom. */
const ANCHOR_Y: Readonly<Record<HudAnchor, number>> = Object.freeze({
  topLeft: 0,
  top: 0,
  topRight: 0,
  left: 0.5,
  center: 0.5,
  right: 0.5,
  bottomLeft: 1,
  bottom: 1,
  bottomRight: 1,
});

/**
 * The distance from a block's first baseline up to the top of the box a reader perceives.
 *
 * @param fontSize - The em size the block was shaped at.
 * @returns The ascent, in render-target pixels.
 *
 * @internal
 */
export function ascentOf(fontSize: number): number {
  return fontSize;
}

/**
 * A layer position, written in place so the per-frame path allocates nothing.
 *
 * @public
 */
export interface HudPlacement {
  /** The layer's x, in render-target pixels. */
  x: number;
  /** The layer's y — the first baseline — in render-target pixels. */
  y: number;
}

/**
 * What {@link computeHudPlacement} needs.
 *
 * @public
 */
export interface HudPlacementInput {
  /** Which point of the target the position is measured from, and which point of the block lands there. */
  readonly anchor: HudAnchor;
  /** The offset from that point, in render-target pixels; x grows right, y grows down. */
  readonly offsetX: number;
  /** The offset from that point, in render-target pixels. */
  readonly offsetY: number;
  /** The render target's width, in pixels. */
  readonly targetWidth: number;
  /** The render target's height, in pixels. */
  readonly targetHeight: number;
  /** The block's laid-out width. */
  readonly blockWidth: number;
  /** The block's laid-out height. */
  readonly blockHeight: number;
  /** The em size the block was shaped at. */
  readonly fontSize: number;
}

/**
 * Places a block against one of the nine anchors of the render target.
 *
 * @param input - The anchor, the offset, the target size, and the block's size.
 * @param out - Receives the layer position.
 * @returns `out`, for chaining.
 *
 * @example
 * ```ts
 * const out = { x: 0, y: 0 };
 * computeHudPlacement(
 *   {
 *     anchor: "topRight",
 *     offsetX: -16,
 *     offsetY: 16,
 *     targetWidth: 800,
 *     targetHeight: 600,
 *     blockWidth: 100,
 *     blockHeight: 40,
 *     fontSize: 32,
 *   },
 *   out,
 * );
 * out.x; // 684 — 16 px in from the right edge
 * ```
 *
 * @public
 */
export function computeHudPlacement(input: HudPlacementInput, out: HudPlacement): HudPlacement {
  const fractionX = ANCHOR_X[input.anchor];
  const fractionY = ANCHOR_Y[input.anchor];
  const boxLeft = fractionX * input.targetWidth + input.offsetX - fractionX * input.blockWidth;
  const boxTop = fractionY * input.targetHeight + input.offsetY - fractionY * input.blockHeight;
  out.x = boxLeft;
  out.y = boxTop + ascentOf(input.fontSize);
  return out;
}

/**
 * Places a block around a point, with the given point of the block sitting on it.
 *
 * @param pivot - Which point of the block lands on the position.
 * @param x - The point's x, in render-target pixels.
 * @param y - The point's y, in render-target pixels.
 * @param blockWidth - The block's laid-out width.
 * @param blockHeight - The block's laid-out height.
 * @param fontSize - The em size the block was shaped at.
 * @param out - Receives the layer position.
 * @returns `out`, for chaining.
 *
 * @example
 * ```ts
 * const out = { x: 0, y: 0 };
 * computePivotPlacement("center", 400, 300, 100, 40, 32, out);
 * out.x; // 350
 * ```
 *
 * @public
 */
export function computePivotPlacement(
  pivot: HudAnchor,
  x: number,
  y: number,
  blockWidth: number,
  blockHeight: number,
  fontSize: number,
  out: HudPlacement,
): HudPlacement {
  out.x = x - ANCHOR_X[pivot] * blockWidth;
  out.y = y - ANCHOR_Y[pivot] * blockHeight + ascentOf(fontSize);
  return out;
}
