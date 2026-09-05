import type { Collider } from "./components/collider.js";
import type { Entity, Vec3Like } from "@ignifx/core";

/**
 * The payloads `onTriggerEnter`/`onTriggerExit` and `onCollisionEnter`/`Stay`/`Exit` receive
 * (`docs/architecture/09-physics.md` §4).
 *
 * Both objects are **pooled**: the same instances are reused for every event of a step, so a script
 * that needs a value after its callback returns must copy it out. That is what makes event dispatch
 * allocation-free on the steady path (coding standards §7).
 */

/**
 * One contact point of a collision. Pooled with its owning {@link Collision}.
 *
 * @public
 */
export interface ContactPoint {
  /** The world-space contact point. */
  readonly point: Vec3Like;
  /** The world-space contact normal. */
  readonly normal: Vec3Like;
  /** The magnitude of the impulse Havok applied to resolve it; `0` for a contact that just ended. */
  readonly impulse: number;
}

/**
 * What a script's `onTriggerEnter`/`onTriggerExit` is handed.
 *
 * @example
 * ```ts
 * class Pickup extends Script implements ScriptCallbacks {
 *   static typeId = "mygame/Pickup";
 *   onTriggerEnter(trigger: TriggerEvent): void {
 *     if (trigger.other?.tags.has("player") === true) {
 *       this.entity.destroy();
 *     }
 *   }
 * }
 * ```
 *
 * @public
 */
export interface TriggerEvent {
  /** The entity that entered or left, or `null` when Havok no longer tracks its body. */
  readonly other: Entity | null;
  /** The other entity's first collider, or `null`. Lite reports no shape identity (§4). */
  readonly otherCollider: Collider | null;
  /** The entity whose script is being called. */
  readonly self: Entity;
}

/**
 * What a script's `onCollisionEnter`/`onCollisionStay`/`onCollisionExit` is handed.
 *
 * @remarks
 * `other` is `null` under the default `collisionIdentities: "upstream"` mode, because
 * `@babylonjs/lite@1.27.0` reports collisions without body identities (§4, ADR-0013). Register
 * `physics({ collisionIdentities: "internal" })` to opt into the waived drain that recovers them.
 *
 * @public
 */
export interface Collision {
  /** The entity that was hit, or `null` when the identity is unavailable. */
  readonly other: Entity | null;
  /** The other entity's first collider, or `null`. */
  readonly otherCollider: Collider | null;
  /** The entity whose script is being called. */
  readonly self: Entity;
  /** The contacts of this event. Pooled; valid only during the callback. */
  readonly contacts: readonly ContactPoint[];
  /** The relative velocity at the contact, or `null` when a body identity is unavailable. */
  readonly relativeVelocity: Vec3Like | null;
}

/**
 * What `CharacterController.onCollided` reports: one dynamic body the character pushed this step.
 *
 * @public
 */
export interface CharacterCollision {
  /** The entity that was pushed, or `null` when it is not an ignifx body. */
  readonly other: Entity | null;
  /** The world-space impulse the character applied. */
  readonly impulse: Vec3Like;
  /** Where the impulse was applied. */
  readonly point: Vec3Like;
}
