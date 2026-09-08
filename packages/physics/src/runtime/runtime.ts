import { Quat, Vec3, lerp } from "@ignifx/core";
import { Collider } from "../components/collider.js";
import { Rigidbody } from "../components/rigidbody.js";
import { PhysicsErrorCode, physicsError } from "../errors.js";
import {
  SupportState,
  controllerBody,
  createController,
  disposeController,
  moveController,
  onControllerPush,
  probeSupport,
  readControllerPosition,
  readControllerVelocity,
  resizeController as resizeLiteController,
  tuneController,
  writeControllerPosition,
  writeControllerVelocity,
} from "../lite/character.js";
import {
  addContainerChild,
  afterStep,
  applyForce,
  applyImpulse,
  BodyMotion,
  CONTACT_FINISHED,
  CONTACT_STARTED,
  createBody,
  createContainer,
  destroyBody,
  destroyShape,
  destroyWorld,
  disposeSimulation,
  onCollisionEvents,
  onTriggerEvents,
  PrestepMode,
  readAngularVelocity,
  readLinearVelocity,
  readNodePose,
  setBodyCollisionEvents,
  setBodyMass,
  setBodyPrestep,
  setBodyShape,
  setBodyTransform,
  setGravity,
  setRotationLocks,
  setShapeFilter,
  setShapeMaterial,
  setShapeTrigger,
  setTimestep,
  setVelocityLimits,
  stepSimulation,
  writeAngularVelocity,
  writeLinearVelocity,
  writeNodePose,
} from "../lite/havok.js";
import { drainCollisionsWithBodies } from "../lite/internal/collision-drain.js";
import type { BodyRecord } from "./body-record.js";
import type { CharacterController, SupportStateName } from "../components/character-controller.js";
import type { ContactPoint } from "../events.js";
import type { CharacterPush, LiteCharacterController } from "../lite/character.js";
import type {
  ContactRecord,
  LitePhysicsBody,
  LitePhysicsShape,
  LitePhysicsWorld,
  SimulationHandles,
  TriggerRecord,
} from "../lite/havok.js";
import type { PhysicsMaterialValues, PhysicsSettings } from "../settings.js";
import type {
  Component,
  DiagnosticsGroup,
  Entity,
  ExtensionContext,
  LiteSceneNode,
  MutableVec3,
  PhysicsCallbackName,
  QuatLike,
  Vec3Like,
} from "@ignifx/core";

/**
 * The per-app physics runtime: the Havok world, the bodies, the character controllers, the event
 * drains, and the three things the systems ask it to do each frame — restore, step, interpolate
 * (`docs/architecture/09-physics.md` §1).
 *
 * Everything here is `@internal`; the public surface is `PhysicsService`, `Rigidbody`, the
 * colliders, and `CharacterController`.
 */

/**
 * How collision events learn which bodies took part (`09-physics.md` §4, ADR-0013).
 *
 * @public
 */
export const COLLISION_IDENTITY_MODES = ["upstream", "internal"] as const;

/**
 * The union of {@link COLLISION_IDENTITY_MODES}.
 *
 * @public
 */
export type CollisionIdentityMode = (typeof COLLISION_IDENTITY_MODES)[number];

/** What the extension hands the runtime. */
export interface PhysicsRuntimeOptions {
  /** The extension registration surface; the physics kernel hooks live on it. */
  readonly ctx: ExtensionContext;
  /** The resolved `physics` settings section. */
  readonly settings: PhysicsSettings;
  /** The null-engine scene the world is hosted on. */
  readonly simulation: SimulationHandles;
  /** The Havok world. */
  readonly world: LitePhysicsWorld;
  /** Which collision-identity path to use. */
  readonly collisionIdentities: CollisionIdentityMode;
  /** The `physics` diagnostics group. */
  readonly counters: DiagnosticsGroup;
}

/** One buffered trigger event, resolved to records during the step. */
interface TriggerSlot {
  /** `true` for an enter, `false` for an exit. */
  entered: boolean;
  /** The first participant, or `null`. */
  first: BodyRecord | null;
  /** The second participant, or `null`. */
  second: BodyRecord | null;
}

/** One buffered collision event. */
interface ContactSlot {
  /** `0` started, `1` continued, `2` finished. */
  phase: number;
  /** The contact point. */
  readonly point: Vec3;
  /** The contact normal. */
  readonly normal: Vec3;
  /** The resolving impulse. */
  impulse: number;
  /** The first participant, or `null` in upstream mode. */
  first: BodyRecord | null;
  /** The second participant, or `null` in upstream mode. */
  second: BodyRecord | null;
}

/** One character controller's runtime state. */
interface ControllerRecord {
  /** The component. */
  readonly component: CharacterController;
  /** Lite's controller. */
  readonly controller: LiteCharacterController;
  /** The pose at the end of the previous step. */
  readonly previousPosition: Vec3;
  /** The authoritative pose at the end of the last step. */
  readonly currentPosition: Vec3;
  /** Whether the display position is interpolated. */
  interpolate: boolean;
  /** The subscription to Lite's push observable. */
  disconnect: () => void;
}

/** The pooled `TriggerEvent`, whose fields the dispatcher rewrites for each delivery. */
interface MutableTriggerEvent {
  /** The other participant. */
  other: Entity | null;
  /** The other participant's first collider. */
  otherCollider: Collider | null;
  /** The entity being called. */
  self: Entity;
}

/** The pooled `Collision`. */
interface MutableCollision {
  /** The other participant. */
  other: Entity | null;
  /** The other participant's first collider. */
  otherCollider: Collider | null;
  /** The entity being called. */
  self: Entity;
  /** The one-element pooled contact list. */
  readonly contacts: readonly ContactPoint[];
  /** The relative velocity, when both identities are known. */
  relativeVelocity: Vec3Like | null;
}

/**
 * The counters `09-physics.md` §9 and the plan's diagnostics deliverable name.
 *
 * @public
 */
export const PHYSICS_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "bodies",
  "activeBodies",
  "stepsThisFrame",
  "collisionEvents",
  "triggerEvents",
  "queries",
  "stepMs",
]);

/**
 * The diagnostics group name.
 *
 * @public
 */
export const PHYSICS_DIAGNOSTICS_GROUP = "physics";

/** How many layers a project can declare, and therefore how wide a filter mask is. */
const LAYER_COUNT = 32;

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** How far a body may move before the implicit-static diagnostic considers it moved. */
const STATIC_MOVE_EPSILON = 1e-6;

/**
 * The per-app physics runtime.
 *
 * @internal
 */
