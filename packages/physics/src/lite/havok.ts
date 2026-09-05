import {
  addPhysicsShapeChild,
  applyPhysicsBodyForce,
  applyPhysicsBodyImpulse,
  createHavokWorld,
  createHeightFieldShape,
  createNullEngine,
  createPhysicsBody,
  createPhysicsShape,
  createSceneContext,
  disposePhysics,
  disposeScene,
  getPhysicsBodyAngularVelocity,
  getPhysicsBodyLinearVelocity,
  lockPhysicsBodyRotationAxes,
  onPhysicsAfterStep,
  onPhysicsCollision,
  onPhysicsTriggerBodies,
  releasePhysicsShape,
  removePhysicsBody,
  setPhysicsBodyAngularVelocity,
  setPhysicsBodyCollisionEventsEnabled,
  setPhysicsBodyLinearVelocity,
  setPhysicsBodyMass,
  setPhysicsBodyPrestepType,
  setPhysicsBodyShape,
  setPhysicsBodyTransform,
  setPhysicsGravity,
  setPhysicsShapeFilterCollideMask,
  setPhysicsShapeFilterMembershipMask,
  setPhysicsShapeIsTrigger,
  setPhysicsShapeMaterial,
  setPhysicsTimestep,
  setPhysicsVelocityLimits,
  stepScene,
  unlockPhysicsBodyRotationAxes,
} from "@babylonjs/lite";
import type { PhysicsBody, PhysicsRotationAxis, PhysicsShape, PhysicsWorld } from "@babylonjs/lite";
import type { LiteEngine, LiteScene, LiteSceneNode, MutableQuat, MutableVec3, QuatLike, Vec3Like } from "@ignifx/core";

/**
 * The Havok half of this package's Babylon Lite adapter (ADR-0002, ADR-0003,
 * `docs/architecture/09-physics.md` §1). Every `@babylonjs/lite` symbol the extension uses is named
 * here once, so the rest of `src/` never imports Lite (`ignifx/no-lite-outside-adapter`).
 *
 * ## Facts verified against `@babylonjs/lite@1.27.0`
 *
 * - `createHavokWorld(scene, hknp, gravity)` (`index.d.ts` 2592, `lib/physics/havok.js:44`) unshifts
 *   one step callback onto `scene._beforeRender`. Hosting it on a **null-engine** scene and driving
 *   that scene with `stepScene` (12438) is what gives ignifx the accumulator ADR-0003 requires.
 * - `_stepWorld` (`lib/physics/havok.js:73-107`) pre-syncs node→body only for `ANIMATED` bodies and
 *   for bodies with `_preStep` set, then steps once, then syncs body→node for `DYNAMIC` bodies. A
 *   `DYNAMIC` body therefore never reads its node, which is what makes the interpolated display
 *   pose of `09-physics.md` §1 safe (spike S4.3).
 * - `_syncBodyToNode` writes `node.position` / `node.rotationQuaternion` — the node's **local** TRS.
 *   A body's node must therefore be a root node for its pose to be world space; the extension
 *   reports `IGX-0907` otherwise.
 * - `setPhysicsTimestep(world, dt)` (10863) stores `dt * 1000` in `world._fixedDeltaMs`, and the
 *   step clamps at 100 ms (`MAX_STEP_MS`), so the fixed step and Lite's step agree exactly.
 *
 * Everything here is `@internal`.
 */

/**
 * Lite's opaque Havok world handle.
 *
 * @internal
 */
export type LitePhysicsWorld = PhysicsWorld;

/**
 * Lite's opaque Havok body handle. It carries the node it is bound to, which is how the extension
 * resolves a body back to an entity.
 *
 * @internal
 */
export type LitePhysicsBody = PhysicsBody;

/**
 * Lite's opaque Havok collision-shape handle.
 *
 * @internal
 */
export type LitePhysicsShape = PhysicsShape;

/**
 * How a body moves, in ignifx's vocabulary. The numbers are Lite's `PhysicsMotionType` values
 * (`index.d.ts` 8543) so no translation table is needed on a per-body path.
 *
 * @internal
 */
export const BodyMotion = {
  /** Immovable; `PhysicsMotionType.STATIC`. */
  static: 0,
  /** Driven by the node transform; `PhysicsMotionType.ANIMATED`. */
  kinematic: 1,
  /** Simulated; `PhysicsMotionType.DYNAMIC`. */
  dynamic: 2,
} as const;

