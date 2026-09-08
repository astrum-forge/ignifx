/**
 * Tracing the master mark's alpha edge into one closed polygon.
 *
 * The mark is raster (`02-design-system.md` §2.1), so the single-colour forms — `-mono` lockups,
 * `-black`, `-white` — cannot be "the logo in one colour": there is no path to recolour. They are a
 * **silhouette**, and this module produces it.
 *
 * The artwork is low-poly, so the outline really is a few dozen straight segments and a polygon is
 * a faithful description rather than an approximation. The steps are: threshold the alpha, walk the
 * outer boundary of the filled region (Moore-neighbour tracing), then drop the pixel staircase with
 * Douglas–Peucker. `traceSilhouette` also renders the result back and diffs it against the master's
 * own mask, so the generator reports how accurate the trace is instead of asserting that it is.
 */
import { num } from "./svg.ts";
import type { Box, Point } from "./geometry.ts";

/** Alpha at or above which a pixel counts as ink. */
export const ALPHA_THRESHOLD = 128;

/** A one-bit image. */
export interface Mask {
  /** Row-major, one byte per pixel, 1 for ink. */
  readonly bits: Uint8Array;
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
}

/**
 * Thresholds an RGBA raster into a mask.
 *
 * @param pixels - Raw RGBA bytes, row-major.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param channels - Bytes per pixel; the alpha is the last one.
 * @returns The mask.
 */
export function maskFromAlpha(pixels: Uint8Array, width: number, height: number, channels: number): Mask {
  const bits = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index++) {
    bits[index] = (pixels[index * channels + channels - 1] ?? 0) >= ALPHA_THRESHOLD ? 1 : 0;
  }
  return { bits, width, height };
}

/**
 * The mask's bounding box, and how many pixels it holds.
 *
 * @param mask - The mask.
 * @returns The box and the ink pixel count.
 * @throws When the mask is empty.
 */
export function maskBounds(mask: Mask): { readonly box: Box; readonly area: number } {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.bits[y * mask.width + x] === 1) {
        area++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    throw new Error("the mark's alpha channel is empty at the ink threshold");
  }
  return { box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, area };
}

/** The eight neighbours, clockwise from due east. */
const NEIGHBOURS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];

/**
 * The index in {@link NEIGHBOURS} of the step from `from` to `to`.
 *
 * @param from - The centre pixel.
 * @param to - One of its eight neighbours.
 * @returns The index.
 * @throws When the two are not neighbours.
 */
function neighbourIndex(from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const index = NEIGHBOURS.findIndex((delta) => delta.x === dx && delta.y === dy);
  if (index < 0) {
    throw new Error(`(${String(dx)}, ${String(dy)}) is not a step to a neighbour`);
  }
  return index;
}

/**
 * Walks the outer boundary of the mask's ink, clockwise, one pixel per step.
 *
 * Moore-neighbour tracing with Jacob's stopping criterion. The walk carries a boundary pixel `p`
 * and the **background** pixel `b` it was entered from; the eight neighbours of `p` are examined
 * clockwise starting at `b`, the first ink pixel found becomes the next `p`, and the background
 * pixel examined immediately before it becomes the next `b`. The walk ends when it would step onto
 * the start pixel from the same background pixel it started at — which is what distinguishes a
 * finished loop from a pixel the boundary legitimately visits twice, as it does on a one-pixel
 * spur or at the tip of a sharp facet.
 *
 * The scan for the start pixel goes top row first, then left to right, so the start is the mask's
 * topmost-leftmost ink pixel, the pixel west of it is certainly background, and the walk is
 * reproducible.
 *
 * @param mask - The mask. Only the region containing the start pixel is traced, which for this
 *   master is the whole mark (verified: one connected region, no interior holes).
 * @returns The boundary, in pixel coordinates, without a repeated closing point.
 * @throws When the mask has no ink, the ink is one isolated pixel, or the walk does not close.
 */