export class PhysicsRuntime {
  readonly #ctx: ExtensionContext;

  readonly #settings: PhysicsSettings;

  readonly #simulation: SimulationHandles;

  readonly #world: LitePhysicsWorld;

  readonly #identities: CollisionIdentityMode;

  readonly #counters: DiagnosticsGroup;

  readonly #records: BodyRecord[] = [];

  readonly #byEntity = new Map<Entity, BodyRecord>();

  readonly #byNode = new Map<LiteSceneNode, BodyRecord>();

  readonly #dirty = new Set<Entity>();

  readonly #controllers: ControllerRecord[] = [];

  readonly #dirtyControllers = new Set<CharacterController>();

  readonly #collideMasks = new Int32Array(LAYER_COUNT).fill(~0);

  readonly #triggerSlots: TriggerSlot[] = [];

  readonly #contactSlots: ContactSlot[] = [];

  #triggerEvent: MutableTriggerEvent | null = null;

  readonly #contactPoint: { point: Vec3; normal: Vec3; impulse: number } = {
    point: new Vec3(),
    normal: new Vec3(),
    impulse: 0,
  };

  readonly #contacts: ContactPoint[] = [];

  #collision: MutableCollision | null = null;

  readonly #scratchPosition = new Vec3();

  readonly #scratchRotation = new Quat();

  readonly #scratchVector = new Vec3();

  readonly #scratchOther = new Vec3();

  readonly #relativeVelocity = new Vec3();

  readonly #gravityDirection = new Vec3(0, -1, 0);

  #triggerCount = 0;

  #contactCount = 0;

  #stepped = false;

  #disposed = false;

  #queries = 0;

  #stepsThisFrame = 0;

  #stepMs = 0;

  #collisionEventCount = 0;

  #triggerEventCount = 0;

  #activeBodies = 0;

  /**
   * Builds the runtime, applies the world settings, and registers the event drains.
   *
   * @param options - The context, settings, scene, world, identity mode, and counters.
   * @throws IgnifxError with code `IGX-0905` when the collision matrix names an unknown layer, or
   * `IGX-0908` when the internal drain does not recognise this Babylon Lite build.
   */
  constructor(options: PhysicsRuntimeOptions) {
    this.#ctx = options.ctx;
    this.#settings = options.settings;
    this.#simulation = options.simulation;
    this.#world = options.world;
    this.#identities = options.collisionIdentities;
    this.#counters = options.counters;
    this.#contacts.push(this.#contactPoint);

    setGravity(this.#world, this.#settings.gravity);
    const gravity = this.#settings.gravity;
    const magnitude = Math.hypot(gravity.x, gravity.y, gravity.z);
    if (magnitude > 0) {
      this.#gravityDirection.set(gravity.x / magnitude, gravity.y / magnitude, gravity.z / magnitude);
    }
    const limits = this.#settings.velocityLimits;
    if (limits.linear > 0 || limits.angular > 0) {
      setVelocityLimits(this.#world, limits.linear, limits.angular);
    }
    this.#buildCollideMasks();
    onTriggerEvents(this.#world, (record): void => {
      this.#bufferTrigger(record);
    });
    if (this.#identities === "internal") {
      drainCollisionsWithBodies(this.#world, (record): void => {
        this.#bufferContact(record);
      });
    } else {
      onCollisionEvents(this.#world, (record): void => {
        this.#bufferContact(record);
      });
    }
    afterStep(this.#world, (): void => {
      // Registered last, so it runs after both drains have filled the buffers.
    });
  }

  /**
   * The Havok world, for the query and viewer paths.
   *
   * @returns The world handle.
   */
  get world(): LitePhysicsWorld {
    return this.#world;
  }

  /**
   * Whether at least one fixed step has run, which is what Havok's broadphase needs before a query
   * can answer (`09-physics.md` §5).
   *
   * @returns `true` once a step has completed.
   */
  get hasStepped(): boolean {
    return this.#stepped;
  }

  /**
   * Every body, in creation order.
   *
   * @returns The records.
   */
  get records(): readonly BodyRecord[] {
    return this.#records;
  }

  /**
   * The resolved settings.
   *
   * @returns The `physics` section.
   */
  get settings(): PhysicsSettings {
    return this.#settings;
  }

  /**
   * Replaces world gravity.
   *
   * @param gravity - The new acceleration vector.
   */
  setGravity(gravity: Vec3Like): void {
    setGravity(this.#world, gravity);
  }

  /**
   * Marks an entity's body for a rebuild at the start of the next fixed step.
   *
   * @param entity - The entity whose colliders or `Rigidbody` changed.
   */
  markDirty(entity: Entity): void {
    if (!this.#disposed && !entity.isDestroyed) {
      this.#dirty.add(entity);
    }
  }

  /**
   * Marks a character controller for a rebuild at the start of the next fixed step.
   *
   * @param component - The controller component.
   */
  markControllerDirty(component: CharacterController): void {
    if (!this.#disposed) {
      this.#dirtyControllers.add(component);
    }
  }

  /**
   * Restores the authoritative pose of every interpolated body and controller, undoing the display
   * pose the `Update` system wrote at the top of the previous frame's `Update`
   * (`09-physics.md` §1, spike S4.3).
   */
  restorePoses(): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record !== undefined && record.interpolate) {
        writeNodePose(record.node, record.currentPosition, record.currentRotation);
      }
    }
    for (let index = 0; index < this.#controllers.length; index += 1) {
      const record = this.#controllers[index];
      if (record !== undefined && record.interpolate) {
        this.#writeControllerTransform(record, record.currentPosition);
      }
    }
  }

  /**
   * Runs one fixed step: reconcile, step Havok, snapshot poses, dispatch events.
   *
   * @param fixedDeltaSeconds - The fixed step in seconds.
   */
  step(fixedDeltaSeconds: number): void {
    this.#syncLayers();
    this.#reconcile();
    this.#applyControllerMoves(fixedDeltaSeconds);
    setTimestep(this.#world, fixedDeltaSeconds);
    this.#triggerCount = 0;
    this.#contactCount = 0;
    const started = now();
    stepSimulation(this.#simulation, fixedDeltaSeconds * MILLISECONDS_PER_SECOND);
    this.#stepMs += now() - started;
    this.#stepsThisFrame += 1;
    this.#stepped = true;
    this.#snapshot(fixedDeltaSeconds);
    this.#dispatchTriggers();
    this.#dispatchContacts();
  }

  /**
   * Writes the interpolated display pose of every interpolated body and controller.
   *
   * @param alpha - `time.fixedStepAlpha`, in `[0, 1)`.
   */
  interpolate(alpha: number): void {
    this.#publishCounters();
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record === undefined || !record.interpolate) {
        continue;
      }
      const position = this.#scratchPosition;
      position.set(
        lerp(record.previousPosition.x, record.currentPosition.x, alpha),
        lerp(record.previousPosition.y, record.currentPosition.y, alpha),
        lerp(record.previousPosition.z, record.currentPosition.z, alpha),
      );
      Quat.slerpToRef(record.previousRotation, record.currentRotation, alpha, this.#scratchRotation);
      writeNodePose(record.node, position, this.#scratchRotation);
    }
    for (let index = 0; index < this.#controllers.length; index += 1) {
      const record = this.#controllers[index];
      if (record === undefined || !record.interpolate) {
        continue;
      }
      this.#scratchPosition.set(
        lerp(record.previousPosition.x, record.currentPosition.x, alpha),
        lerp(record.previousPosition.y, record.currentPosition.y, alpha),
        lerp(record.previousPosition.z, record.currentPosition.z, alpha),
      );
      this.#writeControllerTransform(record, this.#scratchPosition);
    }
  }

  /**
   * The Havok body of an entity, for the `.lite` escape hatch and the debug viewer.
   *
   * @param entity - The entity.
   * @returns The body handle, or `null`.
   */
  bodyHandleOf(entity: Entity): BodyRecord["body"] | null {
    return this.#byEntity.get(entity)?.body ?? null;
  }

  /**
   * The record an entity owns.
   *
   * @param entity - The entity.
   * @returns The record, or `null`.
   */
  recordOf(entity: Entity): BodyRecord | null {
    return this.#byEntity.get(entity) ?? null;
  }

  /**
   * The Havok body an entity's physics is, whether that is a `Rigidbody`, a collider-only static, or
   * a `CharacterController`'s capsule — which is what a sweep names to pass through it
   * (`ShapeCastOptions.ignore`).
   *
   * @param entity - The entity.
   * @returns The body, or `null` when the entity has none yet: a body is built on the fixed step
   * after its components attach, so a query in the same frame finds nothing to ignore.
   */
  bodyOf(entity: Entity): LitePhysicsBody | null {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      return record.body;
    }
    for (let index = 0; index < this.#controllers.length; index += 1) {
      const controller = this.#controllers[index];
      if (controller !== undefined && controller.component.entity === entity) {
        return controllerBody(controller.controller);
      }
    }
    return null;
  }

  /**
   * The record a Lite node belongs to, which is how a Havok event or query result becomes an entity.
   *
   * @param node - The node.
   * @returns The record, or `null`.
   */
  recordOfNode(node: LiteSceneNode | null): BodyRecord | null {
    return node === null ? null : (this.#byNode.get(node) ?? null);
  }

  /** Counts one query for the diagnostics group. */
  countQuery(): void {
    this.#queries += 1;
  }

  /**
   * Reads a body's linear velocity.
   *
   * @param entity - The entity.
   * @param out - The vector to write; left untouched when there is no body.
   */
  readLinear(entity: Entity, out: MutableVec3): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      readLinearVelocity(this.#world, record.body, out);
    }
  }

  /**
   * Reads a body's angular velocity.
   *
   * @param entity - The entity.
   * @param out - The vector to write.
   */
  readAngular(entity: Entity, out: MutableVec3): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      readAngularVelocity(this.#world, record.body, out);
    }
  }

  /**
   * Sets a body's linear velocity.
   *
   * @param entity - The entity.
   * @param velocity - Metres per second, world space.
   */
  setLinearVelocity(entity: Entity, velocity: Vec3Like): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      writeLinearVelocity(this.#world, record.body, velocity);
    }
  }

  /**
   * Sets a body's angular velocity.
   *
   * @param entity - The entity.
   * @param velocity - Radians per second, world space.
   */
  setAngularVelocity(entity: Entity, velocity: Vec3Like): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      writeAngularVelocity(this.#world, record.body, velocity);
    }
  }

  /**
   * Applies a force for one fixed step.
   *
   * @param entity - The entity.
   * @param force - Newtons, world space.
   * @param point - The application point.
   */
  addForce(entity: Entity, force: Vec3Like, point: Vec3Like): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      applyForce(this.#world, record.body, force, point);
    }
  }

  /**
   * Applies an impulse.
   *
   * @param entity - The entity.
   * @param impulse - Newton-seconds, world space.
   * @param point - The application point.
   */
  addImpulse(entity: Entity, impulse: Vec3Like, point: Vec3Like): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      applyImpulse(record.body, impulse, point);
    }
  }

  /**
   * Teleports a body and resets its interpolation history.
   *
   * @param entity - The entity.
   * @param position - The new world position.
   * @param rotation - The new world rotation.
   */
  teleport(entity: Entity, position: Vec3Like, rotation: QuatLike): void {
    const record = this.#byEntity.get(entity);
    if (record === undefined) {
      writeNodePose(entity.transform.lite, position, rotation);
      return;
    }
    setBodyTransform(this.#world, record.body, position, rotation);
    writeNodePose(record.node, position, rotation);
    record.currentPosition.set(position.x, position.y, position.z);
    record.currentRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    record.previousPosition.set(position.x, position.y, position.z);
    record.previousRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  /**
   * Sets a character controller's velocity.
   *
   * @param component - The controller component.
   * @param velocity - Metres per second, world space.
   */
  setControllerVelocity(component: CharacterController, velocity: Vec3Like): void {
    const record = this.#controllerOf(component);
    if (record !== null) {
      writeControllerVelocity(record.controller, velocity);
    }
  }

  /**
   * Reads a character controller's velocity.
   *
   * @param component - The controller component.
   * @param out - The vector to write.
   */
  readControllerVelocity(component: CharacterController, out: MutableVec3): void {
    const record = this.#controllerOf(component);
    if (record !== null) {
      readControllerVelocity(record.controller, out);
    }
  }

  /**
   * Reads a character controller's world position.
   *
   * @param component - The controller component.
   * @param out - The vector to write.
   */
  readControllerPosition(component: CharacterController, out: MutableVec3): void {
    const record = this.#controllerOf(component);
    if (record !== null) {
      readControllerPosition(record.controller, out);
    }
  }

  /**
   * Rebuilds a controller's capsule in place.
   *
   * @param component - The controller component.
   * @param preserveFeet - Whether the foot position stays fixed.
   */
  resizeController(component: CharacterController, preserveFeet: boolean): void {
    const record = this.#controllerOf(component);
    if (record !== null) {
      resizeLiteController(record.controller, component.height, component.radius, preserveFeet);
    }
  }

  /**
   * Teleports a controller and resets its interpolation history.
   *
   * @param component - The controller component.
   * @param position - The new entity world position.
   */
  teleportController(component: CharacterController, position: Vec3Like): void {
    const record = this.#controllerOf(component);
    if (record === null) {
      component.transform.position = position;
      return;
    }
    const centre = this.#scratchVector;
    centre.set(position.x + component.center.x, position.y + component.center.y, position.z + component.center.z);
    writeControllerPosition(record.controller, centre);
    record.currentPosition.set(centre.x, centre.y, centre.z);
    record.previousPosition.set(centre.x, centre.y, centre.z);
    this.#writeControllerTransform(record, centre);
  }

  /**
   * Releases a controller's Lite resources.
   *
   * @param component - The controller component.
   */
  releaseController(component: CharacterController): void {
    this.#dirtyControllers.delete(component);
    for (let index = 0; index < this.#controllers.length; index += 1) {
      const record = this.#controllers[index];
      if (record?.component === component) {
        record.disconnect();
        disposeController(record.controller);
        this.#controllers.splice(index, 1);
        return;
      }
    }
  }

  /**
   * Tears every body and controller down, then releases the Havok world **before** the simulation
   * scene, which is the order `docs/architecture/07-rendering.md` §7 requires.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (let index = this.#controllers.length - 1; index >= 0; index -= 1) {
      const record = this.#controllers[index];
      if (record !== undefined) {
        record.disconnect();
        disposeController(record.controller);
      }
    }
    this.#controllers.length = 0;
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index];
      if (record !== undefined) {
        this.#teardown(record);
      }
    }
    this.#records.length = 0;
    this.#byEntity.clear();
    this.#byNode.clear();
    destroyWorld(this.#world);
    disposeSimulation(this.#simulation);
  }

  /**
   * Publishes the frame's counters and zeroes the accumulators. The kernel resets `FrameSample` each
   * frame but not diagnostics **groups** (`Diagnostics.beginFrame`), so a group that reports
   * per-frame totals resets itself — and the top of `Update`, where the display pose is written, is
   * the first point in a frame at which every fixed step of that frame is done.
   */
  #publishCounters(): void {
    this.#counters.set(this.#index("bodies"), this.#records.length);
    this.#counters.set(this.#index("activeBodies"), this.#activeBodies);
    this.#counters.set(this.#index("stepsThisFrame"), this.#stepsThisFrame);
    this.#counters.set(this.#index("collisionEvents"), this.#collisionEventCount);
    this.#counters.set(this.#index("triggerEvents"), this.#triggerEventCount);
    this.#counters.set(this.#index("queries"), this.#queries);
    this.#counters.set(this.#index("stepMs"), this.#stepMs);
    this.#stepsThisFrame = 0;
    this.#collisionEventCount = 0;
    this.#triggerEventCount = 0;
    this.#queries = 0;
    this.#stepMs = 0;
  }

  /**
   * Resolves a counter name to its index. Called with literal names only, from paths that run once
   * per step rather than once per body.
   *
   * @param counter - The counter name.
   * @returns Its index.
   */
  #index(counter: string): number {
    return this.#counters.index(counter);
  }

  /**
   * Builds the per-layer collide masks from `physics.collisionMatrix` (`09-physics.md` §3).
   *
   * @remarks
   * A layer the matrix does not mention keeps `~0`, so a default project needs no matrix at all.
   * Havok tests the pair in both directions, so one side listing the other is enough to *allow* the
   * pair and one side omitting it is enough to *block* it.
   *
   * @throws IgnifxError with code `IGX-0905` when a name is not a declared layer.
   */
  #buildCollideMasks(): void {
    const layers = this.#ctx.app.world.layers;
    for (const [name, others] of Object.entries(this.#settings.collisionMatrix)) {
      const index = layers.indexOf(name);
      if (index < 0) {
        throw unknownLayer(name);
      }
      let mask = 0;
      for (const other of others) {
        const otherIndex = layers.indexOf(other);
        if (otherIndex < 0) {
          throw unknownLayer(other);
        }
        mask |= 1 << otherIndex;
      }
      this.#collideMasks[index] = mask;
    }
  }

  /**
   * Rebuilds every body marked dirty, and every controller.
   */
  #reconcile(): void {
    if (this.#dirty.size > 0) {
      const pending = [...this.#dirty];
      this.#dirty.clear();
      for (const entity of pending) {
        this.#rebuildEntity(entity);
      }
    }
    if (this.#dirtyControllers.size > 0) {
      const pending = [...this.#dirtyControllers];
      this.#dirtyControllers.clear();
      for (const component of pending) {
        this.#rebuildController(component);
      }
    }
  }

  /**
   * Tears an entity's body down and builds a new one from its current colliders.
   *
   * @param entity - The entity to rebuild.
   */
  #rebuildEntity(entity: Entity): void {
    const existing = this.#byEntity.get(entity);
    let carriedLinear: Vec3 | null = null;
    let carriedAngular: Vec3 | null = null;
    if (existing !== undefined) {
      if (existing.motion === BodyMotion.dynamic) {
        carriedLinear = new Vec3();
        carriedAngular = new Vec3();
        readLinearVelocity(this.#world, existing.body, carriedLinear);
        readAngularVelocity(this.#world, existing.body, carriedAngular);
      }
      this.#teardown(existing);
      const index = this.#records.indexOf(existing);
      if (index >= 0) {
        this.#records.splice(index, 1);
      }
      this.#byEntity.delete(entity);
      this.#byNode.delete(existing.node);
    }
    if (entity.isDestroyed || !entity.activeInHierarchy) {
      return;
    }
    const colliders = collidersOf(entity);
    if (colliders.length === 0) {
      return;
    }
    const rigidbody = entity.getComponent(Rigidbody);
    if (entity.parent !== null) {
      this.#ctx.log.warn(
        `${PhysicsErrorCode.bodyOnChildEntity}: {entity} carries a physics body but is not a root entity; Havok writes its local pose.`,
        entity.name,
      );
    }
    const record = this.#build(entity, rigidbody, colliders);
    this.#records.push(record);
    if (record.motion === BodyMotion.dynamic && carriedLinear !== null && carriedAngular !== null) {
      writeLinearVelocity(this.#world, record.body, carriedLinear);
      writeAngularVelocity(this.#world, record.body, carriedAngular);
    }
  }

  /**
   * Drops an entity's body immediately. `markDirty` refuses a destroyed entity — by the time
   * `onDestroyed` fires the entity is already gone — so destruction takes this path instead.
   *
   * @param entity - The entity whose body goes away.
   */
  #removeRecord(entity: Entity): void {
    const record = this.#byEntity.get(entity);
    if (record === undefined) {
      return;
    }
    this.#teardown(record);
    const index = this.#records.indexOf(record);
    if (index >= 0) {
      this.#records.splice(index, 1);
    }
    this.#byEntity.delete(entity);
    this.#byNode.delete(record.node);
    this.#dirty.delete(entity);
  }

  /**
   * Builds one body from an entity's colliders.
   *
   * @param entity - The entity.
   * @param rigidbody - Its `Rigidbody`, or `null` for an implicit static body.
   * @param colliders - Its colliders, in component order.
   * @returns The new record.
   */
  #build(entity: Entity, rigidbody: Rigidbody | null, colliders: readonly Collider[]): BodyRecord {
    const node = entity.transform.lite;
    const scale = entity.transform.lossyScale;
    const layer = entity.layer;
    const shapes = this.#buildShapeTree(colliders, scale, node, layer);
    const root = shapes.at(-1);
    if (root === undefined) {
      throw new Error("a body needs at least one collider");
    }
    const motion = motionOf(rigidbody);
    const body = this.#createBody(node, root, rigidbody, motion);

    const record: BodyRecord = {
      entity,
      node,
      rigidbody,
      colliders: [...colliders],
      body,
      shapes,
      motion,
      interpolate: this.#shouldInterpolate(rigidbody, motion),
      layer,
      collisionEvents: false,
      previousPosition: new Vec3(),
      previousRotation: new Quat(),
      currentPosition: new Vec3(),
      currentRotation: new Quat(),
      halfExtents: boundsOf(colliders, scale),
      staticVersion: entity.transform.worldMatrixVersion,
      reportedMove: false,
      disconnects: [],
    };
    readNodePose(node, record.currentPosition, record.currentRotation);
    record.previousPosition.copyFrom(record.currentPosition);
    record.previousRotation.copyFrom(record.currentRotation);

    this.#byEntity.set(entity, record);
    this.#byNode.set(node, record);
    this.#applyCollisionEvents(record);
    this.#watchEntity(record);
    return record;
  }

  /**
   * Keeps a record in step with its entity: component changes rebuild, destruction removes.
   *
   * @param record - The record to watch.
   */
  #watchEntity(record: BodyRecord): void {
    const entity = record.entity;
    record.disconnects.push(
      entity.onComponentAdded.connect((component: Component): void => {
        this.#onComponentChanged(record, component);
      }),
      entity.onComponentRemoved.connect((component: Component): void => {
        this.#onComponentChanged(record, component);
      }),
      entity.onDestroyed.connect((): void => {
        this.#removeRecord(entity);
      }),
    );
  }

  /**
   * Builds the shapes for a body: one shape for a single collider, or a container holding a child
   * per collider. The root shape is the **last** entry.
   *
   * @param colliders - The colliders, in component order.
   * @param scale - The entity's lossy scale.
   * @param node - The entity's Lite node.
   * @param layer - The entity's layer.
   * @returns Every shape created, root last, for release when the body goes.
   */
  #buildShapeTree(colliders: readonly Collider[], scale: Vec3, node: LiteSceneNode, layer: number): LitePhysicsShape[] {
    const defaults = this.#settings.defaultMaterial;
    const shapes: LitePhysicsShape[] = [];
    const only = colliders.length === 1 ? colliders[0] : undefined;
    if (only !== undefined) {
      shapes.push(this.#buildShape(only, scale, node, layer, defaults));
      return shapes;
    }
    const root = createContainer(this.#world);
    for (const collider of colliders) {
      const child = this.#buildShape(collider, scale, node, layer, defaults);
      shapes.push(child);
      addContainerChild(this.#world, root, child, Vec3.zero(), Quat.identity());
    }
    setShapeFilter(this.#world, root, membershipOf(layer), this.#collideMaskOf(layer));
    shapes.push(root);
    return shapes;
  }

  /**
   * Creates the Havok body for a record and applies its motion-dependent settings.
   *
   * @param node - The entity's Lite node.
   * @param root - The root shape.
   * @param rigidbody - The `Rigidbody`, or `null` for an implicit static body.
   * @param motion - The motion type derived from the rigidbody.
   * @returns The body.
   */
  #createBody(
    node: LiteSceneNode,
    root: LitePhysicsShape,
    rigidbody: Rigidbody | null,
    motion: BodyMotion,
  ): LitePhysicsBody {
    const body = createBody(this.#world, node, motion, rigidbody?.startAsleep ?? false);
    setBodyShape(this.#world, body, root);
    if (motion === BodyMotion.dynamic) {
      setBodyMass(this.#world, body, rigidbody?.mass ?? 1);
    }
    if (motion === BodyMotion.kinematic) {
      setBodyPrestep(body, rigidbody?.kinematicSync === "velocity" ? PrestepMode.velocity : PrestepMode.teleport);
    }
    if (rigidbody !== null) {
      setRotationLocks(this.#world, body, lockedAxes(rigidbody));
    }
    return body;
  }

  /**
   * Builds one collider's shape and applies its filter, material, and trigger flag.
   *
   * @param collider - The collider.
   * @param scale - The entity's lossy scale.
   * @param node - The entity's node.
   * @param layer - The entity's layer.
   * @param defaults - The world's default material.
   * @returns The shape.
   */
  #buildShape(
    collider: Collider,
    scale: Vec3Like,
    node: LiteSceneNode,
    layer: number,
    defaults: PhysicsMaterialValues,
  ): LitePhysicsShape {
    const shape = collider.createShape(this.#world, scale, node);
    const effective = this.#layerOf(collider, layer);
    setShapeFilter(this.#world, shape, membershipOf(effective), this.#collideMaskOf(effective));
    const material = collider.resolveMaterial(defaults);
    setShapeMaterial(this.#world, shape, material.friction, material.restitution, material.staticFriction);
    if (collider.isTrigger) {
      setShapeTrigger(this.#world, shape, true);
    }
    return shape;
  }

  /**
   * The layer a collider filters as: its override, or its entity's.
   *
   * @param collider - The collider.
   * @param fallback - The entity's layer.
   * @returns The layer index.
   * @throws IgnifxError with code `IGX-0905` when the override names an undeclared layer.
   */
  #layerOf(collider: Collider, fallback: number): number {
    if (collider.layerOverride === "") {
      return fallback;
    }
    const index = this.#ctx.app.world.layers.indexOf(collider.layerOverride);
    if (index < 0) {
      throw unknownLayer(collider.layerOverride);
    }
    return index;
  }

  /**
   * The collide mask of a layer.
   *
   * @param layer - The layer index.
   * @returns The 32-bit mask.
   */
  #collideMaskOf(layer: number): number {
    return this.#collideMasks[layer] ?? ~0;
  }

  /**
   * Whether a body's display pose is interpolated.
   *
   * @param rigidbody - The `Rigidbody`, or `null`.
   * @param motion - The motion type.
   * @returns `true` when interpolation applies.
   */
  #shouldInterpolate(rigidbody: Rigidbody | null, motion: BodyMotion): boolean {
    if (!this.#settings.interpolation || motion === BodyMotion.static || rigidbody === null) {
      return false;
    }
    return rigidbody.interpolation === "interpolate";
  }

  /**
   * Recomputes `collisionEvents` when a component joins or leaves the entity (`09-physics.md` §2.1).
   *
   * @param record - The body record.
   * @param component - The component that changed.
   */
  #onComponentChanged(record: BodyRecord, component: Component): void {
    if (component instanceof Collider || component instanceof Rigidbody) {
      this.markDirty(record.entity);
      return;
    }
    this.#applyCollisionEvents(record);
  }

  /**
   * Pushes the effective `collisionEvents` value to Havok.
   *
   * @param record - The body record.
   */
  #applyCollisionEvents(record: BodyRecord): void {
    const mode = record.rigidbody?.collisionEvents ?? "auto";
    const enabled = mode === "on" ? true : mode === "off" ? false : this.#entityWantsCollisions(record.entity);
    if (enabled !== record.collisionEvents) {
      record.collisionEvents = enabled;
      setBodyCollisionEvents(this.#world, record.body, enabled);
    }
  }

  /**
   * Whether any script on an entity implements a collision callback.
   *
   * @param entity - The entity.
   * @returns `true` when at least one does.
   */
  #entityWantsCollisions(entity: Entity): boolean {
    return (
      this.#ctx.entityImplements(entity, "onCollisionEnter") ||
      this.#ctx.entityImplements(entity, "onCollisionStay") ||
      this.#ctx.entityImplements(entity, "onCollisionExit")
    );
  }

  /**
   * Applies a runtime `entity.layer` change to the filter masks, which `09-physics.md` §3 says
   * happens on the next fixed step.
   */
  #syncLayers(): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record === undefined || record.entity.layer === record.layer) {
        continue;
      }
      // Rewriting a shape's filter masks in place does **not** move a body between broadphase
      // groups in @babylonjs/havok@1.3.14 — neither on its own nor with the shape re-attached
      // (measured: a resting body kept colliding with a layer its new mask excludes). The body is
      // therefore rebuilt, which is still "on the next fixed step" as `09-physics.md` §3 promises;
      // `#rebuildEntity` carries the velocities across so the change is not felt as a teleport.
      this.markDirty(record.entity);
    }
  }

  /**
   * Snapshots every body's authoritative pose and reports implicit-static bodies that moved.
   *
   * @param fixedDeltaSeconds - The fixed step, used to probe controller support.
   */
  #snapshot(fixedDeltaSeconds: number): void {
    let active = 0;
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record === undefined) {
        continue;
      }
      record.previousPosition.copyFrom(record.currentPosition);
      record.previousRotation.copyFrom(record.currentRotation);
      readNodePose(record.node, record.currentPosition, record.currentRotation);
      if (record.motion === BodyMotion.dynamic && !nearlyEqual(record.previousPosition, record.currentPosition)) {
        active += 1;
      }
      if (record.rigidbody === null) {
        this.#checkStaticMove(record);
      }
    }
    this.#activeBodies = active;
    this.#snapshotControllers(fixedDeltaSeconds);
  }

  /**
   * Reports `IGX-0901` once for an implicit static body whose transform moved.
   *
   * @param record - The body record.
   */
  #checkStaticMove(record: BodyRecord): void {
    const version = record.entity.transform.worldMatrixVersion;
    if (version === record.staticVersion || record.reportedMove) {
      return;
    }
    record.staticVersion = version;
    record.reportedMove = true;
    this.#ctx.log.warn(
      `${PhysicsErrorCode.movedStaticBody}: {entity} has colliders but no Rigidbody, and it moved after its static body was placed.`,
      record.entity.name,
    );
  }

  /**
   * Reads every controller's resolved position into the entity transform and probes its support.
   *
   * @param fixedDeltaSeconds - The fixed step.
   */
  #snapshotControllers(fixedDeltaSeconds: number): void {
    for (let index = 0; index < this.#controllers.length; index += 1) {
      const record = this.#controllers[index];
      if (record === undefined) {
        continue;
      }
      record.previousPosition.copyFrom(record.currentPosition);
      readControllerPosition(record.controller, record.currentPosition);
      const state = probeSupport(record.controller, fixedDeltaSeconds, this.#settings.gravity, this.#scratchVector);
      record.component.applyStepResult(supportName(state), this.#scratchVector);
      this.#writeControllerTransform(record, record.currentPosition);
    }
  }

  /**
   * Hands every controller its accumulated displacement.
   *
   * @param fixedDeltaSeconds - The fixed step, unused by `moveWithCollisions` but kept for symmetry.
   */
  #applyControllerMoves(fixedDeltaSeconds: number): void {
    void fixedDeltaSeconds;
    for (let index = 0; index < this.#controllers.length; index += 1) {
      const record = this.#controllers[index];
      if (record === undefined) {
        continue;
      }
      moveController(record.controller, record.component.takePendingMove());
    }
  }

  /**
   * Writes a controller's capsule centre back onto its entity, undoing the component's `center`.
   *
   * @param record - The controller record.
   * @param centre - The capsule centre in world space.
   */
  #writeControllerTransform(record: ControllerRecord, centre: Vec3Like): void {
    const component = record.component;
    this.#scratchOther.set(centre.x - component.center.x, centre.y - component.center.y, centre.z - component.center.z);
    component.transform.position = this.#scratchOther;
  }

  /**
   * Builds or rebuilds one controller.
   *
   * @param component - The controller component.
   */
  #rebuildController(component: CharacterController): void {
    this.releaseController(component);
    if (component.isDestroyed || !component.isEnabledInHierarchy) {
      return;
    }
    const position = component.transform.position;
    const centre = new Vec3(
      position.x + component.center.x,
      position.y + component.center.y,
      position.z + component.center.z,
    );
    const controller = createController(this.#world, centre, component.height, component.radius);
    tuneController(
      controller,
      Math.cos((component.slopeLimit * Math.PI) / 180),
      component.skinWidth,
      component.pushStrength * DEFAULT_CHARACTER_STRENGTH,
    );
    const record: ControllerRecord = {
      component,
      controller,
      previousPosition: centre.clone(),
      currentPosition: centre.clone(),
      interpolate: this.#settings.interpolation && component.interpolation === "interpolate",
      disconnect: (): void => {
        // Replaced immediately below; a record is never observed with this placeholder.
      },
    };
    record.disconnect = onControllerPush(controller, (push: CharacterPush): void => {
      this.#reportPush(record, push);
    });
    this.#controllers.push(record);
  }

  /**
   * Turns one Lite push event into a `CharacterCollision`.
   *
   * @param record - The controller record.
   * @param push - What Lite reported.
   */
  #reportPush(record: ControllerRecord, push: CharacterPush): void {
    record.component.reportPush({
      other: this.recordOfNode(push.node)?.entity ?? null,
      impulse: push.impulse,
      point: push.point,
    });
  }

  /**
   * The runtime state of a controller component.
   *
   * @param component - The component.
   * @returns The record, or `null`.
   */
  #controllerOf(component: CharacterController): ControllerRecord | null {
    for (let index = 0; index < this.#controllers.length; index += 1) {
      const record = this.#controllers[index];
      if (record?.component === component) {
        return record;
      }
    }
    return null;
  }

  /**
   * Buffers a trigger event. It runs inside `stepScene`, so it only records.
   *
   * @param event - What Lite reported.
   */
  #bufferTrigger(event: TriggerRecord): void {
    const slot = this.#triggerSlot(this.#triggerCount);
    slot.entered = event.entered;
    slot.first = this.recordOfNode(event.nodeA);
    slot.second = this.recordOfNode(event.nodeB);
    this.#triggerCount += 1;
  }

  /**
   * Buffers a collision event.
   *
   * @param event - What the active drain reported.
   */
  #bufferContact(event: ContactRecord): void {
    const slot = this.#contactSlot(this.#contactCount);
    slot.phase = event.phase;
    slot.point.set(event.point.x, event.point.y, event.point.z);
    slot.normal.set(event.normal.x, event.normal.y, event.normal.z);
    slot.impulse = event.impulse;
    slot.first = this.recordOfNode(event.nodeA);
    slot.second = this.recordOfNode(event.nodeB);
    this.#contactCount += 1;
  }

  /**
   * Grows the trigger pool on demand and returns one slot.
   *
   * @param index - The slot index.
   * @returns The slot.
   */
  #triggerSlot(index: number): TriggerSlot {
    let slot = this.#triggerSlots[index];
    if (slot === undefined) {
      slot = { entered: false, first: null, second: null };
      this.#triggerSlots.push(slot);
    }
    return slot;
  }

  /**
   * Grows the contact pool on demand and returns one slot.
   *
   * @param index - The slot index.
   * @returns The slot.
   */
  #contactSlot(index: number): ContactSlot {
    let slot = this.#contactSlots[index];
    if (slot === undefined) {
      slot = { phase: 0, point: new Vec3(), normal: new Vec3(), impulse: 0, first: null, second: null };
      this.#contactSlots.push(slot);
    }
    return slot;
  }

  /** Delivers the buffered trigger events to both participants' scripts. */
  #dispatchTriggers(): void {
    this.#triggerEventCount += this.#triggerCount;
    for (let index = 0; index < this.#triggerCount; index += 1) {
      const slot = this.#triggerSlots[index];
      if (slot === undefined) {
        continue;
      }
      const kind: PhysicsCallbackName = slot.entered ? "onTriggerEnter" : "onTriggerExit";
      this.#deliverTrigger(slot.first, slot.second, kind);
      this.#deliverTrigger(slot.second, slot.first, kind);
    }
  }

  /**
   * Delivers one trigger event to one entity.
   *
   * @param target - The record whose scripts receive it, or `null`.
   * @param other - The other participant, or `null`.
   * @param kind - Which callback to deliver.
   */
  #deliverTrigger(target: BodyRecord | null, other: BodyRecord | null, kind: PhysicsCallbackName): void {
    if (target === null || target.entity.isDestroyed) {
      return;
    }
    const event: MutableTriggerEvent = (this.#triggerEvent ??= {
      other: null,
      otherCollider: null,
      self: target.entity,
    });
    event.self = target.entity;
    event.other = other?.entity ?? null;
    event.otherCollider = other?.colliders[0] ?? null;
    this.#ctx.dispatchScriptCallback(target.entity, kind, event);
  }

  /** Delivers the buffered collision events. */
  #dispatchContacts(): void {
    this.#collisionEventCount += this.#contactCount;
    for (let index = 0; index < this.#contactCount; index += 1) {
      const slot = this.#contactSlots[index];
      if (slot === undefined) {
        continue;
      }
      const kind = contactCallback(slot.phase);
      if (slot.first === null && slot.second === null) {
        this.#broadcastContact(slot, kind);
        continue;
      }
      this.#deliverContact(slot, slot.first, slot.second, kind);
      this.#deliverContact(slot, slot.second, slot.first, kind);
    }
  }

  /**
   * Delivers one collision to every entity that opted into collision events — the only thing that
   * can be done in `"upstream"` mode, where Lite reports no identities at all (`09-physics.md` §4).
   *
   * @param slot - The buffered contact.
   * @param kind - Which callback to deliver.
   */
  #broadcastContact(slot: ContactSlot, kind: PhysicsCallbackName): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record !== undefined && record.collisionEvents) {
        this.#deliverContact(slot, record, null, kind);
      }
    }
  }

  /**
   * Delivers one collision to one entity.
   *
   * @param slot - The buffered contact.
   * @param target - The record whose scripts receive it, or `null`.
   * @param other - The other participant, or `null`.
   * @param kind - Which callback to deliver.
   */
  #deliverContact(
    slot: ContactSlot,
    target: BodyRecord | null,
    other: BodyRecord | null,
    kind: PhysicsCallbackName,
  ): void {
    if (target === null || target.entity.isDestroyed || !target.collisionEvents) {
      return;
    }
    this.#contactPoint.point.copyFrom(slot.point);
    this.#contactPoint.normal.copyFrom(slot.normal);
    this.#contactPoint.impulse = slot.impulse;
    const collision: MutableCollision = (this.#collision ??= {
      other: null,
      otherCollider: null,
      self: target.entity,
      contacts: this.#contacts,
      relativeVelocity: null,
    });
    collision.self = target.entity;
    collision.other = other?.entity ?? null;
    collision.otherCollider = other?.colliders[0] ?? null;
    collision.relativeVelocity = other === null ? null : this.#relativeVelocityOf(target, other);
    this.#ctx.dispatchScriptCallback(target.entity, kind, collision);
  }

  /**
   * The relative velocity of two bodies at the moment of a contact.
   *
   * @param target - The receiving body.
   * @param other - The other body.
   * @returns A pooled vector.
   */
  #relativeVelocityOf(target: BodyRecord, other: BodyRecord): Vec3Like {
    readLinearVelocity(this.#world, target.body, this.#scratchVector);
    readLinearVelocity(this.#world, other.body, this.#scratchOther);
    this.#relativeVelocity.set(
      this.#scratchVector.x - this.#scratchOther.x,
      this.#scratchVector.y - this.#scratchOther.y,
      this.#scratchVector.z - this.#scratchOther.z,
    );
    return this.#relativeVelocity;
  }

  /**
   * Releases one record's Lite resources and signal connections.
   *
   * @param record - The record to tear down.
   */
  #teardown(record: BodyRecord): void {
    for (const disconnect of record.disconnects) {
      disconnect();
    }
    record.disconnects = [];
    destroyBody(this.#world, record.body);
    for (let index = record.shapes.length - 1; index >= 0; index -= 1) {
      const shape = record.shapes[index];
      if (shape !== undefined) {
        destroyShape(this.#world, shape);
      }
    }
    record.shapes = [];
  }
}

