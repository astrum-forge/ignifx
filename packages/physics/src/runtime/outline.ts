import type { QuatLike, Vec3Like } from "@ignifx/core";

/**
 * Line-segment builders for collider outlines (`PhysicsService.colliderOutlines`): what an editor
 * draws as a collider gizmo (ADR-0028, amendment of 2026-10-20). Every builder appends segments to
 * a flat `number[]`, six numbers per segment (`x, y, z` of each end), in the body's own space with
 * the entity's scale applied; {@link placeOutline} moves them into world space.
 *
 * Everything here is `@internal`.
 */

/** How many straight segments approximate a full circle. */
export const OUTLINE_CIRCLE_SEGMENTS = 32;

/** A full turn in radians. */
const TURN = Math.PI * 2;

/** A unit axis, as three numbers. */
type Axis = readonly [number, number, number];

/** The world axes. */
const X_AXIS: Axis = [1, 0, 0];
const Y_AXIS: Axis = [0, 1, 0];
const Z_AXIS: Axis = [0, 0, 1];

/**
 * The axis a capsule stands along, and the two axes across it.
 *
 * @param direction - `"x"`, `"y"`, or `"z"`.
 * @returns `[along, across, across]`.
 *
 * @internal
 */
export function capsuleAxes(direction: "x" | "y" | "z"): readonly [Axis, Axis, Axis] {
  if (direction === "x") {
    return [X_AXIS, Y_AXIS, Z_AXIS];
  }
  return direction === "y" ? [Y_AXIS, X_AXIS, Z_AXIS] : [Z_AXIS, X_AXIS, Y_AXIS];
}

/**
 * Appends one segment.
 *
 * @param out - The segment list.
 * @param a - The first end.
 * @param b - The second end.
 *
 * @internal
 */
export function pushSegment(out: number[], a: Vec3Like, b: Vec3Like): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

/**
 * Appends the twelve edges of an axis-aligned box.
 *
 * @param out - The segment list.
 * @param center - The box centre.
 * @param half - Half its size along each axis.
 *
 * @internal
 */
export function pushBox(out: number[], center: Vec3Like, half: Vec3Like): void {
  const x0 = center.x - half.x;
  const x1 = center.x + half.x;
  const y0 = center.y - half.y;
  const y1 = center.y + half.y;
  const z0 = center.z - half.z;
  const z1 = center.z + half.z;
  for (const [y, z] of [
    [y0, z0],
    [y0, z1],
    [y1, z0],
    [y1, z1],
  ] as const) {
    out.push(x0, y, z, x1, y, z);
  }
  for (const [x, z] of [
    [x0, z0],
    [x0, z1],
    [x1, z0],
    [x1, z1],
  ] as const) {
    out.push(x, y0, z, x, y1, z);
  }
  for (const [x, y] of [
    [x0, y0],
    [x0, y1],
    [x1, y0],
    [x1, y1],
  ] as const) {
    out.push(x, y, z0, x, y, z1);
  }
}

/**
 * Appends an arc of a circle in the plane of two axes.
 *
 * @param out - The segment list.
 * @param center - The circle's centre.
 * @param u - The axis angle `0` points along.
 * @param v - The axis angle `π / 2` points along.
 * @param radius - The radius.
 * @param from - The start angle, in radians.
 * @param to - The end angle, in radians.
 *
 * @internal
 */
export function pushArc(
  out: number[],
  center: Vec3Like,
  u: Axis,
  v: Axis,
  radius: number,
  from: number = 0,
  to: number = TURN,
): void {
  const steps = Math.max(1, Math.round((OUTLINE_CIRCLE_SEGMENTS * Math.abs(to - from)) / TURN));
  let previousCos = Math.cos(from);
  let previousSin = Math.sin(from);
  for (let step = 1; step <= steps; step += 1) {
    const angle = from + ((to - from) * step) / steps;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    out.push(
      center.x + radius * (u[0] * previousCos + v[0] * previousSin),
      center.y + radius * (u[1] * previousCos + v[1] * previousSin),
      center.z + radius * (u[2] * previousCos + v[2] * previousSin),
      center.x + radius * (u[0] * cos + v[0] * sin),
      center.y + radius * (u[1] * cos + v[1] * sin),
      center.z + radius * (u[2] * cos + v[2] * sin),
    );
    previousCos = cos;
    previousSin = sin;
  }
}

