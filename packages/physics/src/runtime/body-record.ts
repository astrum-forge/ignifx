import type { Collider } from "../components/collider.js";
import type { Rigidbody } from "../components/rigidbody.js";
import type { LitePhysicsBody, LitePhysicsShape, BodyMotion } from "../lite/havok.js";
import type { Disconnect, Entity, LiteSceneNode, Quat, Vec3 } from "@ignifx/core";

/**
 * One entity's physics representation. The runtime keeps these in creation order, which is the
 * iteration order every per-step loop uses — body creation order is what decides Havok's internal
 * ordering, so keeping it stable is part of determinism (`docs/architecture/09-physics.md` §8).
 *
 * @internal
 */
export interface BodyRecord {
  /** The entity the body belongs to. */
  readonly entity: Entity;
  /** The entity's Lite node; the body's pose is this node's **local** TRS. */
  readonly node: LiteSceneNode;
  /** The `Rigidbody`, or `null` for the implicit static body of a collider-only entity. */
  rigidbody: Rigidbody | null;
  /** The colliders that make up the body's shape, in component order. */
  colliders: Collider[];
  /** The Havok body. */
  body: LitePhysicsBody;
  /** Every shape the record owns, root last; released together when the body is torn down. */
  shapes: LitePhysicsShape[];
  /** How the body moves. */
  motion: BodyMotion;
  /** Whether the display pose is interpolated between fixed steps. */
  interpolate: boolean;
  /** The layer the filter masks were built from, so a runtime change is noticed. */
  layer: number;
  /** Whether collision events are currently enabled on the body. */
  collisionEvents: boolean;
  /** The pose at the end of the previous fixed step. */
  readonly previousPosition: Vec3;
  /** The rotation at the end of the previous fixed step. */
  readonly previousRotation: Quat;
  /** The authoritative pose at the end of the last fixed step. */
  readonly currentPosition: Vec3;
  /** The authoritative rotation at the end of the last fixed step. */
  readonly currentRotation: Quat;
  /** Half the world-space bounding box, used by `overlap` and `shapeCast` entity resolution. */
  readonly halfExtents: Vec3;
  /** `Transform.worldMatrixVersion` when an implicit static body was placed (`IGX-0901`). */
  staticVersion: number;
  /** Whether the `IGX-0901` diagnostic has already been reported for this body. */
  reportedMove: boolean;
  /** Signal connections the record owns, dropped when it is torn down. */
  disconnects: Disconnect[];
}
