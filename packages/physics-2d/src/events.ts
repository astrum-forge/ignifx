import type { Collider2D } from "./components/collider.js";
import type { Entity, Vec2Like } from "@ignifx/core";

/**
 * 2D physics uses the same five collision and trigger callback names as 3D, without a `2D` suffix.
 * Rapier supplies both collider identities. Payloads are pooled; copy values needed after a callback.
 */

/**
 * One contact point of a 2D collision. Pooled with its owning {@link Collision2D}.
 *
 * @public
 */
export interface ContactPoint2D {
  /** The world-space contact point, in metres. */
  readonly point: Vec2Like;
  /** The world-space contact normal, pointing away from the other collider. */
  readonly normal: Vec2Like;
  /** The magnitude of the impulse Rapier's solver applied; `0` for a contact that just ended. */
  readonly impulse: number;
}

/**
 * What a script's `onTriggerEnter`/`onTriggerExit` is handed in a 2D world.
 *
 * @example
 * ```ts
 * class Coin extends Script implements ScriptCallbacks {
 *   static typeId = "mygame/Coin";
 *   onTriggerEnter(trigger: TriggerEvent2D): void {
 *     if (trigger.other?.tags.has("player") === true) {
 *       this.entity.destroy();
 *     }
 *   }
 * }
 * ```
 *
 * @public
 */
export interface TriggerEvent2D {
  /** The entity that entered or left, or `null` when its body is already gone. */
  readonly other: Entity | null;
  /** The exact collider on the other entity — Rapier reports shape identity, unlike Havok. */
  readonly otherCollider: Collider2D | null;
  /** The entity whose script is being called. */
  readonly self: Entity;
  /** The collider on this entity that took part. */
  readonly selfCollider: Collider2D | null;
}

/**
 * What a script's `onCollisionEnter`/`onCollisionStay`/`onCollisionExit` is handed in a 2D world.
 *
 * @public
 */
export interface Collision2D {
  /** The entity that was hit, or `null` when its body is already gone. */
  readonly other: Entity | null;
  /** The exact collider on the other entity. */
  readonly otherCollider: Collider2D | null;
  /** The entity whose script is being called. */
  readonly self: Entity;
  /** The collider on this entity that took part. */
  readonly selfCollider: Collider2D | null;
  /** The contacts of this event. Pooled; valid only during the callback. */
  readonly contacts: readonly ContactPoint2D[];
  /** The relative velocity of the two bodies at the contact, in metres per second. */
  readonly relativeVelocity: Vec2Like;
}

/**
 * What `CharacterController2D.onCollided` reports: one obstacle the character hit this step.
 *
 * @public
 */
export interface CharacterCollision2D {
  /** The entity that was hit, or `null` when it is not an ignifx body. */
  readonly other: Entity | null;
  /** The collider that was hit, or `null`. */
  readonly otherCollider: Collider2D | null;
  /** The world-space contact point. */
  readonly point: Vec2Like;
  /** The world-space outward normal on the obstacle. */
  readonly normal: Vec2Like;
}