/**
 * Appends a sphere's three great circles.
 *
 * @param out - The segment list.
 * @param center - The centre.
 * @param radius - The radius.
 *
 * @internal
 */
export function pushSphere(out: number[], center: Vec3Like, radius: number): void {
  pushArc(out, center, X_AXIS, Y_AXIS, radius);
  pushArc(out, center, Y_AXIS, Z_AXIS, radius);
  pushArc(out, center, Z_AXIS, X_AXIS, radius);
}

/**
 * Appends a capsule: a ring at each end of its segment, four lines joining them, and the two
 * half-circle profiles of each cap.
 *
 * @param out - The segment list.
 * @param center - The capsule's centre.
 * @param direction - The axis it stands along.
 * @param radius - Its radius.
 * @param halfSegment - Half the length of the segment between the cap centres.
 *
 * @internal
 */
export function pushCapsule(
  out: number[],
  center: Vec3Like,
  direction: "x" | "y" | "z",
  radius: number,
  halfSegment: number,
): void {
  const [along, u, v] = capsuleAxes(direction);
  const top = offset(center, along, halfSegment);
  const bottom = offset(center, along, -halfSegment);
  pushTube(out, top, bottom, u, v, radius);
  for (const across of [u, v]) {
    pushArc(out, top, across, along, radius, 0, Math.PI);
    pushArc(out, bottom, across, along, radius, Math.PI, TURN);
  }
}

/**
 * Appends a cylinder standing along the Y axis: a ring at each end and four lines joining them.
 *
 * @param out - The segment list.
 * @param center - The cylinder's centre.
 * @param radius - Its radius.
 * @param halfHeight - Half its height.
 *
 * @internal
 */
export function pushCylinder(out: number[], center: Vec3Like, radius: number, halfHeight: number): void {
  pushTube(out, offset(center, Y_AXIS, halfHeight), offset(center, Y_AXIS, -halfHeight), X_AXIS, Z_AXIS, radius);
}

/**
 * Moves an outline from body space into world space, in place, and packs it.
 *
 * @param local - The segments in body space, scale applied.
 * @param position - The body's world position.
 * @param rotation - The body's world rotation.
 * @returns The segments in world space.
 *
 * @internal
 */
export function placeOutline(local: readonly number[], position: Vec3Like, rotation: QuatLike): Float32Array {
  const out = new Float32Array(local.length);
  const { x: qx, y: qy, z: qz, w: qw } = rotation;
  for (let index = 0; index + 2 < local.length; index += 3) {
    const x = local[index] ?? 0;
    const y = local[index + 1] ?? 0;
    const z = local[index + 2] ?? 0;
    // v' = v + 2w(q × v) + 2(q × (q × v)), the usual quaternion rotation without a matrix.
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    out[index] = x + qw * tx + (qy * tz - qz * ty) + position.x;
    out[index + 1] = y + qw * ty + (qz * tx - qx * tz) + position.y;
    out[index + 2] = z + qw * tz + (qx * ty - qy * tx) + position.z;
  }
  return out;
}

/**
 * Appends two rings and the four lines joining them.
 *
 * @param out - The segment list.
 * @param top - The centre of one ring.
 * @param bottom - The centre of the other.
 * @param u - One axis across the tube.
 * @param v - The other.
 * @param radius - The radius.
 */
function pushTube(out: number[], top: Vec3Like, bottom: Vec3Like, u: Axis, v: Axis, radius: number): void {
  pushArc(out, top, u, v, radius);
  pushArc(out, bottom, u, v, radius);
  for (const [axis, sign] of [
    [u, 1],
    [u, -1],
    [v, 1],
    [v, -1],
  ] as const) {
    pushSegment(out, offset(top, axis, sign * radius), offset(bottom, axis, sign * radius));
  }
}

/**
 * A point moved along an axis.
 *
 * @param point - The start.
 * @param axis - The unit axis.
 * @param distance - How far.
 * @returns A fresh point.
 */
function offset(point: Vec3Like, axis: Axis, distance: number): Vec3Like {
  return { x: point.x + axis[0] * distance, y: point.y + axis[1] * distance, z: point.z + axis[2] * distance };
}
