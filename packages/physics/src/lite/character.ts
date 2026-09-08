import { createPhysicsCharacterController } from "@babylonjs/lite";
import type { LitePhysicsBody, LitePhysicsWorld } from "./havok.js";
import type { PhysicsCharacterController } from "@babylonjs/lite";
import type { LiteSceneNode, MutableVec3, Vec3Like } from "@ignifx/core";

/**
 * The character-controller half of this package's Babylon Lite adapter
 * (`docs/architecture/09-physics.md` §2.3).
 *
 * Verified against `@babylonjs/lite@1.27.0`: `createPhysicsCharacterController` (`index.d.ts` 2887)
 * builds a kinematic capsule with collide-and-slide; the class (8300) exposes `keepDistance`,
 * `maxSlopeCosine`, `characterStrength`, `moveWithCollisions` (8389), `integrate` (8398),
 * `checkSupport` (8404), `getPosition`/`setPosition`, `getVelocity`/`setVelocity`,
 * `setShapeOptions` (8379) and `onTriggerCollisionObservable` (8332). Its options carry only
 * `capsuleHeight` and `capsuleRadius` (8447) — there is no centre offset, so the component applies
 * its own `center` when it writes the entity transform.
 *
 * Everything here is `@internal`.
 */

/**
 * Lite's character controller handle.
 *
 * @internal
 */
export type LiteCharacterController = PhysicsCharacterController;

/**
 * How the character is supported by whatever is under it; Lite's `CharacterSupportedState` (1615).
 *
 * @internal
 */
export const SupportState = {
  /** Nothing within reach. */
  unsupported: 0,
  /** Touching a surface too steep to stand on. */
  sliding: 1,
  /** Standing on a walkable surface. */
  supported: 2,
} as const;

/**
 * The union of {@link SupportState} values.
 *
 * @internal
 */
export type SupportState = (typeof SupportState)[keyof typeof SupportState];

/** What one dynamic body the character pushed looks like. */
export interface CharacterPush {
  /** The node of the body that was pushed. */
  readonly node: LiteSceneNode;
  /** The world-space impulse the character applied. */
  readonly impulse: Vec3Like;
  /** Where the impulse was applied. */
  readonly point: Vec3Like;
}

/**
 * Creates a controller.
 *
 * @param world - The Havok world.
 * @param position - The starting world position of the capsule centre.
 * @param height - Total capsule height, tip to tip.
 * @param radius - Capsule radius.
 * @returns The controller.
 *
 * @internal
 */
export function createController(
  world: LitePhysicsWorld,
  position: Vec3Like,
  height: number,
  radius: number,
): LiteCharacterController {
  return createPhysicsCharacterController(
    world,
    { x: position.x, y: position.y, z: position.z },
    { capsuleHeight: height, capsuleRadius: radius },
  );
}

/**
 * Applies the tuning fields `CharacterController` exposes.
 *
 * @param controller - The controller.
 * @param slopeCosine - The cosine of the steepest walkable slope.
 * @param skinWidth - The separation kept from surfaces, in metres.
 * @param strength - The push strength applied to dynamic bodies.
 *
 * @internal
 */
export function tuneController(
  controller: LiteCharacterController,
  slopeCosine: number,
  skinWidth: number,
  strength: number,
): void {
  controller.maxSlopeCosine = slopeCosine;
  controller.keepDistance = skinWidth;
  controller.characterStrength = strength;
}

/**
 * Rebuilds the capsule without losing the controller's position, velocity, or subscriptions.
 *
 * @param controller - The controller.
 * @param height - The new total height.
 * @param radius - The new radius.
 * @param preserveFeet - Whether the foot position stays fixed as the height changes.
 *
 * @internal
 */
export function resizeController(
  controller: LiteCharacterController,
  height: number,
  radius: number,
  preserveFeet: boolean,
): void {
  controller.setShapeOptions({ capsuleHeight: height, capsuleRadius: radius }, preserveFeet);
}

