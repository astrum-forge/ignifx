import type { Collider } from "./components/collider.js";
import type { Entity, LayerMask, Vec3Like } from "@ignifx/core";

/**
 * The query vocabulary of `app.physics` (`docs/architecture/09-physics.md` §5).
 *
 * ## Two corrections to §5
 *
 * `@babylonjs/lite@1.27.0` reports a body identity for **`physicsRaycast` only**: `ShapeCastResult`
 * and `ShapeProximityResult` carry points and normals but no body (`index.d.ts` 11497, 11540), and
 * `shapeProximity`'s collector has capacity `1`, so it can never list more than one hit
 * (`lib/physics/havok-queries.js:7`). So:
 *
 * - `shapeCast` runs Lite's sweep for the geometry and resolves `entity` against the extension's own
 *   body-bounds index. It is exact about *where* the sweep hit and bounds-accurate about *what*.
 * - `overlap` is answered entirely from that index — the entities whose world bounds intersect the
 *   query shape's world bounds — because Lite cannot list overlaps at all.
 *
 * Both are documented as bounds-accurate rather than shape-accurate until an upstream API lands.
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
