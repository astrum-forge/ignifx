import { DEG_TO_RAD, RAD_TO_DEG } from "@ignifx/core";
import type { MutableVec2, Vec2Like } from "@ignifx/core";

/**
 * The one place the ignifx 2D world (metres, **+Y up**, ADR-0011) is converted into Babylon Lite's
 * sprite space (pixels, **+Y down**) and back. Every other module in this package goes through
 * these functions, so the flip lives in exactly one file
 * (`docs/architecture/11-2d-toolkit.md` §1 and §3).
 *
 * Nothing here allocates: every conversion writes into a caller-owned vector (coding standards §7).
 */

/**
 * The default pixels-per-unit, matching `twoD.pixelsPerUnit`
 * (`docs/architecture/11-2d-toolkit.md` §1). At 100, a 32-pixel sprite is 0.32 metres wide.
 *
 * @public
 */
export const DEFAULT_PIXELS_PER_UNIT = 100;

/**
 * Converts a world point in metres to a Lite layer-pixel point.
 *
 * @param x - The world x, in metres.
 * @param y - The world y, in metres, with +Y up.
 * @param pixelsPerUnit - The pixels one metre spans.
 * @param out - The vector to write.
 * @returns `out`, in pixels with +Y down.
 *
 * @example
 * ```ts
 * worldToPixelsToRef(1.5, 0.5, 100, out); // out is (150, -50)
 * ```
 *
 * @public
 */
export function worldToPixelsToRef<TOut extends MutableVec2>(
  x: number,
  y: number,
  pixelsPerUnit: number,
  out: TOut,
): TOut {
  out.x = x * pixelsPerUnit;
  out.y = -y * pixelsPerUnit;
  return out;
}

/**
 * Converts a Lite layer-pixel point back to world metres.
 *
 * @param xPx - The layer x, in pixels.
 * @param yPx - The layer y, in pixels, with +Y down.
 * @param pixelsPerUnit - The pixels one metre spans.
 * @param out - The vector to write.
 * @returns `out`, in metres with +Y up.
 *
 * @public
 */
export function pixelsToWorldToRef<TOut extends MutableVec2>(
  xPx: number,
  yPx: number,
  pixelsPerUnit: number,
  out: TOut,
): TOut {
  out.x = xPx / pixelsPerUnit;
  out.y = -yPx / pixelsPerUnit;
  return out;
}

/**
 * Converts an ignifx rotation about +Z into the rotation Lite gives a **sprite**.
 *
 * @remarks
 * `Transform.rotation2D` is degrees counter-clockwise in a +Y-up world. A sprite's quad is built in
 * Lite's +Y-down pixel space (`(corner - pivot) * sizePx`, then rotated), so the same visual turn is
 * the negated angle there. Verified against the sprite vertex shader in
 * `@babylonjs/lite@1.27.0`, `lib/sprite/sprite-pipeline.js` line 25.
 *
 * @param degrees - The ignifx rotation, in degrees counter-clockwise.
 * @returns The rotation to write to `Sprite2DProps.rotation`, in radians.
 *
 * @public
 */
export function spriteRotationToLite(degrees: number): number {
  return -degrees * DEG_TO_RAD;
}

/**
 * Converts a Lite sprite rotation back to ignifx degrees.
 *
 * @param radians - The `Sprite2DProps.rotation` value.
 * @returns The ignifx rotation, in degrees counter-clockwise.
 *
 * @public
 */
export function spriteRotationFromLite(radians: number): number {
  return -radians * RAD_TO_DEG;
}

/**
 * Converts a `Camera2D` rotation into the rotation Lite gives a **view**.
 *
 * @remarks
 * A view rotation is applied to an already-flipped world offset rather than to a sprite-local
 * offset, and the two flips cancel — so unlike {@link spriteRotationToLite} the sign is kept.
 * Verified against `sprite2DWorldToScreenToRef` in `@babylonjs/lite@1.27.0`,
 * `lib/sprite/sprite-2d-view.js`.
 *
 * @param degrees - The camera rotation, in degrees counter-clockwise.
 * @returns The rotation to write to `Sprite2DView.rotation`, in radians.
 *
 * @public
 */
