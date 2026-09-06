import { lerp, Vec2, Vec3 } from "@ignifx/core";
import { CharacterController2D } from "../components/character-controller.js";
import { Collider2D } from "../components/collider.js";
import { Rigidbody2D } from "../components/rigidbody.js";
import { TilemapCollider2D } from "../components/tilemap-collider.js";
import { Physics2DErrorCode, physics2DError } from "../errors.js";
import {
  computeControllerMovement,
  controllerHitCount,
  createController,
  destroyController,
  readControllerHit,
  tuneController,
} from "../lite/rapier/character.js";
import {
  addForce,
  addTorque,
  applyImpulse,
  BodyMotion2D,
  bodyMass,
  colliderHandle,
  createBody,
  createCollider,
  createEventQueue,
  destroyBody,
  destroyEventQueue,
  destroyWorld,
  drainCollisions,
  interactionGroups,
  isColliderSensor,
  primeWorld,
  RAPIER_LAYER_LIMIT,
  readAngularVelocity,
  readBodyPose,
  readColliderTranslation,
  readContact,
  readLinearVelocity,
  recomputeMass,
  setBodyPose,
  setColliderDensity,
  setColliderEvents,
  setGravity,
  setNextKinematicPose,
  setSolverIterations,
  setTimestep,
  stepWorld,
  toDegrees,
  toRadians,
  writeAngularVelocity,
  writeLinearVelocity,
} from "../lite/rapier/world.js";
import type { BodyRecord2D } from "./body-record.js";
import type { CollectedShape2D } from "../components/collider.js";
import type { ContactPoint2D } from "../events.js";
import type { ControllerHit2D, RapierController } from "../lite/rapier/character.js";
import type { ContactData2D, RapierCollider, RapierEventQueue, RapierWorld } from "../lite/rapier/world.js";
import type { Physics2DMaterialValues, Physics2DSettings } from "../settings.js";
import type {
  Component,
  DiagnosticsGroup,
  Entity,
  ExtensionContext,
  MutableVec2,
  PhysicsCallbackName,
  Vec2Like,
} from "@ignifx/core";

/**
 * The per-app 2D physics runtime: the Rapier world, the bodies, the character controllers, the
 * event drain, and the three things the systems ask it to do each frame — restore, step,
 * interpolate (`docs/architecture/11-2d-toolkit.md` §8, `09-physics.md` §1).
 *
 * Everything here is `@internal`; the public surface is `Physics2DService`, `Rigidbody2D`, the 2D
 * colliders, and `CharacterController2D`.
 */

/** What the extension hands the runtime. */
export interface Physics2DRuntimeOptions {
  /** The extension registration surface; the physics kernel hooks live on it. */
  readonly ctx: ExtensionContext;
  /** The resolved `physics2d` settings section. */
  readonly settings: Physics2DSettings;
  /** The Rapier world. */
  readonly world: RapierWorld;
  /** The `physics2d` diagnostics group. */
  readonly counters: DiagnosticsGroup;
}

/**
 * The counters `09-physics.md` §9 and `11-2d-toolkit.md` §8 name for 2D.
 *
 * @public
 */
export const PHYSICS_2D_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "bodies",
  "colliders",
  "stepsThisFrame",
  "collisionEvents",
  "triggerEvents",
  "stepMs",
]);

/**
 * The diagnostics group name.
 *
 * @public
 */
export const PHYSICS_2D_DIAGNOSTICS_GROUP = "physics2d";

/** One pair of colliders Rapier currently reports as touching. */
interface PairState {
  /** The first collider's handle. */
  readonly first: number;
  /** The second collider's handle. */
  readonly second: number;
  /** Whether either collider is a sensor, which makes the pair a trigger rather than a contact. */
  readonly sensor: boolean;
  /** Whether the pair started this step, so it gets `Enter` rather than `Stay`. */
  entered: boolean;
}

/** The pooled `TriggerEvent2D`, whose fields the dispatcher rewrites for each delivery. */
interface MutableTrigger {
  /** The other participant. */
  other: Entity | null;
  /** The other participant's collider. */
  otherCollider: Collider2D | null;
  /** The entity being called. */
  self: Entity;
  /** This entity's collider. */
  selfCollider: Collider2D | null;
}

/** The pooled `Collision2D`. */
interface MutableCollision {
  /** The other participant. */
  other: Entity | null;
  /** The other participant's collider. */
  otherCollider: Collider2D | null;
  /** The entity being called. */
  self: Entity;
  /** This entity's collider. */
  selfCollider: Collider2D | null;
  /** The one-element pooled contact list. */
  readonly contacts: readonly ContactPoint2D[];
  /** The relative velocity of the two bodies. */
  readonly relativeVelocity: Vec2Like;
}

/** The pooled `CharacterCollision2D`. */
interface MutableCharacterCollision {
  /** The entity that was hit. */
  other: Entity | null;
  /** The collider that was hit. */
  otherCollider: Collider2D | null;
  /** The contact point. */
  readonly point: Vec2Like;
  /** The contact normal. */
  readonly normal: Vec2Like;
}

/** One collider that is solid only from above, with its world top cached for the move filter. */
interface OneWayPlatform {
  /** The Rapier collider. */
  readonly collider: RapierCollider;
  /** How far its top sits above the collider's own origin, in metres. */
  readonly halfHeight: number;
  /** Its world-space top, refreshed once per fixed step. */
  top: number;
}

/** Which ignifx collider a Rapier collider belongs to. */
interface ColliderBinding {
  /** The record that owns it. */
  readonly record: BodyRecord2D;
  /** The authored collider, or `null` for a character controller's own shape. */
  readonly owner: Collider2D | null;
  /** The Rapier collider itself, which the event and contact paths need. */
  readonly collider: RapierCollider;
}

/** How far an implicit static body may move before the diagnostic considers it moved. */
const STATIC_MOVE_EPSILON = 1e-6;

/** How much clear floor Rapier requires past an autostep, in metres. */
const AUTOSTEP_MIN_WIDTH = 0.05;

