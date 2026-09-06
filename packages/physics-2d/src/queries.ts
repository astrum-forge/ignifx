import type { Collider2D } from "./components/collider.js";
import type { Entity, LayerMask, Vec2Like } from "@ignifx/core";

/**
 * The query vocabulary of `app.physics2d` (`docs/architecture/11-2d-toolkit.md` §8,
 * `09-physics.md` §5).
 *
 * Unlike the 3D service, every 2D query is **shape-accurate and identity-carrying**: Rapier's
 * `castRayAndGetNormal`, `intersectionsWithShape`, and `castShape` all return the `Collider` that
 * was hit (`pipeline/world.d.ts`), so no bounds index is needed and the corrections `09-physics.md`
 * §5 records for 3D do not apply here.
 */

/**
 * Options every 2D query accepts.
 *
 * @public
 */
export interface QueryOptions2D {
  /** Which layers the query may hit. Defaults to everything. */
  readonly layerMask?: LayerMask;
  /** Whether trigger volumes count as hits. Defaults to `false`. */
  readonly hitTriggers?: boolean;
}

/**
 * What a 2D ray or shape query hit.
 *
 * @remarks
 * The object is freshly allocated per hit, so it is safe to keep. `raycastAll` returns a **reused**
 * array of freshly allocated hits.
 *
 * @public
 */
export interface RaycastHit2D {
  /** The entity that was hit. */
  readonly entity: Entity;
  /** The collider that was hit. */
  readonly collider: Collider2D | null;
  /** The world-space contact point, in metres. */
  readonly point: Vec2Like;
  /** The world-space surface normal. */
  readonly normal: Vec2Like;
  /** The distance from the ray origin, in metres. */
  readonly distance: number;
}

/**
 * What a 2D shape sweep hit.
 *
 * @public
 */
export interface ShapeCastHit2D {
  /** The entity the swept shape hit. */
  readonly entity: Entity;
  /** The collider it hit. */
  readonly collider: Collider2D | null;
  /** The world-space contact point on the hit collider. */
  readonly point: Vec2Like;
  /** The world-space contact normal. */
  readonly normal: Vec2Like;
  /** The distance travelled before contact, in metres. */
  readonly distance: number;
  /** How far along the sweep the contact occurs, in `[0, 1]`. */
  readonly fraction: number;
}