export function viewRotationToLite(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/**
 * The zoom a `Camera2D` needs so that `orthographicSize` metres fill half the viewport's height
 * (`docs/architecture/11-2d-toolkit.md` §2.1).
 *
 * @param viewportHeightPx - The viewport height, in pixels.
 * @param orthographicSize - The camera's half-height, in metres.
 * @param pixelsPerUnit - The pixels one metre spans.
 * @returns The `Sprite2DView.zoom` value; never zero, because Lite rejects a zero zoom.
 *
 * @public
 */
export function zoomForSize(viewportHeightPx: number, orthographicSize: number, pixelsPerUnit: number): number {
  const divisor = 2 * orthographicSize * pixelsPerUnit;
  if (divisor <= 0) {
    return 1;
  }
  const zoom = viewportHeightPx / divisor;
  return zoom > 0 ? zoom : 1;
}

/**
 * The inverse of {@link zoomForSize}: what half-height a zoom shows.
 *
 * @param viewportHeightPx - The viewport height, in pixels.
 * @param zoom - The `Sprite2DView.zoom` value.
 * @param pixelsPerUnit - The pixels one metre spans.
 * @returns The half-height, in metres.
 *
 * @public
 */
export function sizeForZoom(viewportHeightPx: number, zoom: number, pixelsPerUnit: number): number {
  if (zoom <= 0 || pixelsPerUnit <= 0) {
    return 0;
  }
  return viewportHeightPx / (2 * zoom * pixelsPerUnit);
}

/**
 * Snaps a zoom to the nearest usable integer for a pixel-perfect camera
 * (`docs/architecture/11-2d-toolkit.md` §4).
 *
 * @remarks
 * Zooms below 1 snap to the reciprocal of an integer (`1/2`, `1/3`, …) rather than to zero, so a
 * camera that is pulled far out still lands on a whole-texel scale.
 *
 * @param zoom - The continuous zoom {@link zoomForSize} produced.
 * @returns The snapped zoom, always greater than zero.
 *
 * @public
 */
export function snapZoomToInteger(zoom: number): number {
  if (zoom >= 1) {
    return Math.max(1, Math.floor(zoom));
  }
  if (zoom <= 0) {
    return 1;
  }
  return 1 / Math.max(1, Math.round(1 / zoom));
}

/**
 * Snaps a layer-pixel coordinate to the whole-pixel grid a pixel-perfect camera draws on.
 *
 * @param valuePx - The coordinate, in layer pixels.
 * @param zoom - The camera's zoom; at zoom 2 the grid step is half a layer pixel.
 * @returns The snapped coordinate.
 *
 * @public
 */
export function snapPixel(valuePx: number, zoom: number): number {
  if (zoom <= 0) {
    return valuePx;
  }
  return Math.round(valuePx * zoom) / zoom;
}

/**
 * Places the pivot of a sprite at a world point by offsetting the position Lite draws it at.
 *
 * @remarks
 * Lite's sprite pipeline has **one pivot per layer**, not per sprite or per frame: the vertex
 * shader reads `L.pivot` out of the layer uniform (`lib/sprite/sprite-pipeline.js` lines 25 and
 * 264–265), and the per-frame `SpriteFrame.pivot` is consumed only by the *billboard* family
 * (`lib/sprite/billboard-sprite.js` lines 166–167). ignifx therefore keeps every layer on the
 * centre pivot `[0.5, 0.5]` and moves the sprite instead, which is what makes a per-frame pivot and
 * `SpriteRenderer.pivotOverride` work at all.
 *
 * @param anchorXPx - The world anchor, in layer pixels.
 * @param anchorYPx - The world anchor, in layer pixels.
 * @param pivot - The pivot in `[0, 1]` of the frame; `[0, 0]` is top-left, `[1, 1]` bottom-right.
 * @param widthPx - The drawn width, in pixels.
 * @param heightPx - The drawn height, in pixels.
 * @param rotationRadians - The sprite's Lite rotation, which the offset turns with.
 * @param out - The vector to write.
 * @returns `out`: the value to write to `Sprite2DProps.positionPx`.
 *
 * @public
 */
export function pivotedPositionToRef<TOut extends MutableVec2>(
  anchorXPx: number,
  anchorYPx: number,
  pivot: Vec2Like,
  widthPx: number,
  heightPx: number,
  rotationRadians: number,
  out: TOut,
): TOut {
  const offsetX = (0.5 - pivot.x) * widthPx;
  const offsetY = (0.5 - pivot.y) * heightPx;
  if (rotationRadians === 0) {
    out.x = anchorXPx + offsetX;
    out.y = anchorYPx + offsetY;
    return out;
  }
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  out.x = anchorXPx + offsetX * cos - offsetY * sin;
  out.y = anchorYPx + offsetX * sin + offsetY * cos;
  return out;
}
