import {
  ActiveCollisionTypes,
  ActiveEvents,
  Ball,
  Capsule,
  CoefficientCombineRule,
  ColliderDesc,
  ConvexPolygon,
  Cuboid,
  EventQueue,
  Polyline,
  QueryFilterFlags,
  Ray,
  RigidBodyDesc,
  World,
} from "@dimforge/rapier2d-compat";
import type { Collider, RigidBody, Shape } from "@dimforge/rapier2d-compat";
import type { MutableVec2, Vec2Like } from "@ignifx/core";

/**
 * The Rapier 2D adapter (`docs/architecture/11-2d-toolkit.md` §8, ADR-0006). Everything the runtime
 * needs from `@dimforge/rapier2d-compat` is a function here, so the rest of `src/` never imports the
 * backend (`ignifx/no-lite-outside-adapter`, coding standards §4).
 *
 * ## Facts measured against `@dimforge/rapier2d-compat@0.20.0` (spike S6.2)
 *
 * - **The broadphase is only built by `World.step`.** Before the first step, `castRay` returns
 *   `null` and `KinematicCharacterController.computeColliderMovement` reports the full requested
 *   motion with no obstacles; a collider created after the last step is invisible until the next
 *   one. {@link primeWorld} runs a zero-length step, which builds the broadphase without
 *   integrating — but it is *not* free of side effects on a running simulation (a settled pile
 *   hashes differently), so the runtime primes only when the collider set changed.
 * - **`InteractionGroups` is one 32-bit number**: membership in the high 16 bits, filter in the low
 *   16 (`geometry/interaction_groups.d.ts`). Sixteen layers, not thirty-two.
 * - **`ActiveCollisionTypes.DEFAULT` excludes non-dynamic pairs**, so a kinematic character never
 *   reports entering a static sensor. Colliders that want events are given
 *   `ActiveCollisionTypes.ALL`.
 */

/**
 * Rapier's physics world.
 *
 * @internal
 */
export type RapierWorld = World;

/**
 * One Rapier rigid body.
 *
 * @internal
 */
export type RapierBody = RigidBody;

/**
 * One Rapier collider.
 *
 * @internal
 */
export type RapierCollider = Collider;

/**
 * Rapier's collision-event collector.
 *
 * @internal
 */
export type RapierEventQueue = EventQueue;

/**
 * How a body moves, in the three flavours ignifx exposes.
 *
 * @internal
 */
export const BodyMotion2D = {
  /** Simulated by the solver. */
  dynamic: "dynamic",
  /** Moved by the game, pushes dynamic bodies, ignores forces. */
  kinematic: "kinematic",
  /** Never moves. */
  static: "static",
} as const;

/**
 * The union of {@link BodyMotion2D}.
 *
 * @internal
 */
export type BodyMotion2D = (typeof BodyMotion2D)[keyof typeof BodyMotion2D];

/**
 * How two surfaces' friction or restitution coefficients are combined, mirroring Rapier's
 * `CoefficientCombineRule` (`dynamics/coefficient_combine_rule.d.ts`).
 *
 * @internal
 */
export const CombineRule2D = {
  /** The arithmetic mean; Rapier's default. */
  average: "average",
  /** The smaller of the two. */
  min: "min",
  /** The product. */
  multiply: "multiply",
  /** The larger of the two. */
  max: "max",
} as const;

/**
 * The union of {@link CombineRule2D}.
 *
 * @internal
 */
export type CombineRule2D = (typeof CombineRule2D)[keyof typeof CombineRule2D];

/**
 * A collision shape, described in metres in the body's local frame.
 *
 * @internal
 */
export type RapierShape2D =
  | { readonly kind: "box"; readonly halfWidth: number; readonly halfHeight: number }
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "capsule"; readonly halfHeight: number; readonly radius: number }
  | { readonly kind: "polygon"; readonly points: Float32Array }
  | { readonly kind: "polyline"; readonly points: Float32Array };