/**
 * Moves the character by a displacement, sliding along whatever it meets.
 *
 * @param controller - The controller.
 * @param displacement - The requested world-space displacement for this step.
 *
 * @internal
 */
export function moveController(controller: LiteCharacterController, displacement: Vec3Like): void {
  controller.moveWithCollisions({ x: displacement.x, y: displacement.y, z: displacement.z });
}

/**
 * Probes the surface under the character without moving it.
 *
 * @param controller - The controller.
 * @param deltaSeconds - The fixed step.
 * @param gravity - The probe direction, normally gravity.
 * @param groundNormal - Written with the averaged supporting normal.
 * @returns The support classification.
 *
 * @internal
 */
export function probeSupport(
  controller: LiteCharacterController,
  deltaSeconds: number,
  gravity: Vec3Like,
  groundNormal: MutableVec3,
): SupportState {
  const surface = controller.checkSupport(deltaSeconds, { x: gravity.x, y: gravity.y, z: gravity.z });
  const normal = surface.averageSurfaceNormal;
  groundNormal.set(normal.x, normal.y, normal.z);
  return toSupportState(surface.supportedState);
}

/**
 * The Havok body a controller's capsule is, which is what a query names to sweep *past* the
 * character rather than into it (`ShapeCastOptions.ignore`).
 *
 * @param controller - The controller.
 * @returns Its body handle.
 *
 * @internal
 */
export function controllerBody(controller: LiteCharacterController): LitePhysicsBody {
  return controller.getBody();
}

/**
 * Reads the controller's resolved position.
 *
 * @param controller - The controller.
 * @param out - The vector to write.
 *
 * @internal
 */
export function readControllerPosition(controller: LiteCharacterController, out: MutableVec3): void {
  const position = controller.getPosition();
  out.set(position.x, position.y, position.z);
}

/**
 * Teleports the controller, clearing any swept motion.
 *
 * @param controller - The controller.
 * @param position - The new world position.
 *
 * @internal
 */
export function writeControllerPosition(controller: LiteCharacterController, position: Vec3Like): void {
  controller.setPosition({ x: position.x, y: position.y, z: position.z });
}

/**
 * Reads the controller's velocity.
 *
 * @param controller - The controller.
 * @param out - The vector to write.
 *
 * @internal
 */
export function readControllerVelocity(controller: LiteCharacterController, out: MutableVec3): void {
  const velocity = controller.getVelocity();
  out.set(velocity.x, velocity.y, velocity.z);
}

/**
 * Sets the controller's velocity.
 *
 * @param controller - The controller.
 * @param velocity - The new world-space velocity.
 *
 * @internal
 */
export function writeControllerVelocity(controller: LiteCharacterController, velocity: Vec3Like): void {
  controller.setVelocity({ x: velocity.x, y: velocity.y, z: velocity.z });
}

/**
 * Subscribes to the dynamic bodies the character pushes.
 *
 * @param controller - The controller.
 * @param sink - Called once per pushed body, during the step.
 * @returns A disposer that removes the subscription.
 *
 * @internal
 */
export function onControllerPush(controller: LiteCharacterController, sink: (push: CharacterPush) => void): () => void {
  return controller.onTriggerCollisionObservable.add((event): void => {
    sink({ node: event.collider.node, impulse: event.impulse, point: event.impulsePosition });
  });
}

/**
 * Releases the controller's body, shape, and query collectors.
 *
 * @param controller - The controller.
 *
 * @internal
 */
export function disposeController(controller: LiteCharacterController): void {
  controller.dispose();
}

/**
 * Narrows Lite's support enum to {@link SupportState}.
 *
 * @param value - Lite's value.
 * @returns The matching state, defaulting to `unsupported`.
 */
function toSupportState(value: number): SupportState {
  if (value === SupportState.supported) {
    return SupportState.supported;
  }
  return value === SupportState.sliding ? SupportState.sliding : SupportState.unsupported;
}