/** Every layer bit Rapier can express. */
const ALL_LAYER_BITS = 0xff_ff;

/**
 * The per-app 2D physics runtime.
 *
 * @internal
 */
export class Physics2DRuntime {
  readonly #ctx: ExtensionContext;

  readonly #settings: Physics2DSettings;

  readonly #world: RapierWorld;

  readonly #counters: DiagnosticsGroup;

  readonly #queue: RapierEventQueue;

  readonly #records: BodyRecord2D[] = [];

  readonly #byEntity = new Map<Entity, BodyRecord2D>();

  readonly #byCollider = new Map<number, ColliderBinding>();

  readonly #controllers = new Map<number, RapierController>();

  readonly #oneWay = new Map<number, OneWayPlatform>();

  readonly #dirty = new Set<Entity>();

  readonly #collideMasks = new Int32Array(RAPIER_LAYER_LIMIT).fill(ALL_LAYER_BITS);

  readonly #pairs = new Map<string, PairState>();

  readonly #endedPairs: PairState[] = [];

  readonly #startedPairs: PairState[] = [];

  readonly #contact: ContactData2D = { touching: false, point: new Vec2(), normal: new Vec2(), impulse: 0 };

  readonly #contactPoint: { point: Vec2; normal: Vec2; impulse: number } = {
    point: new Vec2(),
    normal: new Vec2(),
    impulse: 0,
  };

  readonly #contacts: ContactPoint2D[] = [];

  readonly #controllerHit: ControllerHit2D = { collider: null, point: new Vec2(), normal: new Vec2() };

  #trigger: MutableTrigger | null = null;

  #collision: MutableCollision | null = null;

  #characterCollision: MutableCharacterCollision | null = null;

  readonly #scratchPose = new Vec3();

  readonly #scratchVector = new Vec2();

  readonly #relativeVelocity = new Vec2();

  readonly #movement = new Vec2();

  readonly #groundNormal = new Vec2();

  readonly #filterScratch = new Vec2();

  /** The vertical component of the displacement the filtered move is attempting. */
  #filterDesiredY = 0;

  /** The bottom of the filtered character, in metres. */
  #filterFeet = 0;

  #colliderSetChanged = true;

  #stepped = false;

  #disposed = false;

  #stepsThisFrame = 0;

  #stepMs = 0;

  #collisionEventCount = 0;

  #triggerEventCount = 0;

  #colliderCount = 0;

  /**
   * Builds the runtime and applies the world settings.
   *
   * @param options - The context, settings, world, and counters.
   * @throws IgnifxError with code `IGX-1155` when the collision matrix names an unknown layer.
   */
  constructor(options: Physics2DRuntimeOptions) {
    this.#ctx = options.ctx;
    this.#settings = options.settings;
    this.#world = options.world;
    this.#counters = options.counters;
    this.#queue = createEventQueue();
    this.#contacts.push(this.#contactPoint);
    setGravity(this.#world, this.#settings.gravity);
    if (this.#settings.velocityIterations > 0) {
      setSolverIterations(this.#world, this.#settings.velocityIterations);
    }
    this.#buildCollideMasks();
  }

  /**
   * The Rapier world, for the query and escape-hatch paths.
   *
   * @returns The world handle.
   */
  get world(): RapierWorld {
    return this.#world;
  }

  /**
   * Whether at least one fixed step has run, which is what Rapier's broadphase needs before a query
   * can answer (`09-physics.md` §5, spike S6.2).
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
  get records(): readonly BodyRecord2D[] {
    return this.#records;
  }

  /**
   * The resolved settings.
   *
   * @returns The `physics2d` section.
   */
  get settings(): Physics2DSettings {
    return this.#settings;
  }

  /**
   * Replaces world gravity.
   *
   * @param gravity - The new acceleration vector.
   */
  setGravity(gravity: Vec2Like): void {
    setGravity(this.#world, gravity);
  }

  /**
   * Marks an entity's body for a rebuild at the start of the next fixed step.
   *
   * @param entity - The entity whose colliders, `Rigidbody2D`, or controller changed.
   */
  markDirty(entity: Entity): void {
    if (!this.#disposed && !entity.isDestroyed) {
      this.#dirty.add(entity);
    }
  }

  /**
   * Marks a character controller's entity for a rebuild.
   *
   * @param component - The controller component.
   */
  markControllerDirty(component: CharacterController2D): void {
    this.markDirty(component.entity);
  }

  /**
   * Drops a character controller's body, which is what detaching the component does.
   *
   * @param component - The controller component.
   */
  releaseController(component: CharacterController2D): void {
    this.markDirty(component.entity);
  }

  /**
   * The Rapier body of an entity, for the escape hatch.
   *
   * @param entity - The entity.
   * @returns The body handle, or `null`.
   */
  bodyHandleOf(entity: Entity): BodyRecord2D["body"] | null {
    return this.#byEntity.get(entity)?.body ?? null;
  }

  /**
   * The record an entity owns.
   *
   * @param entity - The entity.
   * @returns The record, or `null`.
   */
  recordOf(entity: Entity): BodyRecord2D | null {
    return this.#byEntity.get(entity) ?? null;
  }

  /**
   * The entity and collider a Rapier collider belongs to, which is how a query result or an event
   * becomes an ignifx object.
   *
   * @param collider - The Rapier collider, or `null`.
   * @returns The binding, or `null`.
   */
  bindingOf(collider: RapierCollider | null): ColliderBinding | null {
    return collider === null ? null : (this.#byCollider.get(colliderHandle(collider)) ?? null);
  }

  /**
   * The mass Rapier computed for an entity's body.
   *
   * @param entity - The entity.
   * @returns Kilograms, or `0` when there is no body.
   */
  massOf(entity: Entity): number {
    const record = this.#byEntity.get(entity);
    return record === undefined ? 0 : bodyMass(record.body);
  }

  /**
   * Reads a body's linear velocity.
   *
   * @param entity - The entity.
   * @param out - The vector to write; left untouched when there is no body.
   */
  readLinear(entity: Entity, out: MutableVec2): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      readLinearVelocity(record.body, out);
    }
  }

  /**
   * Reads a body's angular velocity.
   *
   * @param entity - The entity.
   * @returns Degrees per second, counter-clockwise.
   */
  readAngular(entity: Entity): number {
    const record = this.#byEntity.get(entity);
    return record === undefined ? 0 : toDegrees(readAngularVelocity(record.body));
  }

  /**
   * Sets a body's linear velocity.
   *
   * @param entity - The entity.
   * @param velocity - Metres per second.
   */
  setLinearVelocity(entity: Entity, velocity: Vec2Like): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      writeLinearVelocity(record.body, velocity);
    }
  }

  /**
   * Sets a body's angular velocity.
   *
   * @param entity - The entity.
   * @param velocity - Degrees per second.
   */
  setAngularVelocity(entity: Entity, velocity: number): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      writeAngularVelocity(record.body, toRadians(velocity));
    }
  }

  /**
   * Applies a force for one fixed step.
   *
   * @param entity - The entity.
   * @param force - Newtons.
   * @param point - The application point, or `null` for the centre of mass.
   */
  addForce(entity: Entity, force: Vec2Like, point: Vec2Like | null): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      addForce(record.body, force, point);
    }
  }

  /**
   * Applies an impulse.
   *
   * @param entity - The entity.
   * @param impulse - Newton-seconds.
   * @param point - The application point, or `null` for the centre of mass.
   */
  addImpulse(entity: Entity, impulse: Vec2Like, point: Vec2Like | null): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      applyImpulse(record.body, impulse, point);
    }
  }

  /**
   * Applies a torque for one fixed step.
   *
   * @param entity - The entity.
   * @param torque - Newton-metres, positive counter-clockwise.
   */
  addTorque(entity: Entity, torque: number): void {
    const record = this.#byEntity.get(entity);
    if (record !== undefined) {
      addTorque(record.body, torque);
    }
  }

  /**
   * Teleports a body and resets its interpolation history.
   *
   * @param entity - The entity.
   * @param position - The new world position.
   * @param rotationDegrees - The new rotation in degrees counter-clockwise.
   */
  teleport(entity: Entity, position: Vec2Like, rotationDegrees: number): void {
    const record = this.#byEntity.get(entity);
    this.#writeTransform(entity, position, rotationDegrees);
    if (record === undefined) {
      return;
    }
    const radians = toRadians(rotationDegrees);
    setBodyPose(record.body, position, radians);
    record.currentPosition.set(position.x, position.y);
    record.previousPosition.set(position.x, position.y);
    record.currentRotation = radians;
    record.previousRotation = radians;
    this.#colliderSetChanged = true;
  }

  /**
   * Teleports a character controller.
   *
   * @param component - The controller component.
   * @param position - The new world position.
   */
  teleportController(component: CharacterController2D, position: Vec2Like): void {
    this.teleport(component.entity, position, component.transform.rotation2D);
  }

  /**
   * Restores the authoritative pose of every interpolated body, undoing the display pose the
   * `PreRender` system wrote (`09-physics.md` §1).
   */
  restorePoses(): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record !== undefined && record.interpolate) {
        this.#writeTransform(record.entity, record.currentPosition, toDegrees(record.currentRotation));
      }
    }
  }

  /**
   * Runs one fixed step: reconcile, push kinematic poses, move controllers, step Rapier, snapshot,
   * dispatch events.
   *
   * @param fixedDeltaSeconds - The fixed step in seconds.
   */
  step(fixedDeltaSeconds: number): void {
    this.#syncLayers();
    this.#pollTilemaps();
    this.#reconcile();
    this.#pushKinematicPoses();
    setTimestep(this.#world, fixedDeltaSeconds);
    const started = now();
    if (this.#colliderSetChanged || !this.#stepped) {
      // Rapier only refreshes its broadphase inside `step`, so a collider created since the last
      // one is invisible to the character controller and to queries (S6.2). A zero-length step
      // rebuilds it; it is skipped whenever the collider set is unchanged, because it perturbs a
      // running simulation.
      primeWorld(this.#world, this.#queue);
      this.#colliderSetChanged = false;
    }
    this.#refreshOneWayPlatforms();
    this.#moveControllers(fixedDeltaSeconds);
    this.#capturePreStepVelocities();
    stepWorld(this.#world, this.#queue);
    this.#stepMs += now() - started;
    this.#stepsThisFrame += 1;
    this.#stepped = true;
    this.#snapshot();
    this.#dispatchEvents();
  }

  /**
   * Writes the interpolated display pose of every interpolated body.
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
      this.#scratchVector.set(
        lerp(record.previousPosition.x, record.currentPosition.x, alpha),
        lerp(record.previousPosition.y, record.currentPosition.y, alpha),
      );
      const rotation = record.previousRotation + shortestArc(record.previousRotation, record.currentRotation) * alpha;
      this.#writeTransform(record.entity, this.#scratchVector, toDegrees(rotation));
    }
  }

  /** Tears every body down and releases the Rapier world. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index];
      if (record !== undefined) {
        this.#teardown(record);
      }
    }
    this.#records.length = 0;
    this.#byEntity.clear();
    this.#byCollider.clear();
    this.#controllers.clear();
    this.#pairs.clear();
    destroyEventQueue(this.#queue);
    destroyWorld(this.#world);
  }

  /**
   * Publishes the frame's counters and zeroes the accumulators. `PreRender` is where a frame's fixed
   * steps are all done.
   */
  #publishCounters(): void {
    this.#counters.set(this.#counters.index("bodies"), this.#records.length);
    this.#counters.set(this.#counters.index("colliders"), this.#colliderCount);
    this.#counters.set(this.#counters.index("stepsThisFrame"), this.#stepsThisFrame);
    this.#counters.set(this.#counters.index("collisionEvents"), this.#collisionEventCount);
    this.#counters.set(this.#counters.index("triggerEvents"), this.#triggerEventCount);
    this.#counters.set(this.#counters.index("stepMs"), this.#stepMs);
    this.#stepsThisFrame = 0;
    this.#collisionEventCount = 0;
    this.#triggerEventCount = 0;
    this.#stepMs = 0;
  }

  /**
   * Builds the per-layer collide masks from `physics2d.collisionMatrix` (`09-physics.md` §3).
   *
   * @throws IgnifxError with code `IGX-1155` when a name is not a declared layer, and reports
   * `IGX-1152` for a layer Rapier's sixteen interaction groups cannot express.
   */
  #buildCollideMasks(): void {
    for (const [name, others] of Object.entries(this.#settings.collisionMatrix)) {
      const index = this.#layerIndex(name);
      let mask = 0;
      for (const other of others) {
        mask |= 1 << this.#layerIndex(other);
      }
      this.#collideMasks[index] = mask;
    }
  }

  /**
   * Resolves a layer name to its index, refusing an undeclared one.
   *
   * @param name - The layer name.
   * @returns The index, clamped into Rapier's sixteen.
   * @throws IgnifxError with code `IGX-1155` when the project does not declare the layer.
   */
  #layerIndex(name: string): number {
    const index = this.#ctx.app.world.layers.indexOf(name);
    if (index < 0) {
      throw physics2DError(Physics2DErrorCode.unknownLayer, `${name} is not a layer this project declares.`, {
        context: { layer: name },
        hint: "Add the layer to the layers settings section, or fix the name in physics2d.collisionMatrix.",
      });
    }
    return this.#clampLayer(index, name);
  }

  /**
   * Reports a layer Rapier cannot express and falls back to layer 0.
   *
   * @param layer - The layer index.
   * @param subject - What the diagnostic names.
   * @returns The layer to use.
   */
  #clampLayer(layer: number, subject: string): number {
    if (layer < RAPIER_LAYER_LIMIT) {
      return layer;
    }
    this.#ctx.log.warn(
      `${Physics2DErrorCode.layerOutOfRange}: {entity} is on layer {layer}, which is outside the sixteen layers Rapier 2D can filter by.`,
      subject,
      String(layer),
    );
    return 0;
  }

  /** Marks every entity whose layer changed since its body was built. */
  #syncLayers(): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record !== undefined && record.entity.layer !== record.layer) {
        this.markDirty(record.entity);
      }
    }
  }

  /** Marks every entity whose tilemap collision data changed since its shapes were built. */
  #pollTilemaps(): void {
    const colliders = this.#ctx.app.world.components(TilemapCollider2D);
    for (let index = 0; index < colliders.length; index += 1) {
      const collider = colliders[index];
      if (collider !== undefined && collider.needsRebuild()) {
        this.markDirty(collider.entity);
      }
    }
  }

  /** Rebuilds every body marked dirty. */
  #reconcile(): void {
    if (this.#dirty.size === 0) {
      return;
    }
    const pending = [...this.#dirty];
    this.#dirty.clear();
    for (const entity of pending) {
      this.#rebuildEntity(entity);
    }
    this.#colliderSetChanged = true;
  }

  /**
   * Tears an entity's body down and builds a new one from its current components.
   *
   * @param entity - The entity to rebuild.
   */
  #rebuildEntity(entity: Entity): void {
    const existing = this.#byEntity.get(entity);
    let carriedLinear: Vec2 | null = null;
    let carriedAngular = 0;
    if (existing !== undefined) {
      if (existing.motion === BodyMotion2D.dynamic) {
        carriedLinear = new Vec2();
        readLinearVelocity(existing.body, carriedLinear);
        carriedAngular = readAngularVelocity(existing.body);
      }
      this.#removeRecord(entity);
    }
    if (entity.isDestroyed || !entity.activeInHierarchy) {
      return;
    }
    const controller = entity.getComponent(CharacterController2D);
    const colliders = collidersOf(entity);
    if (colliders.length === 0 && controller === null) {
      return;
    }
    if (entity.parent !== null) {
      this.#ctx.log.warn(
        `${Physics2DErrorCode.bodyOnChildEntity}: {entity} carries a 2D physics body but is not a root entity; Rapier writes its world pose.`,
        entity.name,
      );
    }
    const record = this.#build(entity, entity.getComponent(Rigidbody2D), controller, colliders);
    if (record === null) {
      return;
    }
    this.#records.push(record);
    if (record.motion === BodyMotion2D.dynamic && carriedLinear !== null) {
      writeLinearVelocity(record.body, carriedLinear);
      writeAngularVelocity(record.body, carriedAngular);
    }
  }

  /**
   * Builds one body from an entity's colliders and controller.
   *
   * @param entity - The entity.
   * @param rigidbody - Its `Rigidbody2D`, or `null`.
   * @param controller - Its `CharacterController2D`, or `null`.
   * @param colliders - Its colliders, in component order.
   * @returns The new record, or `null` when nothing produced a shape — a `TilemapCollider2D` whose
   * tilemap has not published its geometry yet, say, which must not leave an empty body behind.
   */
  #build(
    entity: Entity,
    rigidbody: Rigidbody2D | null,
    controller: CharacterController2D | null,
    colliders: readonly Collider2D[],
  ): BodyRecord2D | null {
    const transform = entity.transform;
    transform.positionToRef(this.#scratchPose);
    const rotation = toRadians(transform.rotation2D);
    const layer = this.#clampLayer(entity.layer, entity.name);
    const motion = motionOf(rigidbody, controller);
    const body = createBody(this.#world, {
      motion,
      position: { x: this.#scratchPose.x, y: this.#scratchPose.y },
      rotation,
      gravityScale: rigidbody?.gravityScale ?? 1,
      linearDamping: rigidbody?.linearDamping ?? 0,
      angularDamping: rigidbody?.angularDamping ?? 0,
      freezeRotation: rigidbody?.freezeRotation ?? controller !== null,
      additionalMass: 0,
      startAsleep: false,
    });
    const record: BodyRecord2D = {
      entity,
      rigidbody,
      controller,
      body,
      colliders: [],
      owners: [],
      controllerCollider: null,
      motion,
      interpolate: this.#shouldInterpolate(rigidbody, controller, motion),
      layer,
      collisionEvents: false,
      previousPosition: new Vec2(this.#scratchPose.x, this.#scratchPose.y),
      previousRotation: rotation,
      currentPosition: new Vec2(this.#scratchPose.x, this.#scratchPose.y),
      currentRotation: rotation,
      preStepVelocity: new Vec2(),
      staticVersion: transform.worldMatrixVersion,
      reportedMove: false,
      disconnects: [],
    };
    this.#byEntity.set(entity, record);
    this.#attachColliders(record, colliders, layer);
    if (controller !== null) {
      this.#attachController(record, controller, layer);
    }
    if (record.colliders.length === 0) {
      this.#byEntity.delete(entity);
      destroyBody(this.#world, body);
      return null;
    }
    this.#applyMass(record);
    this.#applyCollisionEvents(record);
    this.#watchEntity(record);
    return record;
  }

  /**
   * Builds and registers every Rapier collider an entity's authored colliders stand for.
   *
   * @param record - The record being built.
   * @param colliders - The authored colliders.
   * @param layer - The entity's clamped layer.
   */
  #attachColliders(record: BodyRecord2D, colliders: readonly Collider2D[], layer: number): void {
    const defaults = this.#settings.defaultMaterial;
    const shapes: CollectedShape2D[] = [];
    for (const collider of colliders) {
      shapes.length = 0;
      collider.collectShapes(record.entity.transform.lossyScale, shapes);
      const effective = collider.layerOverride === "" ? layer : this.#layerIndex(collider.layerOverride);
      const material = collider.resolveMaterial(defaults);
      for (const collected of shapes) {
        this.#addCollider(record, collider, collected, effective, material);
      }
    }
  }

  /**
   * Creates one Rapier collider and binds it back to its author.
   *
   * @param record - The record it belongs to.
   * @param owner - The authored collider, or `null` for a controller shape.
   * @param collected - The geometry and its placement.
   * @param layer - The layer to filter as.
   * @param material - The surface.
   * @returns The created collider, or `null` when Rapier refused the geometry.
   */
  #addCollider(
    record: BodyRecord2D,
    owner: Collider2D | null,
    collected: CollectedShape2D,
    layer: number,
    material: Physics2DMaterialValues,
  ): RapierCollider | null {
    const collider = createCollider(this.#world, record.body, collected.shape, {
      offset: collected.offset,
      rotation: collected.rotation,
      sensor: owner?.isTrigger === true,
      groups: interactionGroups(1 << layer, this.#collideMasks[layer] ?? ALL_LAYER_BITS),
      friction: material.friction,
      restitution: material.restitution,
      frictionCombine: owner?.frictionCombine ?? "average",
      restitutionCombine: owner?.restitutionCombine ?? "average",
      events: owner?.isTrigger === true,
    });
    if (collider === null) {
      this.#ctx.log.warn(
        `${Physics2DErrorCode.colliderGeometryInvalid}: {entity} has a 2D collider whose geometry Rapier cannot build a shape from.`,
        record.entity.name,
      );
      return null;
    }
    const handle = colliderHandle(collider);
    record.colliders.push(collider);
    record.owners.push(owner);
    this.#byCollider.set(handle, { record, owner, collider });
    this.#colliderCount += 1;
    if (collected.oneWay) {
      this.#oneWay.set(handle, { collider, halfHeight: topOf(collected.shape) + collected.offset.y, top: 0 });
    }
    return collider;
  }

  /**
   * Builds a character controller's own shape and Rapier controller.
   *
   * @param record - The record being built.
   * @param controller - The component.
   * @param layer - The entity's clamped layer.
   */
  #attachController(record: BodyRecord2D, controller: CharacterController2D, layer: number): void {
    const half = Math.max(0, controller.height / 2 - controller.radius);
    const shape: CollectedShape2D = {
      shape:
        controller.shape === "box"
          ? {
              kind: "box",
              halfWidth: controller.radius,
              halfHeight: Math.max(controller.radius, controller.height / 2),
            }
          : { kind: "capsule", halfHeight: half, radius: controller.radius },
      offset: controller.offset,
      rotation: 0,
      oneWay: false,
    };
    const collider = this.#addCollider(record, null, shape, layer, this.#settings.defaultMaterial);
    record.controllerCollider = collider;
    if (collider === null) {
      return;
    }
    const rapierController = createController(this.#world, Math.max(controller.skinWidth, 1e-3));
    tuneController(rapierController, {
      slopeLimit: toRadians(controller.slopeLimit),
      slideLimit: toRadians(controller.slopeLimit),
      stepOffset: controller.stepOffset,
      stepMinWidth: AUTOSTEP_MIN_WIDTH,
      snapToGround: controller.snapToGround,
      pushBodies: controller.pushBodies,
    });
    this.#controllers.set(colliderHandle(collider), rapierController);
  }

  /**
   * Scales the colliders' densities so the body weighs exactly `Rigidbody2D.mass`.
   *
   * @param record - The record being built.
   */
  #applyMass(record: BodyRecord2D): void {
    const wanted = record.rigidbody?.mass ?? 0;
    if (record.motion !== BodyMotion2D.dynamic || wanted <= 0) {
      return;
    }
    const current = bodyMass(record.body);
    if (current <= 0) {
      return;
    }
    const density = wanted / current;
    for (const collider of record.colliders) {
      setColliderDensity(collider, density);
    }
    recomputeMass(record.body);
  }

  /**
   * Keeps a record in step with its entity: component changes rebuild, destruction removes.
   *
   * @param record - The record to watch.
   */
  #watchEntity(record: BodyRecord2D): void {
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
   * Recomputes `collisionEvents` when a component joins or leaves the entity.
   *
   * @param record - The body record.
   * @param component - The component that changed.
   */
  #onComponentChanged(record: BodyRecord2D, component: Component): void {
    if (
      component instanceof Collider2D ||
      component instanceof Rigidbody2D ||
      component instanceof CharacterController2D
    ) {
      this.markDirty(record.entity);
      return;
    }
    this.#applyCollisionEvents(record);
  }

  /**
   * Pushes the effective `collisionEvents` value to every collider of a body.
   *
   * @param record - The body record.
   */
  #applyCollisionEvents(record: BodyRecord2D): void {
    const mode = record.rigidbody?.collisionEvents ?? "auto";
    const enabled = mode === "on" ? true : mode === "off" ? false : this.#entityWantsEvents(record.entity);
    if (enabled === record.collisionEvents) {
      return;
    }
    record.collisionEvents = enabled;
    for (let index = 0; index < record.colliders.length; index += 1) {
      const collider = record.colliders[index];
      const owner = record.owners[index];
      if (collider !== undefined) {
        // A sensor always reports: a trigger volume nobody listens to is free, and a trigger volume
        // whose *other* side listens must still raise the pair.
        setColliderEvents(collider, enabled || owner?.isTrigger === true);
      }
    }
  }

  /**
   * Whether any script on an entity implements a physics callback.
   *
   * @param entity - The entity.
   * @returns `true` when at least one does.
   */
  #entityWantsEvents(entity: Entity): boolean {
    return (
      this.#ctx.entityImplements(entity, "onCollisionEnter") ||
      this.#ctx.entityImplements(entity, "onCollisionStay") ||
      this.#ctx.entityImplements(entity, "onCollisionExit") ||
      this.#ctx.entityImplements(entity, "onTriggerEnter") ||
      this.#ctx.entityImplements(entity, "onTriggerExit")
    );
  }

  /**
   * Drops an entity's body immediately.
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
    this.#dirty.delete(entity);
    this.#colliderSetChanged = true;
  }

  /**
   * Releases one record's Rapier resources, signal connections, and index entries.
   *
   * @param record - The record to tear down.
   */
  #teardown(record: BodyRecord2D): void {
    for (const disconnect of record.disconnects) {
      disconnect();
    }
    record.disconnects = [];
    for (const collider of record.colliders) {
      const handle = colliderHandle(collider);
      const controller = this.#controllers.get(handle);
      if (controller !== undefined) {
        destroyController(this.#world, controller);
        this.#controllers.delete(handle);
      }
      this.#byCollider.delete(handle);
      this.#oneWay.delete(handle);
      this.#dropPairs(handle);
      this.#colliderCount -= 1;
    }
    record.colliders = [];
    record.owners = [];
    record.controllerCollider = null;
    // Removing the body removes its colliders with it (`pipeline/world.d.ts`, `removeRigidBody`).
    destroyBody(this.#world, record.body);
  }

  /**
   * Forgets every touching pair a departing collider took part in.
   *
   * @param handle - The collider handle.
   */
  #dropPairs(handle: number): void {
    for (const [key, pair] of this.#pairs) {
      if (pair.first === handle || pair.second === handle) {
        this.#pairs.delete(key);
      }
    }
  }

  /** Pushes every kinematic body's authored transform into Rapier before the step. */
  #pushKinematicPoses(): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record === undefined || record.motion !== BodyMotion2D.kinematic || record.controller !== null) {
        continue;
      }
      const transform = record.entity.transform;
      transform.positionToRef(this.#scratchPose);
      setNextKinematicPose(
        record.body,
        this.#scratchVector.set(this.#scratchPose.x, this.#scratchPose.y),
        toRadians(transform.rotation2D),
      );
    }
  }

  /** Caches every one-way platform's world top, so the move filter needs no Rapier call. */
  #refreshOneWayPlatforms(): void {
    for (const platform of this.#oneWay.values()) {
      readColliderTranslation(platform.collider, this.#filterScratch);
      platform.top = this.#filterScratch.y + platform.halfHeight;
    }
  }

  /**
   * Remembers every event-reporting body's velocity before the solver runs, so a collision callback
   * can report the speed the two bodies met at rather than the one they left with.
   */
  #capturePreStepVelocities(): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record !== undefined && record.collisionEvents) {
        readLinearVelocity(record.body, record.preStepVelocity);
      }
    }
  }

  /**
   * Hands every character controller its accumulated displacement and turns the resolved movement
   * into a kinematic target.
   *
   * @param fixedDeltaSeconds - The fixed step.
   */
  #moveControllers(fixedDeltaSeconds: number): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      const component = record?.controller ?? null;
      const collider = record?.controllerCollider ?? null;
      if (record === undefined || component === null || collider === null) {
        continue;
      }
      const rapierController = this.#controllers.get(colliderHandle(collider));
      if (rapierController === undefined) {
        continue;
      }
      const desired = component.takePendingMove();
      this.#filterDesiredY = desired.y;
      this.#filterFeet = record.currentPosition.y + component.offset.y - halfHeightOf(component);
      const grounded = computeControllerMovement(
        rapierController,
        collider,
        desired,
        interactionGroups(1 << record.layer, this.#collideMasks[record.layer] ?? ALL_LAYER_BITS),
        component.onOneWayPlatforms ? this.#oneWayFilter : null,
        this.#movement,
      );
      const normal = this.#collectControllerHits(rapierController, component);
      component.applyStepResult(this.#movement, grounded, normal, fixedDeltaSeconds);
      setNextKinematicPose(
        record.body,
        this.#scratchVector.set(
          record.currentPosition.x + this.#movement.x,
          record.currentPosition.y + this.#movement.y,
        ),
        record.currentRotation,
      );
    }
  }

  /**
   * The one-way platform predicate, bound once so the per-step move allocates nothing.
   *
   * Rapier runs it from inside WebAssembly, so it reads only plain JavaScript state:
   * {@link Physics2DRuntime.#refreshOneWayPlatforms} caches every platform's world top *before* the
   * move, because calling back into Rapier (`collider.translation()`) from inside the callback is a
   * re-entrant WebAssembly call and the obstacle is then never actually excluded (measured, S6.2).
   *
   * @param collider - The obstacle Rapier is considering.
   * @returns `false` when the obstacle should be ignored this step.
   */
  readonly #oneWayFilter = (collider: RapierCollider): boolean => {
    const platform = this.#oneWay.get(colliderHandle(collider));
    if (platform === undefined) {
      return true;
    }
    // Solid only when the character is coming down and its feet already cleared the platform's top.
    return this.#filterDesiredY <= 0 && this.#filterFeet >= platform.top - ONE_WAY_TOLERANCE;
  };

  /**
   * Reports every obstacle a controller hit and returns the most upward-facing normal.
   *
   * @param rapierController - Rapier's controller.
   * @param component - The component.
   * @returns The ground normal, or `null` when nothing was hit.
   */
  #collectControllerHits(rapierController: RapierController, component: CharacterController2D): Vec2Like | null {
    const count = controllerHitCount(rapierController);
    let best: Vec2Like | null = null;
    let bestY = -2;
    for (let index = 0; index < count; index += 1) {
      if (!readControllerHit(rapierController, index, this.#controllerHit)) {
        continue;
      }
      const normal = this.#controllerHit.normal;
      if (normal.y > bestY) {
        bestY = normal.y;
        this.#groundNormal.set(normal.x, normal.y);
        best = this.#groundNormal;
      }
      const binding = this.bindingOf(this.#controllerHit.collider);
      const event: MutableCharacterCollision = (this.#characterCollision ??= {
        other: null,
        otherCollider: null,
        point: this.#controllerHit.point,
        normal: this.#controllerHit.normal,
      });
      event.other = binding?.record.entity ?? null;
      event.otherCollider = binding?.owner ?? null;
      component.reportHit(event);
    }
    return best;
  }

  /** Snapshots every body's authoritative pose and writes it onto the entity. */
  #snapshot(): void {
    for (let index = 0; index < this.#records.length; index += 1) {
      const record = this.#records[index];
      if (record === undefined) {
        continue;
      }
      record.previousPosition.copyFrom(record.currentPosition);
      record.previousRotation = record.currentRotation;
      record.currentRotation = readBodyPose(record.body, record.currentPosition);
      if (record.motion === BodyMotion2D.static && record.rigidbody === null && record.controller === null) {
        this.#checkStaticMove(record);
        continue;
      }
      this.#writeTransform(record.entity, record.currentPosition, toDegrees(record.currentRotation));
    }
  }

  /**
   * Reports `IGX-1151` once for an implicit static body whose transform moved.
   *
   * @param record - The body record.
   */
  #checkStaticMove(record: BodyRecord2D): void {
    const version = record.entity.transform.worldMatrixVersion;
    if (version === record.staticVersion || record.reportedMove) {
      return;
    }
    record.entity.transform.positionToRef(this.#scratchPose);
    if (
      Math.abs(this.#scratchPose.x - record.currentPosition.x) < STATIC_MOVE_EPSILON &&
      Math.abs(this.#scratchPose.y - record.currentPosition.y) < STATIC_MOVE_EPSILON
    ) {
      record.staticVersion = version;
      return;
    }
    record.staticVersion = version;
    record.reportedMove = true;
    this.#ctx.log.warn(
      `${Physics2DErrorCode.movedStaticBody}: {entity} has 2D colliders but no Rigidbody2D, and it moved after its body was placed.`,
      record.entity.name,
    );
  }

  /**
   * Writes a 2D pose onto an entity without disturbing its Z.
   *
   * @param entity - The entity.
   * @param position - The world position in metres.
   * @param rotationDegrees - The rotation in degrees counter-clockwise.
   */
  #writeTransform(entity: Entity, position: Vec2Like, rotationDegrees: number): void {
    const transform = entity.transform;
    transform.positionToRef(this.#scratchPose);
    this.#scratchPose.set(position.x, position.y, this.#scratchPose.z);
    transform.position = this.#scratchPose;
    transform.rotation2D = rotationDegrees;
  }

  /** Drains Rapier's event queue and delivers enter, stay, and exit to both participants. */
  #dispatchEvents(): void {
    this.#startedPairs.length = 0;
    this.#endedPairs.length = 0;
    drainCollisions(this.#queue, (event): void => {
      const key = pairKey(event.first, event.second);
      if (!event.started) {
        const existing = this.#pairs.get(key);
        if (existing !== undefined) {
          this.#pairs.delete(key);
          this.#endedPairs.push(existing);
        }
        return;
      }
      const first = this.#byCollider.get(event.first);
      const second = this.#byCollider.get(event.second);
      if (first === undefined || second === undefined) {
        return;
      }
      const pair: PairState = {
        first: event.first,
        second: event.second,
        sensor: isColliderSensor(first.collider) || isColliderSensor(second.collider),
        entered: true,
      };
      this.#pairs.set(key, pair);
      this.#startedPairs.push(pair);
    });
    for (const pair of this.#endedPairs) {
      this.#deliverPair(pair, "exit");
    }
    for (const pair of this.#startedPairs) {
      this.#deliverPair(pair, "enter");
    }
    for (const pair of this.#pairs.values()) {
      if (pair.entered) {
        pair.entered = false;
        continue;
      }
      this.#deliverPair(pair, "stay");
    }
  }

  /**
   * Delivers one pair's event to both participants.
   *
   * @param pair - The touching pair.
   * @param phase - Which callback to deliver.
   */
  #deliverPair(pair: PairState, phase: "enter" | "stay" | "exit"): void {
    const first = this.#byCollider.get(pair.first);
    const second = this.#byCollider.get(pair.second);
    if (first === undefined || second === undefined) {
      return;
    }
    if (pair.sensor) {
      if (phase === "stay") {
        return;
      }
      this.#triggerEventCount += 1;
      const kind: PhysicsCallbackName = phase === "enter" ? "onTriggerEnter" : "onTriggerExit";
      this.#deliverTrigger(first, second, kind);
      this.#deliverTrigger(second, first, kind);
      return;
    }
    this.#collisionEventCount += 1;
    const kind: PhysicsCallbackName =
      phase === "enter" ? "onCollisionEnter" : phase === "exit" ? "onCollisionExit" : "onCollisionStay";
    this.#readContacts(pair, phase);
    this.#deliverCollision(first, second, kind);
    this.#deliverCollision(second, first, kind);
  }

  /**
   * Fills the pooled contact point for a collision event.
   *
   * @param pair - The touching pair.
   * @param phase - Which callback is being delivered; an exit has no contact left to read.
   */
  #readContacts(pair: PairState, phase: "enter" | "stay" | "exit"): void {
    this.#contactPoint.impulse = 0;
    if (phase === "exit") {
      return;
    }
    const first = this.#byCollider.get(pair.first);
    const second = this.#byCollider.get(pair.second);
    if (first === undefined || second === undefined) {
      return;
    }
    readContact(this.#world, first.collider, second.collider, this.#contact);
    if (!this.#contact.touching) {
      return;
    }
    this.#contactPoint.point.copyFrom(this.#contact.point);
    this.#contactPoint.normal.copyFrom(this.#contact.normal);
    this.#contactPoint.impulse = this.#contact.impulse;
  }

  /**
   * Delivers one trigger callback to one entity.
   *
   * @param target - The binding whose scripts receive it.
   * @param other - The other participant.
   * @param kind - Which callback to deliver.
   */
  #deliverTrigger(target: ColliderBinding, other: ColliderBinding, kind: PhysicsCallbackName): void {
    if (target.record.entity.isDestroyed) {
      return;
    }
    const event: MutableTrigger = (this.#trigger ??= {
      other: null,
      otherCollider: null,
      self: target.record.entity,
      selfCollider: null,
    });
    event.self = target.record.entity;
    event.selfCollider = target.owner;
    event.other = other.record.entity;
    event.otherCollider = other.owner;
    this.#ctx.dispatchScriptCallback(target.record.entity, kind, event);
  }

  /**
   * Delivers one collision callback to one entity.
   *
   * @param target - The binding whose scripts receive it.
   * @param other - The other participant.
   * @param kind - Which callback to deliver.
   */
  #deliverCollision(target: ColliderBinding, other: ColliderBinding, kind: PhysicsCallbackName): void {
    if (target.record.entity.isDestroyed || !target.record.collisionEvents) {
      return;
    }
    this.#relativeVelocity.set(
      target.record.preStepVelocity.x - other.record.preStepVelocity.x,
      target.record.preStepVelocity.y - other.record.preStepVelocity.y,
    );
    const collision: MutableCollision = (this.#collision ??= {
      other: null,
      otherCollider: null,
      self: target.record.entity,
      selfCollider: null,
      contacts: this.#contacts,
      relativeVelocity: this.#relativeVelocity,
    });
    collision.self = target.record.entity;
    collision.selfCollider = target.owner;
    collision.other = other.record.entity;
    collision.otherCollider = other.owner;
    this.#ctx.dispatchScriptCallback(target.record.entity, kind, collision);
  }

  /**
   * Whether a body's display pose is interpolated.
   *
   * @param rigidbody - The `Rigidbody2D`, or `null`.
   * @param controller - The `CharacterController2D`, or `null`.
   * @param motion - The motion type.
   * @returns `true` when interpolation applies.
   */
  #shouldInterpolate(
    rigidbody: Rigidbody2D | null,
    controller: CharacterController2D | null,
    motion: BodyMotion2D,
  ): boolean {
    if (!this.#settings.interpolation || motion === BodyMotion2D.static) {
      return false;
    }
    if (controller !== null) {
      return controller.interpolation === "interpolate";
    }
    return rigidbody !== null && rigidbody.interpolation === "interpolate";
  }
}