/**
 * The union of {@link BodyMotion} values.
 *
 * @internal
 */
export type BodyMotion = (typeof BodyMotion)[keyof typeof BodyMotion];

/**
 * How a moved node reaches its body before a step; Lite's `PhysicsPrestepType` (8557).
 *
 * @internal
 */
export const PrestepMode = {
  /** No sync at all. */
  disabled: 0,
  /** Snap the body onto the node. */
  teleport: 1,
  /** Give the body the velocity that reaches the node, so resting bodies are dragged along. */
  velocity: 2,
} as const;

/**
 * The union of {@link PrestepMode} values.
 *
 * @internal
 */
export type PrestepMode = (typeof PrestepMode)[keyof typeof PrestepMode];

/**
 * The shape geometries this package builds; Lite's `PhysicsShapeType` (8606).
 *
 * @internal
 */
export const ShapeGeometry = {
  /** A sphere. */
  sphere: 0,
  /** A capsule between two points. */
  capsule: 1,
  /** A cylinder between two points. */
  cylinder: 2,
  /** An axis-aligned box in shape space. */
  box: 3,
  /** The convex hull of a node's meshes. */
  convexHull: 4,
  /** A compound of child shapes. */
  container: 5,
  /** A triangle mesh built from a node's meshes. */
  mesh: 6,
} as const;

/**
 * The union of {@link ShapeGeometry} values.
 *
 * @internal
 */
export type ShapeGeometry = (typeof ShapeGeometry)[keyof typeof ShapeGeometry];

/**
 * Geometry parameters for {@link createShape}; the subset of Lite's `PhysicsShapeParameters` (8596)
 * this package writes.
 *
 * @internal
 */
export interface ShapeParameters {
  /** The shape's centre in shape space. */
  readonly center?: Vec3Like;
  /** The radius of a sphere, capsule, or cylinder. */
  readonly radius?: number;
  /** The first end point of a capsule or cylinder. */
  readonly pointA?: Vec3Like;
  /** The second end point of a capsule or cylinder. */
  readonly pointB?: Vec3Like;
  /** The full extents of a box. */
  readonly extents?: Vec3Like;
  /** The rotation of a box in shape space. */
  readonly rotation?: QuatLike;
}

/** The engine and scene the simulation runs on. */
export interface SimulationHandles {
  /** Lite's null engine — no device, no surface. */
  readonly engine: LiteEngine;
  /** A scene with no default render task, advanced only by {@link stepSimulation}. */
  readonly scene: LiteScene;
}

/**
 * Creates the null-engine scene the Havok world is hosted on (`09-physics.md` §1, spike S4.1).
 *
 * @returns The engine and scene. Release with {@link disposeSimulation}.
 *
 * @internal
 */
export function createSimulation(): SimulationHandles {
  const engine = createNullEngine();
  return { engine, scene: createSceneContext(engine, { defaultRenderTask: false }) };
}

/**
 * Releases the simulation scene. The null engine owns no GPU resource and must not be handed to
 * Lite's `disposeEngine` (ADR-0009 Validation).
 *
 * @param handles - What {@link createSimulation} returned.
 *
 * @internal
 */
export function disposeSimulation(handles: SimulationHandles): void {
  disposeScene(handles.scene);
}

/**
 * Advances the simulation scene by exactly one Havok step.
 *
 * @param handles - The engine and scene.
 * @param deltaMs - The fixed step in milliseconds.
 *
 * @internal
 */
export function stepSimulation(handles: SimulationHandles, deltaMs: number): void {
  stepScene(handles.engine, handles.scene, deltaMs);
}

/**
 * Creates the Havok world on a simulation scene.
 *
 * @param scene - The simulation scene.
 * @param havok - The instantiated Havok WebAssembly module; Lite types it as `any`.
 * @param gravity - The world gravity.
 * @returns The world handle.
 *
 * @internal
 */
export function createWorld(scene: LiteScene, havok: unknown, gravity: Vec3Like): LitePhysicsWorld {
  return createHavokWorld(scene, havok, { x: gravity.x, y: gravity.y, z: gravity.z });
}

/**
 * Releases every body and the native world. Call it before the simulation scene is disposed
 * (`docs/architecture/07-rendering.md` §7 ordering).
 *
 * @param world - The world handle.
 *
 * @internal
 */
