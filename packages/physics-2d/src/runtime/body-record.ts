import type { CharacterController2D } from "../components/character-controller.js";
import type { Collider2D } from "../components/collider.js";
import type { Rigidbody2D } from "../components/rigidbody.js";
import type { BodyMotion2D, RapierBody, RapierCollider } from "../lite/rapier/world.js";
import type { Disconnect, Entity, Vec2 } from "@ignifx/core";

/**
 * One entity's 2D physics representation. The runtime keeps these in creation order, which is the
 * iteration order every per-step loop uses — body creation order is what decides Rapier's internal
 * ordering, so keeping it stable is part of determinism (`docs/architecture/09-physics.md` §8).
 *
 * @internal
 */
export interface BodyRecord2D {
  /** The entity the body belongs to. */
  readonly entity: Entity;
  /** The `Rigidbody2D`, or `null` for an implicit static body or a bare controller. */
  rigidbody: Rigidbody2D | null;
  /** The `CharacterController2D`, or `null`. */
  controller: CharacterController2D | null;
  /** The Rapier body. */
  body: RapierBody;
  /** Every Rapier collider the record owns, in creation order. */
  colliders: RapierCollider[];
  /** The ignifx collider each Rapier collider came from; `null` for the controller's own shape. */
  owners: (Collider2D | null)[];
  /** The controller's own collider, which is what `computeColliderMovement` moves. */
  controllerCollider: RapierCollider | null;
  /** How the body moves. */
  motion: BodyMotion2D;
  /** Whether the display pose is interpolated between fixed steps. */
  interpolate: boolean;
  /** The layer the filter word was built from, so a runtime change is noticed. */
  layer: number;
  /** Whether the record's colliders currently raise events. */
  collisionEvents: boolean;
  /** The position at the end of the previous fixed step. */
  readonly previousPosition: Vec2;
  /** The rotation in radians at the end of the previous fixed step. */
  previousRotation: number;
  /** The authoritative position at the end of the last fixed step. */
  readonly currentPosition: Vec2;
  /** The authoritative rotation in radians at the end of the last fixed step. */
  currentRotation: number;
  /**
   * The linear velocity as it was *before* the last step's solver ran, which is the impact speed a
   * collision callback wants — reading it afterwards reports the resolved velocity, which for a
   * landing body is zero.
   */
  readonly preStepVelocity: Vec2;
  /** `Transform.worldMatrixVersion` when an implicit static body was placed (`IGX-1151`). */
  staticVersion: number;
  /** Whether the `IGX-1151` diagnostic has already been reported for this body. */
  reportedMove: boolean;
  /** Signal connections the record owns, dropped when it is torn down. */
  disconnects: Disconnect[];
}
