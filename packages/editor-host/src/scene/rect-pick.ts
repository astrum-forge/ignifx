/**
 * The arithmetic of `pickRect` that needs no GPU: the rectangle in backing-store pixels, a box's
 * corners projected through a camera's matrices (clipped at the camera plane), a 2D box projected
 * through the 2D editor camera, and the intersect and contain tests. Each is a pure function, so
 * the headless tests check it directly.
 */

import { PickRectMode, PickUnit } from "../protocol/index.js";
import type { Box2D, View2D } from "./view-2d.js";
import type { ViewSurface } from "./view-math.js";
import type { PickRectParams } from "../protocol/index.js";

/** A rectangle of the view, in backing-store pixels, `min` at the top left. */
export interface ScreenRect {
  /** The left edge. */
  readonly minX: number;
  /** The top edge. */
  readonly minY: number;
  /** The right edge. */
  readonly maxX: number;
  /** The bottom edge. */
  readonly maxY: number;
}

/** A projected box: its screen rectangle, and whether all of it was in front of the camera. */
export interface ProjectedBox {
  /** The rectangle the visible part covers on screen, in backing-store pixels. */
  readonly rect: ScreenRect;
  /** True when some corner was behind the camera plane, so the box is not wholly in view. */
  readonly clipped: boolean;
}

/** A box's low and high corners, as three numbers each. */
export interface CornerBox {
  /** The low corner. */
  readonly min: ArrayLike<number>;
  /** The high corner. */
  readonly max: ArrayLike<number>;
}

/** A column-major 4x4 matrix's 16 elements. */
export type Matrix4 = ArrayLike<number>;

/**
 * How far in front of the camera plane, in clip-space `w`, a point must be to project. A box that
 * crosses the plane is cut there, so its rectangle grows toward the screen's edge but stays finite.
 */
const MIN_CLIP_W = 1e-5;

/** The twelve edges of a box, as pairs of corner indices (bit 0 x, bit 1 y, bit 2 z). */
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * Converts `pickRect`'s corners to a backing-store rectangle, ordered and clipped to the canvas.
 *
 * @param params - The corners and their unit.
 * @param surface - The canvas's sizes.
 * @returns The rectangle, or `null` when it lies wholly outside the canvas.
 */
export function rectInBackingPixels(params: PickRectParams, surface: ViewSurface): ScreenRect | null {
  const sx = params.unit === PickUnit.backing ? 1 : surface.width / surface.clientWidth;
  const sy = params.unit === PickUnit.backing ? 1 : surface.height / surface.clientHeight;
  const minX = Math.max(0, Math.min(params.x0, params.x1) * sx);
  const minY = Math.max(0, Math.min(params.y0, params.y1) * sy);
  const maxX = Math.min(surface.width, Math.max(params.x0, params.x1) * sx);
  const maxY = Math.min(surface.height, Math.max(params.y0, params.y1) * sy);
  return minX > maxX || minY > maxY ? null : { minX, minY, maxX, maxY };
}

/**
 * Applies a column-major matrix to a point (`w = 1`).
 *
 * @param m - The matrix.
 * @param x - The point's x.
 * @param y - The point's y.
 * @param z - The point's z.
 * @param out - Receives `[x, y, z, w]`.
 */
function transform(m: Matrix4, x: number, y: number, z: number, out: number[]): void {
  out[0] = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
  out[1] = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
  out[2] = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
  out[3] = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
}

/**
 * Projects a box through a camera: its 8 corners go through the world matrix (when given), the
 * view matrix and the projection, as `Camera.worldToScreen` does. Corners behind the camera plane
 * are dropped and the edges that cross it are cut at it, so a box partly behind the camera covers
 * only what is in front.
 *
 * @param box - The box's `min` and `max` corners, in the space `world` maps from.
 * @param world - The box's world matrix, or `null` when `box` is already in world space.
 * @param view - The camera's view matrix.
 * @param projection - The camera's projection matrix.
 * @param width - The view's backing-store width.
 * @param height - The view's backing-store height.
 * @returns The projected box, or `null` when all of it is behind the camera.
 */
