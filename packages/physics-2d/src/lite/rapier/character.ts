import type { RapierCollider, RapierWorld } from "./world.js";
import type { KinematicCharacterController } from "@dimforge/rapier2d-compat";
import type { MutableVec2, Vec2Like } from "@ignifx/core";

/**
 * Rapier's kinematic character controller (`control/character_controller.d.ts`), wrapped so the
 * runtime never imports the backend.
 *
 * ## Facts measured against `@dimforge/rapier2d-compat@0.20.0` (spike S6.2)
 *
 * - **Slopes work as documented.** `setMaxSlopeClimbAngle(radians)` blocks a slope steeper than the
 *   limit and lets a shallower one through, and `setMinSlopeSlideAngle` decides when the character
 *   slides back down.
 * - **Snap-to-ground works.** Descending a 25° ramp at 4 m/s, `enableSnapToGround(0.5)` kept the
 *   character grounded on every one of 200 steps; without it, 66 of them were airborne.
 * - **One-way platforms are the `filterPredicate` of `computeColliderMovement`.** Returning `false`
 *   for a platform makes the character pass straight through it; the predicate is called once per
 *   candidate collider per step.
 * - **Autostep needs a box.** With a box character, `enableAutostep(0.35, …)` clears a 0.3 m step
 *   and refuses a 0.5 m one. With a capsule of radius 0.2 the same call clears 0.15 m but not
 *   0.2 m — a Rapier limitation, recorded in ADR-0006's validation section and in the skill.
 * - **The broadphase must exist first.** Before the world has stepped, `computeColliderMovement`
 *   sees no obstacles at all and reports the requested motion unchanged.
 *
 * @internal
 */
export type RapierController = KinematicCharacterController;

/** How a controller is configured, in ignifx units. */
export interface ControllerTuning2D {
  /** The steepest slope the character can walk up, in radians from "up". */
  readonly slopeLimit: number;
  /** The shallowest slope the character slides down, in radians from "up". */
  readonly slideLimit: number;
  /** The tallest step the character climbs automatically, in metres; `0` disables autostep. */
  readonly stepOffset: number;
  /** How much clear floor must follow a step, in metres. */
  readonly stepMinWidth: number;
  /** How far below the feet the ground is snapped to, in metres; `0` disables snapping. */
  readonly snapToGround: number;
  /** Whether the character pushes dynamic bodies out of the way. */
  readonly pushBodies: boolean;
}

/** One obstacle the character hit during a move. */
export interface ControllerHit2D {
  /** The collider that was hit, or `null` when Rapier no longer tracks it. */
  collider: RapierCollider | null;
  /** The world-space contact point. */
  readonly point: MutableVec2;
  /** The world-space outward normal on the obstacle. */
  readonly normal: MutableVec2;
}

/**
 * Creates a character controller.
 *
 * @param world - The world.
 * @param skinWidth - The gap Rapier keeps between the character and its surroundings, in metres.
 * @returns The controller.
 *
 * @internal
 */
export function createController(world: RapierWorld, skinWidth: number): RapierController {
  const controller = world.createCharacterController(skinWidth);
  // ignifx 2D is +Y up (ADR-0011); Rapier's default up in 2D is the same, but saying so keeps the
  // controller correct if a project ever flips the axis.
  controller.setUp({ x: 0, y: 1 });
  return controller;
}

/**
 * Releases a controller.
 *
 * @param world - The world.
 * @param controller - The controller.
 *
 * @internal
 */
export function destroyController(world: RapierWorld, controller: RapierController): void {
  world.removeCharacterController(controller);
}

/**
 * Applies the component's settings to a controller.
 *
 * @param controller - The controller.
 * @param tuning - The slope, step, snap, and pushing settings.
 *
 * @internal
 */
export function tuneController(controller: RapierController, tuning: ControllerTuning2D): void {
  controller.setMaxSlopeClimbAngle(tuning.slopeLimit);
  controller.setMinSlopeSlideAngle(tuning.slideLimit);
  controller.setApplyImpulsesToDynamicBodies(tuning.pushBodies);
  if (tuning.stepOffset > 0) {
    controller.enableAutostep(tuning.stepOffset, tuning.stepMinWidth, true);
  } else {
    controller.disableAutostep();
  }
  if (tuning.snapToGround > 0) {
    controller.enableSnapToGround(tuning.snapToGround);
  } else {
    controller.disableSnapToGround();
  }
}

/**
 * Sets the gap kept between the character and its surroundings.
 *
 * @param controller - The controller.
 * @param skinWidth - The gap in metres.
 *
 * @internal
 */
export function setControllerSkinWidth(controller: RapierController, skinWidth: number): void {
  controller.setOffset(skinWidth);
}

/**
 * Runs one collide-and-slide move.
 *
 * @param controller - The controller.
 * @param collider - The character's own collider.
 * @param desired - The displacement to attempt, in metres.
 * @param groups - The packed filter word obstacles must pass.
 * @param filter - An extra per-collider predicate — how one-way platforms are done — or `null`.
 * @param out - Receives the movement Rapier resolved.
 * @returns `true` when the character ended the move on walkable ground.
 *
 * @internal
 */
export function computeControllerMovement(
  controller: RapierController,
  collider: RapierCollider,
  desired: Vec2Like,
  groups: number,
  filter: ((collider: RapierCollider) => boolean) | null,
  out: MutableVec2,
): boolean {
  if (filter === null) {
    controller.computeColliderMovement(collider, { x: desired.x, y: desired.y }, undefined, groups);
  } else {
    controller.computeColliderMovement(collider, { x: desired.x, y: desired.y }, undefined, groups, filter);
  }
  controller.computedMovement(out);
  return controller.computedGrounded();
}

/**
 * How many obstacles the last move hit.
 *
 * @param controller - The controller.
 * @returns The count.
 *
 * @internal
 */
export function controllerHitCount(controller: RapierController): number {
  return controller.numComputedCollisions();
}

/**
 * Reads one obstacle of the last move.
 *
 * @param controller - The controller.
 * @param index - Which obstacle.
 * @param out - The record to write.
 * @returns `true` when the obstacle exists.
 *
 * @internal
 */
export function readControllerHit(controller: RapierController, index: number, out: ControllerHit2D): boolean {
  const hit = controller.computedCollision(index);
  if (hit === null) {
    return false;
  }
  out.collider = hit.collider;
  out.point.set(hit.witness1.x, hit.witness1.y);
  out.normal.set(hit.normal1.x, hit.normal1.y);
  return true;
}
