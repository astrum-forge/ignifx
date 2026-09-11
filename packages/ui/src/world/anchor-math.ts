import { clamp } from "@ignifx/core";
import type { UiPixelMapping } from "../dom/scaling.js";

/**
 * Convert camera backing-store pixels to overlay units through `UiPixelMapping`.
 * Behind-camera projections are mirrored: hide them, or reflect before clamping to the viewport
 * edge. Keep the arithmetic independent of the DOM for headless tests.
 */

/**
 * Everything {@link computeAnchorPlacement} reads.
 *
 * @public
 */
export interface AnchorInput {
  /** The projected x, in render-target pixels. */
  readonly screenX: number;
  /** The projected y, in render-target pixels. */
  readonly screenY: number;
  /** Whether the point is in front of the camera. */
  readonly inFront: boolean;
  /** How far the point is from the camera, in metres. */
  readonly distance: number;
  /** The overlay root's width, in UI units. */
  readonly viewWidth: number;
  /** The overlay root's height, in UI units. */
  readonly viewHeight: number;
  /** The render-target-pixel to UI-unit conversion. */
  readonly mapping: UiPixelMapping;
  /** Whether the element is hidden when the point is behind the camera. */
  readonly hideWhenBehindCamera: boolean;
  /** Whether the element is kept inside the overlay's bounds. */
  readonly clampToScreen: boolean;
  /** Whether the element shrinks with distance. */
  readonly scaleWithDistance: boolean;
  /** The distance at which {@link AnchorInput.scaleWithDistance} produces a scale of `1`. */
  readonly referenceDistance: number;
  /** The smallest scale distance scaling may produce. */
  readonly minScale: number;
  /** The largest scale distance scaling may produce. */
  readonly maxScale: number;
}

/**
 * Where the element goes, written in place so the per-frame path allocates nothing.
 *
 * @public
 */
export interface AnchorPlacement {
  /** Whether the element is shown at all. */
  visible: boolean;
  /** The x, in UI units from the overlay root's left edge. */
  x: number;
  /** The y, in UI units from the overlay root's top edge. */
  y: number;
  /** The uniform scale to draw the element at. */
  scale: number;
}

/**
 * Builds a zeroed placement, for a component to reuse every frame.
 *
 * @returns The placement.
 *
 * @internal
 */
export function createAnchorPlacement(): AnchorPlacement {
  return { visible: false, x: 0, y: 0, scale: 1 };
}

/**
 * The smallest distance the scale divisor accepts, so an anchor sitting on the camera does not
 * produce an infinite scale.
 */
const MIN_DISTANCE = 0.001;

/**
 * Computes where an anchored element goes this frame.
 *
 * @param input - The projection, the flags, and the conversion.
 * @param out - Receives the placement.
 * @returns `out`, for chaining.
 *
 * @example
 * ```ts
 * const out = createAnchorPlacement();
 * computeAnchorPlacement(
 *   {
 *     screenX: 400,
 *     screenY: 300,
 *     inFront: true,
 *     distance: 10,
 *     viewWidth: 800,
 *     viewHeight: 600,
 *     mapping: { scaleX: 1, originX: 0, scaleY: 1, originY: 0 },
 *     hideWhenBehindCamera: true,
 *     clampToScreen: false,
 *     scaleWithDistance: false,
 *     referenceDistance: 10,
 *     minScale: 0.5,
 *     maxScale: 2,
 *   },
 *   out,
 * );
 * out.x; // 400
 * ```
 *
 * @public
 */
export function computeAnchorPlacement(input: AnchorInput, out: AnchorPlacement): AnchorPlacement {
  let x = input.screenX * input.mapping.scaleX - input.mapping.originX;
  let y = input.screenY * input.mapping.scaleY - input.mapping.originY;
  if (!input.inFront) {
    if (input.hideWhenBehindCamera || !input.clampToScreen) {
      out.visible = false;
      out.x = x;
      out.y = y;
      out.scale = 1;
      return out;
    }
    x = input.viewWidth - x;
    y = input.viewHeight - y;
  }
  if (input.clampToScreen) {
    x = clamp(x, 0, input.viewWidth);
    y = clamp(y, 0, input.viewHeight);
  }
  out.visible = input.clampToScreen || (x >= 0 && x <= input.viewWidth && y >= 0 && y <= input.viewHeight);
  out.x = x;
  out.y = y;
  out.scale = input.scaleWithDistance
    ? clamp(input.referenceDistance / Math.max(input.distance, MIN_DISTANCE), input.minScale, input.maxScale)
    : 1;
  return out;
}