/** What {@link createCollider} needs beyond the geometry. */
export interface ColliderOptions2D {
  /** The shape's offset from the body origin, in metres. */
  readonly offset: Vec2Like;
  /** The shape's rotation about the body origin, in radians. */
  readonly rotation: number;
  /** Whether the shape reports overlaps instead of resolving contacts. */
  readonly sensor: boolean;
  /** The packed membership/filter word from {@link interactionGroups}. */
  readonly groups: number;
  /** The dynamic friction coefficient. */
  readonly friction: number;
  /** How much approach speed is returned, `0` to `1`. */
  readonly restitution: number;
  /** How two frictions are combined. */
  readonly frictionCombine: CombineRule2D;
  /** How two restitutions are combined. */
  readonly restitutionCombine: CombineRule2D;
  /** Whether this collider raises collision and intersection events. */
  readonly events: boolean;
}

/** What {@link createBody} needs. */
export interface BodyOptions2D {
  /** How the body moves. */
  readonly motion: BodyMotion2D;
  /** The world position in metres. */
  readonly position: Vec2Like;
  /** The world rotation in radians, counter-clockwise about +Z. */
  readonly rotation: number;
  /** Multiplies world gravity for this body. */
  readonly gravityScale: number;
  /** Linear damping per second. */
  readonly linearDamping: number;
  /** Angular damping per second. */
  readonly angularDamping: number;
  /** Whether rotation is locked. */
  readonly freezeRotation: boolean;
  /** Extra mass added on top of the colliders' own, in kilograms; `0` adds none. */
  readonly additionalMass: number;
  /** Whether the body starts asleep. */
  readonly startAsleep: boolean;
}

/** One drained collision or intersection event. */
export interface CollisionEvent2D {
  /** The first collider's handle. */
  readonly first: number;
  /** The second collider's handle. */
  readonly second: number;
  /** `true` for an enter, `false` for an exit. */
  readonly started: boolean;
}

/** One contact between two colliders, written into a caller-owned record. */
export interface ContactData2D {
  /** Whether the pair has at least one contact this step. */
  touching: boolean;
  /** The world-space contact point. */
  readonly point: MutableVec2;
  /** The world-space contact normal, pointing away from the first collider. */
  readonly normal: MutableVec2;
  /** The magnitude of the impulse the solver applied. */
  impulse: number;
}

/** What {@link castRay} writes. */
export interface RayResult2D {
  /** Whether anything was hit. */
  hit: boolean;
  /** The collider that was hit, or `null`. */
  collider: RapierCollider | null;
  /** The distance from the origin along the (normalised) direction. */
  distance: number;
}

/** What {@link castShape} writes. */
export interface ShapeCastResult2D {
  /** Whether anything was hit. */
  hit: boolean;
  /** The collider that was hit, or `null`. */
  collider: RapierCollider | null;
  /** The distance travelled before contact. */
  distance: number;
}

/** Radians per full turn, for the degree conversions the components use. */
const TAU = Math.PI * 2;

/** How wide one half of an `InteractionGroups` word is. */
const GROUP_BITS = 16;

/** Every bit of one half. */
const GROUP_MASK = 0xff_ff;

/**
 * The number of layers Rapier's 16-bit interaction groups can express
 * (`geometry/interaction_groups.d.ts`).
 *
 * @internal
 */
export const RAPIER_LAYER_LIMIT: number = GROUP_BITS;

/**
 * Packs a membership mask and a collide mask into Rapier's single `InteractionGroups` word.
 *
 * @param membership - Which layers the collider belongs to, in the low 16 bits.
 * @param filter - Which layers it may collide with, in the low 16 bits.
 * @returns The packed word.
 *
 * @internal
 */
export function interactionGroups(membership: number, filter: number): number {
  return ((membership & GROUP_MASK) << GROUP_BITS) | (filter & GROUP_MASK);
}

/**
 * Creates the physics world.
 *
 * @param gravity - The acceleration in metres per second squared.
 * @returns The world.
 *
 * @internal
 */
export function createWorld(gravity: Vec2Like): RapierWorld {
  return new World({ x: gravity.x, y: gravity.y });
}

/**
 * Releases the world and every WebAssembly object it owns.
 *
 * @param world - The world.
 *
 * @internal
 */
export function destroyWorld(world: RapierWorld): void {
  world.free();
}

/**
 * Replaces world gravity.
 *
 * @param world - The world.
 * @param gravity - The new acceleration.
 *
 * @internal
 */
export function setGravity(world: RapierWorld, gravity: Vec2Like): void {
  world.gravity.x = gravity.x;
  world.gravity.y = gravity.y;
}

/**
 * Sets the length of the next step.
 *
 * @param world - The world.
 * @param seconds - The fixed step in seconds.
 *
 * @internal
 */