/** How far below a one-way platform's top the character's feet may be and still land on it. */
const ONE_WAY_TOLERANCE = 0.02;

/**
 * The colliders that make up an entity's body: every enabled `Collider2D` on the entity itself.
 *
 * @param entity - The entity.
 * @returns The colliders, in component order.
 */
function collidersOf(entity: Entity): readonly Collider2D[] {
  const found: Collider2D[] = [];
  const components = entity.components;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component instanceof Collider2D && component.enabled && !component.isDestroyed) {
      found.push(component);
    }
  }
  return found;
}

/**
 * The motion type a body takes.
 *
 * @param rigidbody - The component, or `null`.
 * @param controller - The character controller, or `null`.
 * @returns The motion type; a controller is always kinematic.
 */
function motionOf(rigidbody: Rigidbody2D | null, controller: CharacterController2D | null): BodyMotion2D {
  if (controller !== null) {
    return BodyMotion2D.kinematic;
  }
  if (rigidbody === null || rigidbody.bodyType === "static") {
    return BodyMotion2D.static;
  }
  return rigidbody.bodyType === "kinematic" ? BodyMotion2D.kinematic : BodyMotion2D.dynamic;
}

/**
 * How far a shape reaches above its own origin, which is what a one-way platform's top is measured
 * from.
 *
 * @param shape - The geometry.
 * @returns The half-height in metres.
 */
