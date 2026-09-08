/**
 * The small amount of geometry the kit needs: a box, a point, and Douglas–Peucker.
 */

/** An axis-aligned box, y down. */
export interface Box {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Extent along x. */
  readonly width: number;
  /** Extent along y. */
  readonly height: number;
}

/** A point, y down. */
export interface Point {
  /** Horizontal position. */
  readonly x: number;
  /** Vertical position. */
  readonly y: number;
}

/**
 * Perpendicular distance from a point to the line through `from` and `to`.
 *
 * @param point - The point.
 * @param from - One end of the line.
 * @param to - The other end.
 * @returns The distance. When the line degenerates to a point, the distance to that point.
 */
function distanceToLine(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return Math.hypot(point.x - from.x, point.y - from.y);
  }
  return Math.abs(dy * (point.x - from.x) - dx * (point.y - from.y)) / length;
}

/**
 * Douglas–Peucker simplification of an open polyline.
 *
 * @param points - The polyline, at least two points.
 * @param tolerance - The greatest distance a dropped point may have from the kept line.
 * @returns The kept points, first and last always included.
 */
function simplifyPolyline(points: readonly Point[], tolerance: number): readonly Point[] {
  const first = points[0];
  const last = points.at(-1);
  if (points.length < 3 || first === undefined || last === undefined) {
    return points;
  }
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    if (point === undefined) {
      continue;
    }
    const distance = distanceToLine(point, first, last);
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= tolerance) {
    return [first, last];
  }
  const head = simplifyPolyline(points.slice(0, index + 1), tolerance);
  const tail = simplifyPolyline(points.slice(index), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/**
 * Douglas–Peucker simplification of a **closed** ring.
 *
 * A closed ring has no natural pair of fixed end points, and picking the wrong pair rounds off a
 * real corner. The two points furthest apart are used as the anchors and the ring is simplified as
 * two polylines between them, which keeps the shape's extremes whatever the trace's start pixel was
 * — so the result does not depend on where the boundary walk began.
 *
 * @param ring - The ring, without a repeated closing point.
 * @param tolerance - The greatest distance a dropped point may have from the kept line.
 * @returns The kept points, in ring order, without a repeated closing point.
 */
export function simplifyRing(ring: readonly Point[], tolerance: number): readonly Point[] {
  if (ring.length < 4) {
    return ring;
  }
  let anchorA = 0;
  let anchorB = 0;
  let furthest = -1;
  const origin = ring[0];
  if (origin === undefined) {
    return ring;
  }
  // The point furthest from ring[0], then the point furthest from that one: two passes give a
  // diameter-like pair cheaply, and deterministically.
  for (const [index, point] of ring.entries()) {
    const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
    if (distance > furthest) {
      furthest = distance;
      anchorA = index;
    }
  }
  const a = ring[anchorA];
  if (a === undefined) {
    return ring;
  }
  furthest = -1;
  for (const [index, point] of ring.entries()) {
    const distance = Math.hypot(point.x - a.x, point.y - a.y);
    if (distance > furthest) {
      furthest = distance;
      anchorB = index;
    }
  }
  const [low, high] = anchorA <= anchorB ? [anchorA, anchorB] : [anchorB, anchorA];
  const front = simplifyPolyline(ring.slice(low, high + 1), tolerance);
  const back = simplifyPolyline([...ring.slice(high), ...ring.slice(0, low + 1)], tolerance);
  // `front` ends where `back` starts and `back` ends where `front` starts; drop both duplicates.
  return [...front.slice(0, -1), ...back.slice(0, -1)];
}
