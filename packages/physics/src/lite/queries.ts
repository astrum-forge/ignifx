import { physicsRaycast, shapeCast, shapeProximity } from "@babylonjs/lite";
import type { LitePhysicsBody, LitePhysicsShape, LitePhysicsWorld } from "./havok.js";
import type { LiteSceneNode, MutableVec3, QuatLike, Vec3Like } from "@ignifx/core";

/**
 * The query half of this package's Babylon Lite adapter (`docs/architecture/09-physics.md` §5).
 *
 * ## What Lite 1.27.0 actually returns (verified in `lib/physics/havok-queries.js`)
 *
 * - `physicsRaycast` (`index.d.ts` 8577) is the **only** query that reports a body: it resolves the
 *   native id through `findBodyById` and returns `RaycastResult.body` (9388).
 * - `shapeCast` (11479) returns `fraction`, two contact points, and two normals — and **no body**
 *   (`ShapeCastResult`, 11497).
 * - `shapeProximity` (11524) returns the single **closest** hit within `maxDistance`, also with no
 *   body (`ShapeProximityResult`, 11540); the collector it uses is created with capacity `1`
 *   (`getCollector`, `havok-queries.js:7`), so it can never report more than one hit.
 *
 * `09-physics.md` §5 promises `shapeCast(...) : ShapeCastHit` and `overlap(...) : Entity[]`. Neither
 * identity is available upstream, so `PhysicsService` resolves those two against its own body index
 * (bounds-accurate) and the doc correction is recorded in the Phase 4 report. Everything here stays
 * a thin, typed pass-through.
 *
 * Everything here is `@internal`.
 */

/** What a ray query answered. */
export interface RayQueryResult {
  /** Whether the ray hit anything. */
  hit: boolean;
  /** The node of the body that was hit, or `null`. */
  node: LiteSceneNode | null;
  /** Distance from the origin to the contact, in metres. */
  distance: number;
  /** The triangle index on a `MESH` shape, or `-1`. */
  triangleIndex: number;
}

/**
 * Casts a ray and writes the contact into out parameters (coding standards §7: no allocation on a
 * query path beyond Lite's own result object).
 *
 * @param world - The world handle.
 * @param from - The world-space origin.
 * @param to - The world-space end point.
 * @param membership - The querying mask; `~0` for "belongs to everything".
 * @param collideWith - The mask of layers the ray may hit.
 * @param hitTriggers - Whether trigger volumes count as hits.
 * @param point - Written with the contact point.
 * @param normal - Written with the contact normal.
 * @param out - Written with the hit flag, node, distance, and triangle index.
 *
 * @internal
 */
export function castRay(
  world: LitePhysicsWorld,
  from: Vec3Like,
  to: Vec3Like,
  membership: number,
  collideWith: number,
  hitTriggers: boolean,
  point: MutableVec3,
  normal: MutableVec3,
  out: RayQueryResult,
): void {
  const result = physicsRaycast(
    world,
    { x: from.x, y: from.y, z: from.z },
    { x: to.x, y: to.y, z: to.z },
    { membership, collideWith, shouldHitTriggers: hitTriggers },
  );
  out.hit = result.hasHit;
  out.node = bodyNodeOf(result.body);
  out.distance = result.hitDistance;
  out.triangleIndex = result.triangleIndex;
  point.set(result.hitPoint.x, result.hitPoint.y, result.hitPoint.z);
  normal.set(result.hitNormal.x, result.hitNormal.y, result.hitNormal.z);
}

/** What a shape sweep answered. */
export interface SweepQueryResult {
  /** Whether the swept shape hit anything. */
  hit: boolean;
  /** The fraction along the sweep where contact first occurs, in `[0, 1]`. */
  fraction: number;
}

/**
 * Sweeps a shape from one position to another.
 *
 * @param world - The world handle.
 * @param shape - The shape to sweep.
 * @param rotation - The orientation held constant during the sweep.
 * @param from - The start position.
 * @param to - The end position.
 * @param hitTriggers - Whether trigger volumes count as hits.
 * @param point - Written with the contact point on the hit body.
 * @param normal - Written with the contact normal on the hit body.
 * @param out - Written with the hit flag and the sweep fraction.
 *
 * @internal
 */
export function sweepShape(
  world: LitePhysicsWorld,
  shape: LitePhysicsShape,
  rotation: QuatLike,
  from: Vec3Like,
  to: Vec3Like,
  hitTriggers: boolean,
  point: MutableVec3,
  normal: MutableVec3,
  out: SweepQueryResult,
): void {
  const result = shapeCast(world, {
    shape,
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    startPosition: { x: from.x, y: from.y, z: from.z },
    endPosition: { x: to.x, y: to.y, z: to.z },
    shouldHitTriggers: hitTriggers,
  });
  out.hit = result.hasHit;
  out.fraction = result.fraction;
  point.set(result.hitPoint.x, result.hitPoint.y, result.hitPoint.z);
  normal.set(result.hitNormal.x, result.hitNormal.y, result.hitNormal.z);
}

/**
 * Finds the distance from a positioned shape to the nearest body, which is what Lite's
 * `shapeProximity` reports. It is used as a cheap "is anything in range at all" test; the entities
 * themselves come from the service's own body index.
 *
 * @param world - The world handle.
 * @param shape - The query shape.
 * @param position - Its world position.
 * @param rotation - Its world rotation.
 * @param maxDistance - How far to search.
 * @param hitTriggers - Whether trigger volumes count.
 * @returns The distance to the nearest body, or `Number.POSITIVE_INFINITY` when nothing is in range.
 *
 * @internal
 */
export function nearestDistance(
  world: LitePhysicsWorld,
  shape: LitePhysicsShape,
  position: Vec3Like,
  rotation: QuatLike,
  maxDistance: number,
  hitTriggers: boolean,
): number {
  const result = shapeProximity(world, {
    shape,
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    maxDistance,
    shouldHitTriggers: hitTriggers,
  });
  return result.hasHit ? result.distance : Number.POSITIVE_INFINITY;
}

/**
 * Reads the node off an optional body handle.
 *
 * @param body - The body Lite reported, or `null`.
 * @returns The node, or `null`.
 */
function bodyNodeOf(body: LitePhysicsBody | null): LiteSceneNode | null {
  return body === null ? null : body.node;
}