export function setTimestep(world: RapierWorld, seconds: number): void {
  world.timestep = seconds;
}

/**
 * Sets how many iterations the constraint solver runs.
 *
 * @param world - The world.
 * @param iterations - The iteration count; Rapier's default is 4.
 *
 * @internal
 */
export function setSolverIterations(world: RapierWorld, iterations: number): void {
  world.numSolverIterations = iterations;
}

/**
 * Advances the simulation by one timestep, collecting events.
 *
 * @param world - The world.
 * @param queue - The event collector.
 *
 * @internal
 */
export function stepWorld(world: RapierWorld, queue: RapierEventQueue): void {
  world.step(queue);
}

/**
 * Rebuilds the broadphase without advancing time, by running a zero-length step.
 *
 * @remarks
 * Rapier only refreshes its acceleration structure inside `World.step`, so a collider created since
 * the last step is invisible to queries and to the character controller (S6.2). The queue is passed
 * so an enter event raised by the priming step is still delivered.
 *
 * @param world - The world.
 * @param queue - The event collector.
 *
 * @internal
 */
export function primeWorld(world: RapierWorld, queue: RapierEventQueue): void {
  const timestep = world.timestep;
  world.timestep = 0;
  world.step(queue);
  world.timestep = timestep;
}

/**
 * Creates the event collector.
 *
 * @remarks
 * `autoDrain: false` — the collector must survive both the priming step and the real step of one
 * fixed update, and the runtime drains it once at the end of that update.
 *
 * @returns The queue.
 *
 * @internal
 */
export function createEventQueue(): RapierEventQueue {
  return new EventQueue(false);
}

/**
 * Releases the event collector.
 *
 * @param queue - The queue.
 *
 * @internal
 */
export function destroyEventQueue(queue: RapierEventQueue): void {
  queue.free();
}

/**
 * Hands every buffered collision and intersection event to a sink and clears the buffer.
 *
 * @param queue - The queue.
 * @param sink - Called once per event with the two collider handles and the enter/exit flag.
 *
 * @internal
 */
export function drainCollisions(queue: RapierEventQueue, sink: (event: CollisionEvent2D) => void): void {
  queue.drainCollisionEvents((first: number, second: number, started: boolean): void => {
    sink({ first, second, started });
  });
}

/**
 * Creates a rigid body.
 *
 * @param world - The world.
 * @param options - Motion, pose, damping, gravity scale, and mass.
 * @returns The body.
 *
 * @internal
 */
export function createBody(world: RapierWorld, options: BodyOptions2D): RapierBody {
  const description = descriptionFor(options.motion)
    .setTranslation(options.position.x, options.position.y)
    .setRotation(options.rotation)
    .setGravityScale(options.gravityScale)
    .setLinearDamping(options.linearDamping)
    .setAngularDamping(options.angularDamping)
    .setSleeping(options.startAsleep);
  if (options.freezeRotation) {
    description.lockRotations();
  }
  if (options.additionalMass > 0) {
    description.setAdditionalMass(options.additionalMass);
  }
  return world.createRigidBody(description);
}

/**
 * Removes a body and every collider attached to it.
 *
 * @param world - The world.
 * @param body - The body.
 *
 * @internal
 */
export function destroyBody(world: RapierWorld, body: RapierBody): void {
  world.removeRigidBody(body);
}

/**
 * Reads a body's world pose without allocating.
 *
 * @param body - The body.
 * @param out - The vector the translation is written into.
 * @returns The rotation in radians.
 *
 * @internal
 */
export function readBodyPose(body: RapierBody, out: MutableVec2): number {
  body.translation(out);
  return body.rotation();
}

/**
 * Moves a body immediately, as a teleport.
 *
 * @param body - The body.
 * @param position - The new world position.
 * @param rotation - The new rotation in radians.
 *
 * @internal
 */
export function setBodyPose(body: RapierBody, position: Vec2Like, rotation: number): void {
  body.setTranslation({ x: position.x, y: position.y }, true);
  body.setRotation(rotation, true);
}

/**
 * Asks Rapier to interpolate a kinematic body to a pose over the next step, which is what makes it
 * push dynamic bodies instead of tunnelling through them.
 *
 * @param body - The body.
 * @param position - The pose to reach.
 * @param rotation - The rotation to reach, in radians.
 *
 * @internal
 */