/** Lite's own `characterStrength` default, which `pushStrength: 1` reproduces (`index.d.ts` 8320). */
const DEFAULT_CHARACTER_STRENGTH = 1e38;

/**
 * The colliders that make up an entity's body: every enabled `Collider` on the entity itself.
 *
 * @param entity - The entity.
 * @returns The colliders, in component order.
 */
function collidersOf(entity: Entity): readonly Collider[] {
  const found: Collider[] = [];
  const components = entity.components;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component instanceof Collider && component.enabled && !component.isDestroyed) {
      found.push(component);
    }
  }
  return found;
}

/**
 * The motion type a `Rigidbody` asks for.
 *
 * @param rigidbody - The component, or `null` for the implicit static body.
 * @returns The Lite motion type.
 */
function motionOf(rigidbody: Rigidbody | null): BodyMotion {
  if (rigidbody === null || rigidbody.bodyType === "static") {
    return BodyMotion.static;
  }
  return rigidbody.bodyType === "kinematic" ? BodyMotion.kinematic : BodyMotion.dynamic;
}

/**
 * The rotation axes a `Rigidbody` freezes.
 *
 * @param rigidbody - The component.
 * @returns The locked axes, in a stable order.
 */
function lockedAxes(rigidbody: Rigidbody): readonly ("x" | "y" | "z")[] {
  const locked: ("x" | "y" | "z")[] = [];
  if (rigidbody.freezeRotation.x) {
    locked.push("x");
  }
  if (rigidbody.freezeRotation.y) {
    locked.push("y");
  }
  if (rigidbody.freezeRotation.z) {
    locked.push("z");
  }
  return locked;
}