function topOf(shape: CollectedShape2D["shape"]): number {
  if (shape.kind === "box") {
    return shape.halfHeight;
  }
  if (shape.kind === "circle") {
    return shape.radius;
  }
  if (shape.kind === "capsule") {
    return shape.halfHeight + shape.radius;
  }
  let top = 0;
  for (let index = 1; index < shape.points.length; index += 2) {
    top = Math.max(top, shape.points[index] ?? 0);
  }
  return top;
}

/**
 * Half a character controller's total height, including its caps.
 *
 * @param component - The controller.
 * @returns The half-height in metres.
 */
function halfHeightOf(component: CharacterController2D): number {
  return Math.max(component.radius, component.height / 2);
}

/**
 * The map key of one collider pair, order-independent.
 *
 * @param first - One handle.
 * @param second - The other.
 * @returns The key.
 */
function pairKey(first: number, second: number): string {
  return first < second ? `${String(first)}:${String(second)}` : `${String(second)}:${String(first)}`;
}

/**
 * The shortest signed angular difference between two angles, so interpolation never spins the long
 * way round.
 *
 * @param from - The start angle in radians.
 * @param to - The end angle in radians.
 * @returns The signed difference in `(-π, π]`.
 */
function shortestArc(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  const delta = ((((to - from + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
  return delta;
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