export function setNextKinematicPose(body: RapierBody, position: Vec2Like, rotation: number): void {
  body.setNextKinematicTranslation({ x: position.x, y: position.y });
  body.setNextKinematicRotation(rotation);
}

/**
 * Reads a body's linear velocity without allocating.
 *
 * @param body - The body.
 * @param out - The vector to write.
 *
 * @internal
 */
export function readLinearVelocity(body: RapierBody, out: MutableVec2): void {
  body.linvel(out);
}

/**
 * Replaces a body's linear velocity.
 *
 * @param body - The body.
 * @param velocity - Metres per second.
 *
 * @internal
 */
export function writeLinearVelocity(body: RapierBody, velocity: Vec2Like): void {
  body.setLinvel({ x: velocity.x, y: velocity.y }, true);
}

/**
 * Reads a body's angular velocity.
 *
 * @param body - The body.
 * @returns Radians per second, counter-clockwise.
 *
 * @internal
 */
export function readAngularVelocity(body: RapierBody): number {
  return body.angvel();
}

/**
 * Replaces a body's angular velocity.
 *
 * @param body - The body.
 * @param velocity - Radians per second.
 *
 * @internal
 */
export function writeAngularVelocity(body: RapierBody, velocity: number): void {
  body.setAngvel(velocity, true);
}

/**
 * Adds a force that lasts for one step.
 *
 * @param body - The body.
 * @param force - Newtons.
 * @param point - Where to apply it, or `null` for the centre of mass.
 *
 * @internal
 */
export function addForce(body: RapierBody, force: Vec2Like, point: Vec2Like | null): void {
  if (point === null) {
    body.addForce({ x: force.x, y: force.y }, true);
    return;
  }
  body.addForceAtPoint({ x: force.x, y: force.y }, { x: point.x, y: point.y }, true);
}

/**
 * Applies an instantaneous impulse.
 *
 * @param body - The body.
 * @param impulse - Newton-seconds.
 * @param point - Where to apply it, or `null` for the centre of mass.
 *
 * @internal
 */
export function applyImpulse(body: RapierBody, impulse: Vec2Like, point: Vec2Like | null): void {
  if (point === null) {
    body.applyImpulse({ x: impulse.x, y: impulse.y }, true);
    return;
  }
  body.applyImpulseAtPoint({ x: impulse.x, y: impulse.y }, { x: point.x, y: point.y }, true);
}

/**
 * Adds a torque that lasts for one step.
 *
 * @param body - The body.
 * @param torque - Newton-metres, positive counter-clockwise.
 *
 * @internal
 */
export function addTorque(body: RapierBody, torque: number): void {
  body.addTorque(torque, true);
}

/**
 * Whether a body is asleep, which is what `activeBodies` counts the complement of.
 *
 * @param body - The body.
 * @returns `true` when Rapier has put it to sleep.
 *
 * @internal
 */
export function isBodySleeping(body: RapierBody): boolean {
  return body.isSleeping();
}

/**
 * The mass Rapier computed for a body from its colliders and any additional mass.
 *
 * @param body - The body.
 * @returns Kilograms.
 *
 * @internal
 */
export function bodyMass(body: RapierBody): number {
  return body.mass();
}

/**
 * Sets how many kilograms a square metre of a collider weighs. Rapier derives the body's mass and
 * angular inertia from this and the collider's area.
 *
 * @param collider - The collider.
 * @param density - Kilograms per square metre.
 *
 * @internal
 */
export function setColliderDensity(collider: RapierCollider, density: number): void {
  collider.setDensity(density);
}

/**
 * Recomputes a body's mass and inertia from its colliders, after their densities changed.
 *
 * @param body - The body.
 *
 * @internal
 */
export function recomputeMass(body: RapierBody): void {
  body.recomputeMassPropertiesFromColliders();
}

/**
 * Creates a collider and attaches it to a body.
 *
 * @param world - The world.
 * @param body - The body it belongs to.
 * @param shape - The geometry, in body-local metres.
 * @param options - Offset, sensor flag, filter word, surface, and event flags.
 * @returns The collider, or `null` when Rapier refuses the geometry — a convex hull of collinear or
 * duplicated points, say, which throws inside its WebAssembly rather than returning nothing.
 *
 * @internal
 */