export function destroyWorld(world: LitePhysicsWorld): void {
  disposePhysics(world);
}

/**
 * Pins Lite's per-step delta to ignifx's fixed step, so the two never disagree.
 *
 * @param world - The world handle.
 * @param seconds - The fixed step in seconds.
 *
 * @internal
 */
export function setTimestep(world: LitePhysicsWorld, seconds: number): void {
  setPhysicsTimestep(world, seconds);
}

/**
 * Sets world gravity.
 *
 * @param world - The world handle.
 * @param gravity - The acceleration vector, in metres per second squared.
 *
 * @internal
 */
export function setGravity(world: LitePhysicsWorld, gravity: Vec3Like): void {
  setPhysicsGravity(world, { x: gravity.x, y: gravity.y, z: gravity.z });
}

/**
 * Sets the world-wide speed limits.
 *
 * @param world - The world handle.
 * @param linear - Maximum linear speed, in metres per second.
 * @param angular - Maximum angular speed, in radians per second.
 *
 * @internal
 */
export function setVelocityLimits(world: LitePhysicsWorld, linear: number, angular: number): void {
  setPhysicsVelocityLimits(world, linear, angular);
}

/**
 * Creates a body bound to a scene node.
 *
 * @param world - The world handle.
 * @param node - The node whose local pose is the body pose.
 * @param motion - How the body moves.
 * @param startsAsleep - Whether the body starts asleep.
 * @returns The body handle.
 *
 * @internal
 */
export function createBody(
  world: LitePhysicsWorld,
  node: LiteSceneNode,
  motion: BodyMotion,
  startsAsleep: boolean,
): LitePhysicsBody {
  return createPhysicsBody(world, node, motion, startsAsleep);
}

/**
 * Removes a body from the world.
 *
 * @param world - The world handle.
 * @param body - The body to remove.
 *
 * @internal
 */
export function destroyBody(world: LitePhysicsWorld, body: LitePhysicsBody): void {
  removePhysicsBody(world, body);
}

/**
 * Attaches a shape to a body.
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param shape - The shape.
 *
 * @internal
 */
export function setBodyShape(world: LitePhysicsWorld, body: LitePhysicsBody, shape: LitePhysicsShape): void {
  setPhysicsBodyShape(world, body, shape);
}

/**
 * Sets a body's mass. Havok recomputes the shape-derived inertia around it.
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param mass - The mass in kilograms; `0` for an infinite-mass body.
 *
 * @internal
 */
export function setBodyMass(world: LitePhysicsWorld, body: LitePhysicsBody, mass: number): void {
  setPhysicsBodyMass(world, body, mass);
}

/**
 * Chooses how a moved node reaches the body before the next step.
 *
 * @param body - The body.
 * @param mode - The prestep mode.
 *
 * @internal
 */
export function setBodyPrestep(body: LitePhysicsBody, mode: PrestepMode): void {
  setPhysicsBodyPrestepType(body, mode);
}

/**
 * Turns collision-event reporting on or off for one body.
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param enabled - Whether the body contributes to the collision stream.
 *
 * @internal
 */
export function setBodyCollisionEvents(world: LitePhysicsWorld, body: LitePhysicsBody, enabled: boolean): void {
  setPhysicsBodyCollisionEventsEnabled(world, body, enabled);
}

/**
 * Teleports a body, keeping the node it drives consistent.
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param position - The world position.
 * @param rotation - The world rotation.
 *
 * @internal
 */
