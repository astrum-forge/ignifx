import type { Collider } from "./components/collider.js";
import type { Entity, LayerMask, Vec3Like } from "@ignifx/core";

/**
 * Raycasts return backend body identities. Shape casts use backend hit geometry and the local
 * body-bounds index for identity; overlaps use that index entirely. Shape-cast identities and
 * overlap results are bounds-accurate, not exact shape intersections.
 */

/**
 * Options every query accepts.
 *
 * @public
 */
export interface QueryOptions {
  /** Which layers the query may hit. Defaults to everything. */
  readonly layerMask?: LayerMask;
  /** Whether trigger volumes count as hits. Defaults to `false`. */
  readonly hitTriggers?: boolean;
}

/**
 * Options a shape sweep accepts, on top of {@link QueryOptions}.
 *
 * @remarks
 * `ignore` exists because a sweep that starts at or inside a body — a camera boom leaving its
 * target's capsule, a step probe leaving the character's own feet — reports that body at fraction
 * zero and nothing else. Lite's sweep can exclude exactly one body, and cannot filter by layer at
 * all (`ShapeCastQuery` has `ignoreBody` and no collision masks, unlike `physicsRaycast`), so
 * `layerMask` decides which hit is *attributed* an entity while `ignore` is the one body the
 * geometry itself passes through. Added 2026-09-08.
 *
 * @public
 */
export interface ShapeCastOptions extends QueryOptions {
  /**
   * An entity whose body the sweep passes through — usually the caller's own. A `Rigidbody`, a
   * collider-only static, and a `CharacterController` capsule are all accepted; an entity with no
   * body is ignored.
   */
  readonly ignore?: Entity | null;
}

/**
 * A shape to sweep or to test for overlaps. It is a description, not a component: the service builds
 * the Havok shape for the call and releases it afterwards.
 *
 * @public
 */
export type QueryShape =
  | { readonly kind: "sphere"; readonly radius: number }
  | { readonly kind: "box"; readonly size: Vec3Like }
  | { readonly kind: "capsule"; readonly radius: number; readonly height: number };

/**
 * What a ray hit.
 *
 * @remarks
 * The object is freshly allocated per hit, so it is safe to keep. Queries are not a per-frame path
 * for most games; a game that raycasts every frame should hoist the result and reuse the vectors it
 * copies out of it.
 *
 * @public
 */
export interface RaycastHit {
  /** The entity that was hit. */
  readonly entity: Entity;
  /** The collider on that entity, or `null` when the entity has none registered any more. */
  readonly collider: Collider | null;
  /** The world-space contact point. */
  readonly point: Vec3Like;
  /** The world-space surface normal. */
  readonly normal: Vec3Like;
  /** The distance from the ray origin, in metres. */
  readonly distance: number;
  /** The triangle index on a `MeshCollider`, or `-1` for a primitive. */
  readonly triangleIndex: number;
}

/**
 * What a shape sweep hit.
 *
 * @public
 */
export interface ShapeCastHit {
  /** The entity the swept shape hit, or `null` when the bounds index cannot identify it. */
  readonly entity: Entity | null;
  /** The collider on that entity, or `null`. */
  readonly collider: Collider | null;
  /** The world-space contact point on the hit body. */
  readonly point: Vec3Like;
  /** The world-space contact normal on the hit body. */
  readonly normal: Vec3Like;
  /** How far along the sweep the contact occurs, in `[0, 1]`. */
  readonly fraction: number;
  /** The distance travelled before contact, in metres. */
  readonly distance: number;
}