export function createCollider(
  world: RapierWorld,
  body: RapierBody,
  shape: RapierShape2D,
  options: ColliderOptions2D,
): RapierCollider | null {
  const description = describeShape(shape);
  if (description === null) {
    return null;
  }
  description
    .setTranslation(options.offset.x, options.offset.y)
    .setRotation(options.rotation)
    .setSensor(options.sensor)
    .setCollisionGroups(options.groups)
    .setFriction(options.friction)
    .setRestitution(options.restitution)
    .setFrictionCombineRule(combineRule(options.frictionCombine))
    .setRestitutionCombineRule(combineRule(options.restitutionCombine));
  if (options.events) {
    description
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
      // `DEFAULT` covers dynamic-versus-anything only, so a kinematic character would never report
      // entering a static sensor (measured, S6.2).
      .setActiveCollisionTypes(ActiveCollisionTypes.ALL);
  }
  try {
    return world.createCollider(description, body);
  } catch {
    // A degenerate hull — collinear or duplicate points — throws inside Rapier's WebAssembly rather
    // than returning `null` from `ColliderDesc.convexHull`, so the refusal is caught here and
    // reported as `IGX-1156` by the caller.
    return null;
  }
}

/**
 * Turns a collider's collision and intersection events on or off without rebuilding it.
 *
 * @param collider - The collider.
 * @param enabled - Whether it reports events.
 *
 * @internal
 */
export function setColliderEvents(collider: RapierCollider, enabled: boolean): void {
  collider.setActiveEvents(enabled ? ActiveEvents.COLLISION_EVENTS : ActiveEvents.NONE);
  collider.setActiveCollisionTypes(enabled ? ActiveCollisionTypes.ALL : ActiveCollisionTypes.DEFAULT);
}

/**
 * Reads a collider's world position without allocating.
 *
 * @param collider - The collider.
 * @param out - The vector to write.
 *
 * @internal
 */
export function readColliderTranslation(collider: RapierCollider, out: MutableVec2): void {
  collider.translation(out);
}

/**
 * Replaces a collider's filter word after a layer change.
 *
 * @param collider - The collider.
 * @param groups - The packed membership/filter word.
 *
 * @internal
 */
export function setColliderGroups(collider: RapierCollider, groups: number): void {
  collider.setCollisionGroups(groups);
}

/**
 * Removes one collider.
 *
 * @param world - The world.
 * @param collider - The collider.
 *
 * @internal
 */
export function destroyCollider(world: RapierWorld, collider: RapierCollider): void {
  world.removeCollider(collider, true);
}

/**
 * The stable integer Rapier identifies a collider by, which is what its event queue reports.
 *
 * @param collider - The collider.
 * @returns The handle.
 *
 * @internal
 */
export function colliderHandle(collider: RapierCollider): number {
  return collider.handle;
}

/**
 * Whether a collider is a sensor, which is how a trigger event is told from a contact.
 *
 * @param collider - The collider.
 * @returns `true` for a sensor.
 *
 * @internal
 */
export function isColliderSensor(collider: RapierCollider): boolean {
  return collider.isSensor();
}

/**
 * Reads the first contact of a collider pair.
 *
 * @param world - The world.
 * @param first - One collider.
 * @param second - The other.
 * @param out - The record to write.
 *
 * @internal
 */
export function readContact(
  world: RapierWorld,
  first: RapierCollider,
  second: RapierCollider,
  out: ContactData2D,
): void {
  out.touching = false;
  out.impulse = 0;
  world.contactPair(first, second, (manifold, flipped: boolean): void => {
    const normal = manifold.normal();
    const sign = flipped ? -1 : 1;
    out.normal.set(normal.x * sign, normal.y * sign);
    const point = manifold.numSolverContacts() > 0 ? manifold.solverContactPoint(0) : null;
    if (point !== null) {
      out.point.set(point.x, point.y);
    }
    out.impulse = manifold.numContacts() > 0 ? manifold.contactImpulse(0) : 0;
    out.touching = true;
  });
}

/**
 * Casts a ray and writes the nearest hit.
 *
 * @param world - The world.
 * @param origin - The world-space origin.
 * @param direction - A unit direction.
 * @param maxDistance - How far to travel.
 * @param groups - The packed filter word.
 * @param hitSensors - Whether sensors count.
 * @param outPoint - Receives the contact point.
 * @param outNormal - Receives the contact normal.
 * @param out - Receives the hit flag, collider, and distance.
 *
 * @internal
 */