export function traceOuterBoundary(mask: Mask): readonly Point[] {
  const { width, height, bits } = mask;
  const isInk = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && bits[y * width + x] === 1;

  let start: Point | null = null;
  for (let y = 0; y < height && start === null; y++) {
    for (let x = 0; x < width; x++) {
      if (isInk(x, y)) {
        start = { x, y };
        break;
      }
    }
  }
  if (start === null) {
    throw new Error("the mark's alpha channel is empty at the ink threshold");
  }

  const firstBacktrack: Point = { x: start.x - 1, y: start.y };
  const boundary: Point[] = [start];
  let p = start;
  let b = firstBacktrack;

  for (let step = 0; step < width * height * 8; step++) {
    let next: Point | null = null;
    let nextBacktrack: Point = b;
    let previous: Point = b;
    const from = neighbourIndex(p, b);
    for (let offset = 1; offset <= 8; offset++) {
      const delta = NEIGHBOURS[(from + offset) % 8];
      if (delta === undefined) {
        continue;
      }
      const candidate: Point = { x: p.x + delta.x, y: p.y + delta.y };
      if (isInk(candidate.x, candidate.y)) {
        next = candidate;
        nextBacktrack = previous;
        break;
      }
      previous = candidate;
    }
    if (next === null) {
      throw new Error("the mark's ink is a single isolated pixel");
    }
    if (
      next.x === start.x &&
      next.y === start.y &&
      nextBacktrack.x === firstBacktrack.x &&
      nextBacktrack.y === firstBacktrack.y
    ) {
      return boundary;
    }
    boundary.push(next);
    p = next;
    b = nextBacktrack;
  }
  throw new Error("tracing the mark's outline did not close");
}

/**
 * Serialises a closed polygon as SVG path data.
 *
 * @param ring - The vertices, without a repeated closing point.
 * @returns Path data: one `M`, a run of `L`, then `Z`.
 * @throws When the ring has fewer than three vertices.
 */
export function ringToPath(ring: readonly Point[]): string {
  const first = ring[0];
  if (ring.length < 3 || first === undefined) {
    throw new Error(`a silhouette needs at least three vertices, got ${String(ring.length)}`);
  }
  let data = `M${num(first.x)} ${num(first.y)}`;
  for (const point of ring.slice(1)) {
    data += `L${num(point.x)} ${num(point.y)}`;
  }
  return `${data}Z`;
}

/**
 * How well a traced silhouette matches the mask it came from.
 *
 * @param traced - The silhouette's own mask, rendered at the master's size.
 * @param original - The master's mask.
 * @returns The disagreeing pixel count and the two fractions the build reports.
 * @throws When the two masks are different sizes.
 */
export function compareMasks(
  traced: Mask,
  original: Mask,
): { readonly disagreeing: number; readonly ofInk: number; readonly ofCanvas: number } {
  if (traced.width !== original.width || traced.height !== original.height) {
    throw new Error("cannot compare masks of different sizes");
  }
  let disagreeing = 0;
  let ink = 0;
  for (let index = 0; index < original.bits.length; index++) {
    const a = original.bits[index] ?? 0;
    const b = traced.bits[index] ?? 0;
    if (a === 1) {
      ink++;
    }
    if (a !== b) {
      disagreeing++;
    }
  }
  return { disagreeing, ofInk: disagreeing / ink, ofCanvas: disagreeing / original.bits.length };
}

/** A traced silhouette and the numbers that justify it. */
export interface Silhouette {
  /** SVG path data, in the master's pixel coordinates. */
  readonly data: string;
  /** How many vertices the closed polygon has. */
  readonly vertices: number;
  /** The Douglas–Peucker tolerance that produced it, in master pixels. */
  readonly tolerance: number;
  /** How many boundary pixels the walk found before simplification. */
  readonly boundaryPixels: number;
  /** Disagreeing pixels against the master's mask, as a fraction of the master's ink. */
  readonly mismatchOfInk: number;
  /** The same, as a fraction of the whole canvas. */
  readonly mismatchOfCanvas: number;
}