/**
 * The membership mask of a layer (`09-physics.md` §3).
 *
 * @param layer - The layer index.
 * @returns `1 << layer`.
 */
function membershipOf(layer: number): number {
  return 1 << layer;
}

/**
 * The half-extents of the union of an entity's colliders, for the bounds index.
 *
 * @param colliders - The colliders.
 * @param scale - The entity's lossy scale.
 * @returns A fresh vector.
 */
function boundsOf(colliders: readonly Collider[], scale: Vec3Like): Vec3 {
  const bounds = new Vec3();
  const scratch = new Vec3();
  for (let index = 0; index < colliders.length; index += 1) {
    const collider = colliders[index];
    if (collider === undefined) {
      continue;
    }
    collider.halfExtentsToRef(scale, scratch);
    bounds.set(
      Math.max(bounds.x, Math.abs(collider.center.x * scale.x) + scratch.x),
      Math.max(bounds.y, Math.abs(collider.center.y * scale.y) + scratch.y),
      Math.max(bounds.z, Math.abs(collider.center.z * scale.z) + scratch.z),
    );
  }
  return bounds;
}

/**
 * Which callback a contact phase maps to.
 *
 * @param phase - `0` started, `1` continued, `2` finished.
 * @returns The callback name.
 */
function contactCallback(phase: number): PhysicsCallbackName {
  if (phase === CONTACT_STARTED) {
    return "onCollisionEnter";
  }
  return phase === CONTACT_FINISHED ? "onCollisionExit" : "onCollisionStay";
}