export function castRay(
  world: RapierWorld,
  origin: Vec2Like,
  direction: Vec2Like,
  maxDistance: number,
  groups: number,
  hitSensors: boolean,
  outPoint: MutableVec2,
  outNormal: MutableVec2,
  out: RayResult2D,
): void {
  out.hit = false;
  out.collider = null;
  out.distance = 0;
  const ray = new Ray({ x: origin.x, y: origin.y }, { x: direction.x, y: direction.y });
  const hit = world.castRayAndGetNormal(ray, maxDistance, true, sensorFlags(hitSensors), groups);
  if (hit === null) {
    return;
  }
  out.hit = true;
  out.collider = hit.collider;
  out.distance = hit.timeOfImpact;
  outPoint.set(origin.x + direction.x * hit.timeOfImpact, origin.y + direction.y * hit.timeOfImpact);
  outNormal.set(hit.normal.x, hit.normal.y);
}

/**
 * Casts a ray and hands every hit to a sink, nearest first is **not** guaranteed — the caller sorts.
 *
 * @param world - The world.
 * @param origin - The world-space origin.
 * @param direction - A unit direction.
 * @param maxDistance - How far to travel.
 * @param groups - The packed filter word.
 * @param hitSensors - Whether sensors count.
 * @param sink - Called once per hit with the collider, distance, and normal.
 *
 * @internal
 */
export function castRayAll(
  world: RapierWorld,
  origin: Vec2Like,
  direction: Vec2Like,
  maxDistance: number,
  groups: number,
  hitSensors: boolean,
  sink: (collider: RapierCollider, distance: number, normalX: number, normalY: number) => void,
): void {
  const ray = new Ray({ x: origin.x, y: origin.y }, { x: direction.x, y: direction.y });
  world.intersectionsWithRay(
    ray,
    maxDistance,
    true,
    (intersection): boolean => {
      sink(intersection.collider, intersection.timeOfImpact, intersection.normal.x, intersection.normal.y);
      return true;
    },
    sensorFlags(hitSensors),
    groups,
  );
}

/**
 * Lists every collider a positioned shape overlaps.
 *
 * @param world - The world.
 * @param shape - The query geometry.
 * @param position - Its world position.
 * @param rotation - Its world rotation in radians.
 * @param groups - The packed filter word.
 * @param hitSensors - Whether sensors count.
 * @param sink - Called once per overlapping collider.
 *
 * @internal
 */
export function overlapShape(
  world: RapierWorld,
  shape: RapierShape2D,
  position: Vec2Like,
  rotation: number,
  groups: number,
  hitSensors: boolean,
  sink: (collider: RapierCollider) => void,
): void {
  const built = buildShape(shape);
  if (built === null) {
    return;
  }
  world.intersectionsWithShape(
    { x: position.x, y: position.y },
    rotation,
    built,
    (collider): boolean => {
      sink(collider);
      return true;
    },
    sensorFlags(hitSensors),
    groups,
  );
}

/**
 * Sweeps a shape and writes the first contact.
 *
 * @param world - The world.
 * @param shape - The query geometry.
 * @param position - Where the sweep starts.
 * @param rotation - The shape's rotation in radians.
 * @param direction - A unit sweep direction.
 * @param maxDistance - How far to sweep.
 * @param groups - The packed filter word.
 * @param hitSensors - Whether sensors count.
 * @param outPoint - Receives the contact point.
 * @param outNormal - Receives the contact normal.
 * @param out - Receives the hit flag, collider, and distance.
 *
 * @internal
 */