export function projectBox(
  box: CornerBox,
  world: Matrix4 | null,
  view: Matrix4,
  projection: Matrix4,
  width: number,
  height: number,
): ProjectedBox | null {
  const corners: number[][] = [];
  const scratch = [0, 0, 0, 0];
  const eye = [0, 0, 0, 0];
  for (let corner = 0; corner < 8; corner += 1) {
    let x = (corner & 1) === 0 ? (box.min[0] ?? 0) : (box.max[0] ?? 0);
    let y = (corner & 2) === 0 ? (box.min[1] ?? 0) : (box.max[1] ?? 0);
    let z = (corner & 4) === 0 ? (box.min[2] ?? 0) : (box.max[2] ?? 0);
    if (world !== null) {
      transform(world, x, y, z, scratch);
      [x, y, z] = [scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0];
    }
    transform(view, x, y, z, eye);
    const clip = [0, 0, 0, 0];
    transform(projection, eye[0] ?? 0, eye[1] ?? 0, eye[2] ?? 0, clip);
    corners.push(clip);
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const take = (clip: readonly number[]): void => {
    const w = clip[3] ?? 1;
    const sx = ((clip[0] ?? 0) / w + 1) * 0.5 * width;
    const sy = (1 - (clip[1] ?? 0) / w) * 0.5 * height;
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
  };
  let clipped = false;
  for (const clip of corners) {
    if ((clip[3] ?? 0) > MIN_CLIP_W) {
      take(clip);
    } else {
      clipped = true;
    }
  }
  if (clipped) {
    for (const [a, b] of BOX_EDGES) {
      const p = corners[a] ?? scratch;
      const q = corners[b] ?? scratch;
      const pw = p[3] ?? 0;
      const qw = q[3] ?? 0;
      if (pw > MIN_CLIP_W !== qw > MIN_CLIP_W) {
        const t = (MIN_CLIP_W - pw) / (qw - pw);
        take(p.map((value, index) => value + ((q[index] ?? 0) - value) * t));
      }
    }
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { rect: { minX, minY, maxX, maxY }, clipped };
}

/**
 * Projects a 2D world rectangle through the 2D editor camera: the inverse of `screenToWorld2D`.
 *
 * @param view - What the 2D camera shows.
 * @param box - The rectangle, in metres, +Y up.
 * @returns Its screen rectangle, in backing-store pixels.
 */
export function projectBox2D(view: View2D, box: Box2D): ScreenRect {
  const scale = view.zoom * view.pixelsPerUnit;
  return {
    minX: (box.minX - view.centerX) * scale + view.widthPx / 2,
    maxX: (box.maxX - view.centerX) * scale + view.widthPx / 2,
    minY: view.heightPx / 2 - (box.maxY - view.centerY) * scale,
    maxY: view.heightPx / 2 - (box.minY - view.centerY) * scale,
  };
}

/**
 * Tells whether a projected box matches the selection rectangle.
 *
 * @param box - The projected box.
 * @param rect - The selection rectangle.
 * @param mode - `"intersect"`: any overlap; `"contain"`: wholly inside, and wholly in front of the camera.
 * @returns True when it matches.
 */
export function rectMatches(box: ProjectedBox, rect: ScreenRect, mode: PickRectMode): boolean {
  const b = box.rect;
  if (mode === PickRectMode.contain) {
    return !box.clipped && b.minX >= rect.minX && b.maxX <= rect.maxX && b.minY >= rect.minY && b.maxY <= rect.maxY;
  }
  return b.minX <= rect.maxX && b.maxX >= rect.minX && b.minY <= rect.maxY && b.maxY >= rect.minY;
}

/**
 * Grows a projected box to take in another.
 *
 * @param a - The box so far, or `undefined`.
 * @param b - The one to take in.
 * @returns Their union; clipped when either is.
 */
export function unionProjected(a: ProjectedBox | undefined, b: ProjectedBox): ProjectedBox {
  if (a === undefined) {
    return b;
  }
  return {
    rect: {
      minX: Math.min(a.rect.minX, b.rect.minX),
      minY: Math.min(a.rect.minY, b.rect.minY),
      maxX: Math.max(a.rect.maxX, b.rect.maxX),
      maxY: Math.max(a.rect.maxY, b.rect.maxY),
    },
    clipped: a.clipped || b.clipped,
  };
}