/**
 * The name of a Lite support state.
 *
 * @param state - Lite's value.
 * @returns The ignifx name.
 */
function supportName(state: number): SupportStateName {
  if (state === SupportState.supported) {
    return "supported";
  }
  return state === SupportState.sliding ? "sliding" : "unsupported";
}

/**
 * Whether two positions are the same to within the static-move epsilon.
 *
 * @param first - The first position.
 * @param second - The second position.
 * @returns `true` when they match.
 */
function nearlyEqual(first: Vec3Like, second: Vec3Like): boolean {
  return (
    Math.abs(first.x - second.x) < STATIC_MOVE_EPSILON &&
    Math.abs(first.y - second.y) < STATIC_MOVE_EPSILON &&
    Math.abs(first.z - second.z) < STATIC_MOVE_EPSILON
  );
}

/**
 * A monotonic millisecond reading for the `stepMs` counter. It never feeds the simulation, so it
 * does not break the "no wall-clock reads" rule of `09-physics.md` §8.
 *
 * @returns Milliseconds since the process started.
 */
function now(): number {
  return performance.now();
}

/**
 * Builds the "that is not a layer" failure.
 *
 * @param name - The offending layer name.
 * @returns The error to throw.
 */
function unknownLayer(name: string): ReturnType<typeof physicsError> {
  return physicsError(PhysicsErrorCode.unknownLayer, `${name} is not a layer this project declares.`, {
    context: { layer: name },
    hint: "Add the layer to the layers settings section, or fix the name in physics.collisionMatrix.",
  });
}