export function castShape(
  world: RapierWorld,
  shape: RapierShape2D,
  position: Vec2Like,
  rotation: number,
  direction: Vec2Like,
  maxDistance: number,
  groups: number,
  hitSensors: boolean,
  outPoint: MutableVec2,
  outNormal: MutableVec2,
  out: ShapeCastResult2D,
): void {
  out.hit = false;
  out.collider = null;
  out.distance = 0;
  const built = buildShape(shape);
  if (built === null) {
    return;
  }
  const hit = world.castShape(
    { x: position.x, y: position.y },
    rotation,
    { x: direction.x, y: direction.y },
    built,
    0,
    maxDistance,
    true,
    sensorFlags(hitSensors),
    groups,
  );
  if (hit === null) {
    return;
  }
  out.hit = true;
  out.collider = hit.collider;
  out.distance = hit.time_of_impact;
  // `witness1` and `normal1` are expressed in the **swept shape's** local frame (`geometry/toi.d.ts`),
  // so they are rotated by the query rotation and offset by where the shape stood at impact.
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const originX = position.x + direction.x * hit.time_of_impact;
  const originY = position.y + direction.y * hit.time_of_impact;
  outPoint.set(
    originX + hit.witness1.x * cos - hit.witness1.y * sin,
    originY + hit.witness1.x * sin + hit.witness1.y * cos,
  );
  outNormal.set(hit.normal1.x * cos - hit.normal1.y * sin, hit.normal1.x * sin + hit.normal1.y * cos);
}

/**
 * Turns degrees counter-clockwise into the radians Rapier stores.
 *
 * @param degrees - The angle in degrees.
 * @returns The angle in radians.
 *
 * @internal
 */
export function toRadians(degrees: number): number {
  return (degrees * TAU) / 360;
}

/**
 * Turns Rapier's radians into the degrees `Transform.rotation2D` uses.
 *
 * @param radians - The angle in radians.
 * @returns The angle in degrees.
 *
 * @internal
 */
export function toDegrees(radians: number): number {
  return (radians * 360) / TAU;
}

/**
 * Builds the Rapier `Shape` a description stands for, for the query paths.
 *
 * @param shape - The description.
 * @returns The shape, or `null` when the geometry is degenerate.
 */
function buildShape(shape: RapierShape2D): Shape | null {
  if (shape.kind === "box") {
    return new Cuboid(shape.halfWidth, shape.halfHeight);
  }
  if (shape.kind === "circle") {
    return new Ball(shape.radius);
  }
  if (shape.kind === "capsule") {
    return new Capsule(shape.halfHeight, shape.radius);
  }
  if (shape.kind === "polyline") {
    return new Polyline(shape.points);
  }
  return new ConvexPolygon(shape.points, false);
}

/**
 * Builds the collider description a shape stands for.
 *
 * @param shape - The description.
 * @returns The description, or `null` when Rapier refuses the geometry.
 */
function describeShape(shape: RapierShape2D): ColliderDesc | null {
  if (shape.kind === "box") {
    return ColliderDesc.cuboid(shape.halfWidth, shape.halfHeight);
  }
  if (shape.kind === "circle") {
    return ColliderDesc.ball(shape.radius);
  }
  if (shape.kind === "capsule") {
    return ColliderDesc.capsule(shape.halfHeight, shape.radius);
  }
  if (shape.kind === "polyline") {
    return ColliderDesc.polyline(shape.points);
  }
  return ColliderDesc.convexHull(shape.points);
}

/**
 * The body description a motion type starts from.
 *
 * @param motion - The motion type.
 * @returns A fresh description.
 */
function descriptionFor(motion: BodyMotion2D): RigidBodyDesc {
  if (motion === BodyMotion2D.dynamic) {
    return RigidBodyDesc.dynamic();
  }
  // Position-based rather than velocity-based: ignifx moves kinematic bodies by writing a
  // transform, and `setNextKinematicTranslation` is what turns that into a swept motion.
  return motion === BodyMotion2D.kinematic ? RigidBodyDesc.kinematicPositionBased() : RigidBodyDesc.fixed();
}

/**
 * Rapier's combine rule for one of ours.
 *
 * @param rule - The ignifx name.
 * @returns Rapier's value.
 */
function combineRule(rule: CombineRule2D): CoefficientCombineRule {
  if (rule === CombineRule2D.min) {
    return CoefficientCombineRule.Min;
  }
  if (rule === CombineRule2D.multiply) {
    return CoefficientCombineRule.Multiply;
  }
  return rule === CombineRule2D.max ? CoefficientCombineRule.Max : CoefficientCombineRule.Average;
}

/**
 * The query filter flags that express "sensors count" or "sensors do not".
 *
 * @param hitSensors - Whether sensors count.
 * @returns The flags.
 */
function sensorFlags(hitSensors: boolean): QueryFilterFlags | undefined {
  return hitSensors ? undefined : QueryFilterFlags.EXCLUDE_SENSORS;
}