export function setBodyTransform(
  world: LitePhysicsWorld,
  body: LitePhysicsBody,
  position: Vec3Like,
  rotation: QuatLike,
): void {
  setPhysicsBodyTransform(
    world,
    body,
    { x: position.x, y: position.y, z: position.z },
    { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  );
}

/**
 * Reads a body's linear velocity into an out parameter (coding standards §7).
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param out - The vector to write.
 *
 * @internal
 */
export function readLinearVelocity(world: LitePhysicsWorld, body: LitePhysicsBody, out: MutableVec3): void {
  const value = getPhysicsBodyLinearVelocity(world, body);
  out.set(value.x, value.y, value.z);
}

/**
 * Reads a body's angular velocity into an out parameter.
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param out - The vector to write.
 *
 * @internal
 */
export function readAngularVelocity(world: LitePhysicsWorld, body: LitePhysicsBody, out: MutableVec3): void {
  const value = getPhysicsBodyAngularVelocity(world, body);
  out.set(value.x, value.y, value.z);
}

/**
 * Sets a body's linear velocity.
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param velocity - Metres per second, world space.
 *
 * @internal
 */
export function writeLinearVelocity(world: LitePhysicsWorld, body: LitePhysicsBody, velocity: Vec3Like): void {
  setPhysicsBodyLinearVelocity(world, body, { x: velocity.x, y: velocity.y, z: velocity.z });
}

/**
 * Sets a body's angular velocity.
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param velocity - Radians per second, world space.
 *
 * @internal
 */
export function writeAngularVelocity(world: LitePhysicsWorld, body: LitePhysicsBody, velocity: Vec3Like): void {
  setPhysicsBodyAngularVelocity(world, body, { x: velocity.x, y: velocity.y, z: velocity.z });
}

/**
 * Applies a force for one fixed step.
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param force - Newtons, world space.
 * @param point - The world-space application point.
 *
 * @internal
 */
export function applyForce(world: LitePhysicsWorld, body: LitePhysicsBody, force: Vec3Like, point: Vec3Like): void {
  applyPhysicsBodyForce(world, body, { x: force.x, y: force.y, z: force.z }, { x: point.x, y: point.y, z: point.z });
}

/**
 * Applies an instantaneous impulse.
 *
 * @param body - The body.
 * @param impulse - Newton-seconds, world space.
 * @param point - The world-space application point.
 *
 * @internal
 */
export function applyImpulse(body: LitePhysicsBody, impulse: Vec3Like, point: Vec3Like): void {
  applyPhysicsBodyImpulse(body, { x: impulse.x, y: impulse.y, z: impulse.z }, { x: point.x, y: point.y, z: point.z });
}

/**
 * Locks or unlocks a body's rotation axes. Havok expresses a locked degree of freedom as zero
 * inertia (`index.d.ts` 6956).
 *
 * @param world - The world handle.
 * @param body - The body.
 * @param locked - The axes to lock; every other axis is unlocked.
 *
 * @internal
 */
export function setRotationLocks(
  world: LitePhysicsWorld,
  body: LitePhysicsBody,
  locked: readonly PhysicsRotationAxis[],
): void {
  const free: PhysicsRotationAxis[] = [];
  for (const axis of ROTATION_AXES) {
    if (!locked.includes(axis)) {
      free.push(axis);
    }
  }
  if (free.length > 0) {
    unlockPhysicsBodyRotationAxes(world, body, free);
  }
  if (locked.length > 0) {
    lockPhysicsBodyRotationAxes(world, body, locked);
  }
}

/** The three rotation axes Lite names, in a stable order. */
const ROTATION_AXES: readonly PhysicsRotationAxis[] = Object.freeze(["x", "y", "z"]);

/**
 * Creates a primitive collision shape.
 *
 * @param world - The world handle.
 * @param geometry - Which primitive to build.
 * @param parameters - Its geometry parameters.
 * @returns The shape handle.
 *
 * @internal
 */
export function createShape(
  world: LitePhysicsWorld,
  geometry: ShapeGeometry,
  parameters: ShapeParameters,
): LitePhysicsShape {
  return createPhysicsShape(world, { type: geometry, parameters: { ...parameters } });
}

/**
 * Creates a triangle-mesh or convex-hull shape from a node's meshes.
 *
 * @remarks
 * Lite documents this as unsupported on the null engine (`index.d.ts` 2781: "Mesh/convex-hull
 * colliders that require `node.worldMatrix`"), and a headless `MeshAsset` uploads no geometry at
 * all, so the extension refuses with `IGX-0906` rather than building an empty shape.
 *
 * @param world - The world handle.
 * @param node - The node whose meshes supply the geometry.
 * @param convex - `true` for a convex hull, `false` for a triangle mesh.
 * @param includeChildren - Whether descendant meshes are accumulated.
 * @returns The shape handle.
 *
 * @internal
 */
export function createMeshShape(
  world: LitePhysicsWorld,
  node: LiteSceneNode,
  convex: boolean,
  includeChildren: boolean,
): LitePhysicsShape {
  return createPhysicsShape(world, {
    type: convex ? ShapeGeometry.convexHull : ShapeGeometry.mesh,
    mesh: node,
    includeChildMeshes: includeChildren,
  });
}

/**
 * Creates a heightfield shape from an explicit sample grid (`index.d.ts` 2601, 6266).
 *
 * @remarks
 * The explicit path only calls `hknp._malloc` and `HP_Shape_CreateHeightField`
 * (`lib/physics/havok-heightfield.js:4-22`), so it works on the null engine; the `groundMesh` path
 * reads `mesh._cpuPositions` and `worldMatrix` and does not.
 *
 * @param world - The world handle.
 * @param samplesX - How many samples along X.
 * @param samplesZ - How many samples along Z.
 * @param sizeX - The world-space size along X.
 * @param sizeZ - The world-space size along Z.
 * @param heights - `samplesX * samplesZ` row-major height samples.
 * @returns The shape handle.
 *
 * @internal
 */
export function createHeightfieldShape(
  world: LitePhysicsWorld,
  samplesX: number,
  samplesZ: number,
  sizeX: number,
  sizeZ: number,
  heights: Float32Array,
): LitePhysicsShape {
  return createHeightFieldShape(world, {
    numHeightFieldSamplesX: samplesX,
    numHeightFieldSamplesZ: samplesZ,
    heightFieldSizeX: sizeX,
    heightFieldSizeZ: sizeZ,
    heightFieldData: heights,
  });
}

/**
 * Creates the empty compound shape several colliders on one entity are added to.
 *
 * @param world - The world handle.
 * @returns The container shape.
 *
 * @internal
 */
export function createContainer(world: LitePhysicsWorld): LitePhysicsShape {
  return createPhysicsShape(world, { type: ShapeGeometry.container });
}

/**
 * Adds a child shape to a container at a local offset.
 *
 * @param world - The world handle.
 * @param container - The container shape.
 * @param child - The child shape.
 * @param translation - The child's offset inside the container.
 * @param rotation - The child's rotation inside the container.
 *
 * @internal
 */
export function addContainerChild(
  world: LitePhysicsWorld,
  container: LitePhysicsShape,
  child: LitePhysicsShape,
  translation: Vec3Like,
  rotation: QuatLike,
): void {
  addPhysicsShapeChild(
    world,
    container,
    child,
    { x: translation.x, y: translation.y, z: translation.z },
    { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  );
}

/**
 * Releases a shape no body references any more.
 *
 * @param world - The world handle.
 * @param shape - The shape.
 *
 * @internal
 */
export function destroyShape(world: LitePhysicsWorld, shape: LitePhysicsShape): void {
  releasePhysicsShape(world, shape);
}

/**
 * Marks a shape as a trigger volume: it reports overlaps and resolves no contacts.
 *
 * @param world - The world handle.
 * @param shape - The shape.
 * @param isTrigger - Whether the shape is a trigger.
 *
 * @internal
 */
export function setShapeTrigger(world: LitePhysicsWorld, shape: LitePhysicsShape, isTrigger: boolean): void {
  setPhysicsShapeIsTrigger(world, shape, isTrigger);
}

/**
 * Sets a shape's surface material.
 *
 * @param world - The world handle.
 * @param shape - The shape.
 * @param friction - The dynamic friction coefficient.
 * @param restitution - The bounciness, `0` to `1`.
 * @param staticFriction - The static friction coefficient.
 *
 * @internal
 */
export function setShapeMaterial(
  world: LitePhysicsWorld,
  shape: LitePhysicsShape,
  friction: number,
  restitution: number,
  staticFriction: number,
): void {
  setPhysicsShapeMaterial(world, shape, friction, restitution, staticFriction);
}

/**
 * Sets a shape's collision filter masks (`09-physics.md` §3).
 *
 * @param world - The world handle.
 * @param shape - The shape.
 * @param membership - The 32-bit membership mask, `1 << entity.layer`.
 * @param collideWith - The 32-bit mask of layers the shape collides with.
 *
 * @internal
 */
export function setShapeFilter(
  world: LitePhysicsWorld,
  shape: LitePhysicsShape,
  membership: number,
  collideWith: number,
): void {
  setPhysicsShapeFilterMembershipMask(world, shape, membership);
  setPhysicsShapeFilterCollideMask(world, shape, collideWith);
}

/**
 * Reads a node's local pose into out parameters.
 *
 * @param node - The node.
 * @param position - The vector to write the position into.
 * @param rotation - The quaternion to write the rotation into.
 *
 * @internal
 */
export function readNodePose(node: LiteSceneNode, position: MutableVec3, rotation: MutableQuat): void {
  const local = node.position;
  const quaternion = node.rotationQuaternion;
  position.set(local.x, local.y, local.z);
  rotation.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
}

/**
 * Writes a node's local pose.
 *
 * @param node - The node.
 * @param position - The position to write.
 * @param rotation - The rotation to write.
 *
 * @internal
 */
export function writeNodePose(node: LiteSceneNode, position: Vec3Like, rotation: QuatLike): void {
  node.position.set(position.x, position.y, position.z);
  node.rotationQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

/**
 * What the trigger drain reports for one overlap.
 *
 * @internal
 */
export interface TriggerRecord {
  /** `true` for `ENTERED`, `false` for `EXITED`. */
  readonly entered: boolean;
  /** The first node, or `null` when Lite no longer tracks the body. */
  readonly nodeA: LiteSceneNode | null;
  /** The second node, or `null`. */
  readonly nodeB: LiteSceneNode | null;
}

/**
 * Registers the trigger drain (`index.d.ts` 7787). It runs inside `stepScene`, from Lite's
 * post-step hook, so the callback must only buffer.
 *
 * @param world - The world handle.
 * @param sink - Called once per trigger event.
 * @returns A disposer that removes the drain.
 *
 * @internal
 */
export function onTriggerEvents(world: LitePhysicsWorld, sink: (record: TriggerRecord) => void): () => void {
  return onPhysicsTriggerBodies(world, (info): void => {
    sink({
      entered: info.type === "ENTERED",
      nodeA: info.bodyA === null ? null : info.bodyA.node,
      nodeB: info.bodyB === null ? null : info.bodyB.node,
    });
  });
}

/**
 * What the upstream collision drain reports for one contact. Lite 1.27.0 carries **no** body
 * identities here (`09-physics.md` §4, ADR-0013); `src/lite/internal/collision-drain.ts` is the
 * waived path that recovers them.
 *
 * @internal
 */
export interface ContactRecord {
  /** `0` for `STARTED`, `1` for `CONTINUED`, `2` for `FINISHED`. */
  readonly phase: number;
  /** The world-space contact point. */
  readonly point: Vec3Like;
  /** The world-space contact normal. */
  readonly normal: Vec3Like;
  /** The magnitude of the resolving impulse; `0` for a contact that just ended. */
  readonly impulse: number;
  /** The first node, or `null` when the drain cannot resolve it. */
  readonly nodeA: LiteSceneNode | null;
  /** The second node, or `null`. */
  readonly nodeB: LiteSceneNode | null;
}

/** `ContactRecord.phase` for a contact that just started. */
export const CONTACT_STARTED: number = 0;

/** `ContactRecord.phase` for a contact that persists. */
export const CONTACT_CONTINUED: number = 1;

/** `ContactRecord.phase` for a contact that just ended. */
export const CONTACT_FINISHED: number = 2;

/**
 * Registers the upstream collision drain (`index.d.ts` 7764). It reports contact data with no body
 * identities, which is exactly what `09-physics.md` §4 documents for the default mode.
 *
 * @param world - The world handle.
 * @param sink - Called once per collision event.
 *
 * @internal
 */
export function onCollisionEvents(world: LitePhysicsWorld, sink: (record: ContactRecord) => void): void {
  onPhysicsCollision(world, (info): void => {
    sink({
      phase:
        info.type === "STARTED" ? CONTACT_STARTED : info.type === "CONTINUED" ? CONTACT_CONTINUED : CONTACT_FINISHED,
      point: info.point,
      normal: info.normal,
      impulse: info.impulse,
      nodeA: null,
      nodeB: null,
    });
  });
}

/**
 * Registers a callback that runs after every Havok step (`index.d.ts` 7753). Lite's own drains use
 * the same hook, and the hooks run in registration order, so the extension's buffer flush is
 * registered last and sees everything the drains produced.
 *
 * @param world - The world handle.
 * @param callback - What to run after each step.
 *
 * @internal
 */
export function afterStep(world: LitePhysicsWorld, callback: () => void): void {
  onPhysicsAfterStep(world, (): void => {
    callback();
  });
}
