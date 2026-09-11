import {
  bool,
  clamp,
  createDefaults,
  defineSchema,
  entityRef,
  f32,
  layerMask,
  LayerMask,
  Quat,
  RAD_TO_DEG,
  Script,
  str,
  vec3,
  Vec3,
} from "@ignifx/core";
import { LookInput } from "../character/look-input.js";
import type { Entity, MutableVec3, Schema, Vec3Like } from "@ignifx/core";

/**
 * Follow the animated target in `lateUpdate`. A sphere sweep shortens the camera boom immediately
 * at an obstacle; only the return is damped, so the camera never eases through a wall.
 *
 * Build rotation as `Ry(yaw) * Rx(pitch)` to keep yaw about world up and the horizon level.
 * Seed the angles from the forward vector so authored rotations use the same convention.
 */

/** How far short of a hit the camera stops, in metres, so it never sits inside the surface. */
const COLLISION_PADDING = 0.08;

/** The default stick look rate, in degrees per second at full deflection. */
const DEFAULT_STICK_LOOK_SPEED = 180;

/**
 * Builds the `ThirdPersonCamera` field declarations.
 *
 * @returns The schema.
 */
function thirdPersonCameraSchema(): Schema {
  return defineSchema({
    target: entityRef({ tooltip: "The entity the camera orbits." }),
    lookAction: str("Look", { tooltip: "The vector2 action that orbits the camera." }),
    distance: f32(4.5, { min: 0, tooltip: "How far behind the target the camera sits, in metres." }),
    minPitch: f32(-30, { min: -89, max: 89, tooltip: "The lowest pitch, in degrees." }),
    maxPitch: f32(60, { min: -89, max: 89, tooltip: "The highest pitch, in degrees." }),
    sensitivity: f32(0.2, {
      min: 0,
      tooltip: "Degrees of orbit per unit of pointer look; for a mouse, degrees per CSS pixel.",
    }),
    stickLookSpeed: f32(DEFAULT_STICK_LOOK_SPEED, {
      min: 0,
      tooltip: "Degrees of orbit per second at full deflection, for a gamepad or on-screen stick.",
    }),
    lockPointerOnClick: bool(false, {
      tooltip: "Whether a click requests pointer lock; while it is on, mouse look waits for the lock.",
    }),
    damping: f32(0.08, { min: 0, tooltip: "The follow time constant, in seconds; 0 snaps." }),
    shoulderOffset: vec3({ x: 0.5, y: 1.5, z: 0 }, { tooltip: "The pivot offset from the target, in its own space." }),
    invertY: bool(false, { tooltip: "Whether looking up needs the stick pushed down." }),
    collisionEnabled: bool(true, { tooltip: "Whether the boom is shortened by geometry in the way." }),
    collisionRadius: f32(0.25, { min: 0.01, tooltip: "The radius of the sphere swept along the boom." }),
    collisionLayers: layerMask([], {
      tooltip: "Which layers the boom's hit is attributed to; the target's own body is always swept through.",
    }),
    collisionRecoverySpeed: f32(6, { min: 0, tooltip: "How fast the boom eases back out, in m/s." }),
  });
}

/**
 * An orbiting camera with shoulder offset, damping, and collision recovery.
 *
 * Pointer look uses `sensitivity` in degrees per CSS pixel; stick look uses `stickLookSpeed` in
 * degrees per second. Both use the `Look` action, with units selected by its active device.
 *
 * `lockPointerOnClick` defaults to `false`. When enabled, canvas presses request pointer lock,
 * and mouse/pointer look waits for it. Gamepad and touch look remain available.
 *
 * Moving the mouse forward or pushing a stick up lowers the boom and aims upward. `invertY`
 * reverses all devices; positive `pitch` raises the camera and aims down.
 *
 * @example
 * ```ts
 * const camera = app.world.createEntity("Camera");
 * camera.addComponent(Camera);
 * camera.addComponent(ThirdPersonCamera, { target: hero, distance: 5 });
 * ```
 *
 * @public
 */
export class ThirdPersonCamera extends Script {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/ThirdPersonCamera";

  /** One rig per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = thirdPersonCameraSchema();

  /** The entity the camera orbits. */
  declare target: Entity | null;

  /** The vector2 action that orbits the camera. */
  declare lookAction: string;

  /** How far behind the target the camera sits, in metres. */
  declare distance: number;

  /** The lowest pitch, in degrees. */
  declare minPitch: number;

  /** The highest pitch, in degrees. */
  declare maxPitch: number;

  /** Degrees of orbit per unit of pointer look; for a mouse, degrees per CSS pixel of motion. */
  declare sensitivity: number;

  /** Degrees of orbit per second at full deflection, for a gamepad or on-screen stick. */
  declare stickLookSpeed: number;

  /** Whether a click requests pointer lock; while it is on, mouse look waits for the lock. */
  declare lockPointerOnClick: boolean;

  /** The follow time constant, in seconds. */
  declare damping: number;

  /** The pivot offset from the target, in the target's own space. */
  declare shoulderOffset: Vec3Like;

  /** Whether looking up needs the stick pushed down. */
  declare invertY: boolean;

  /** Whether the boom is shortened by geometry in the way. */
  declare collisionEnabled: boolean;

  /** The radius of the sphere swept along the boom. */
  declare collisionRadius: number;

  /**
   * Which layers the boom's hit is attributed to; an empty list means every layer. The target's own
   * body is always swept through, whatever the list says.
   */
  declare collisionLayers: readonly string[];

  /** How fast the boom eases back out, in metres per second. */
  declare collisionRecoverySpeed: number;

  #yaw = 0;

  #pitch = 15;

  #currentDistance = Number.NaN;

  readonly #look = new LookInput();

  readonly #pivot: MutableVec3 = new Vec3();

  readonly #desired: MutableVec3 = new Vec3();

  readonly #offset: MutableVec3 = new Vec3();

  readonly #hit: MutableVec3 = new Vec3();

  readonly #rotation: Quat = new Quat();

  /** Scratch for the yaw half of the orbit rotation. */
  readonly #yawRotation: Quat = new Quat();

  /** Scratch for the pitch half of the orbit rotation. */
  readonly #pitchRotation: Quat = new Quat();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(ThirdPersonCamera.schema));
  }

  /**
   * Where the boom currently ends, after collision. Never longer than `distance`.
   *
   * @returns Where the boom currently ends, after collision. Never longer than `distance`.
   */
  get currentDistance(): number {
    return Number.isNaN(this.#currentDistance) ? this.distance : this.#currentDistance;
  }

  /**
   * The camera's orbit yaw, in degrees.
   *
   * @returns The camera's orbit yaw, in degrees.
   */
  get yaw(): number {
    return this.#yaw;
  }

  /**
   * The camera's orbit pitch, in degrees.
   *
   * @returns The camera's orbit pitch, in degrees.
   */
  get pitch(): number {
    return this.#pitch;
  }

  /**
   * The point the camera is orbiting, in world space. Reused each frame.
   *
   * @returns The point the camera is orbiting, in world space. Reused each frame.
   */
  get pivot(): Vec3Like {
    return this.#pivot;
  }

  /**
   * Takes the entity's current facing as the starting orbit and binds the action name.
   *
   * @remarks
   * The angles are read off the entity's **forward vector**, not its Euler angles: an Euler triple
   * depends on the order it was composed in, and the rig composes yaw-then-pitch, which is not the
   * order `Transform.eulerAngles` reports. A forward vector has one yaw and one pitch whatever
   * produced it. Positive pitch aims down, so a forward that points below the horizon is a positive
   * pitch; a forward pointing straight up or down has no yaw and keeps the current one.
   */
  awake(): void {
    const forward = this.entity.transform.forward;
    const horizontal = Math.hypot(forward.x, forward.z);
    if (horizontal > 1e-6) {
      this.#yaw = Math.atan2(forward.x, forward.z) * RAD_TO_DEG;
    }
    this.#pitch = -Math.asin(clamp(forward.y, -1, 1)) * RAD_TO_DEG;
    this.#currentDistance = this.distance;
    this.#look.rebind(this.lookAction);
  }

  /** Re-resolves the action name, after a rebind or an action-set reload. */
  rebind(): void {
    this.#look.rebind(this.lookAction);
  }

  /** Snaps the rig to its target without damping — after a teleport or a scene load. */
  snap(): void {
    this.#currentDistance = this.distance;
    this.#apply(1);
  }

  /**
   * Orbits, follows, and pulls in.
   *
   * @param dt - The frame delta, in seconds.
   */
  lateUpdate(dt: number): void {
    const look = this.#look.step(this, dt);
    this.#yaw += look.x;
    this.#pitch = clamp(
      this.#pitch + (this.invertY ? look.y : -look.y),
      Math.min(this.minPitch, this.maxPitch),
      Math.max(this.minPitch, this.maxPitch),
    );
    // Frame-rate independent damping: the camera covers the same fraction of the remaining
    // distance per *second*, so 30 fps and 144 fps look the same.
    const blend = this.damping <= 0 ? 1 : 1 - Math.exp(-dt / this.damping);
    this.#applyCollision(dt);
    this.#apply(blend);
  }

  /**
   * Places the camera.
   *
   * @param blend - How much of the way to the desired pose to move, in `[0, 1]`.
   */
  #apply(blend: number): void {
    const target = this.target;
    if (target === null || target.isDestroyed) {
      return;
    }
    this.#readPivot(target);
    this.#orbitRotation();
    Quat.rotateVectorToRef(this.#rotation, BOOM, this.#offset);
    const reach = this.currentDistance;
    this.#desired.x = this.#pivot.x - this.#offset.x * reach;
    this.#desired.y = this.#pivot.y - this.#offset.y * reach;
    this.#desired.z = this.#pivot.z - this.#offset.z * reach;
    const transform = this.entity.transform;
    const current = transform.position;
    this.#hit.x = current.x + (this.#desired.x - current.x) * blend;
    this.#hit.y = current.y + (this.#desired.y - current.y) * blend;
    this.#hit.z = current.z + (this.#desired.z - current.z) * blend;
    transform.setPositionAndRotation(this.#hit, this.#rotation);
  }

  /**
   * Shortens the boom to the first thing between the pivot and the camera.
   *
   * @param dt - The frame delta.
   */
  #applyCollision(dt: number): void {
    if (Number.isNaN(this.#currentDistance)) {
      this.#currentDistance = this.distance;
    }
    const target = this.target;
    // On the very first frame the fixed loop may not have run yet, and a physics query before Havok's
    // first step is `IGX-0902`; `hasStepped` is the supported way to wait it out (`09-physics.md` §5).
    if (!this.collisionEnabled || target === null || target.isDestroyed || !this.app.physics.hasStepped) {
      this.#currentDistance = this.distance;
      return;
    }
    this.#readPivot(target);
    this.#orbitRotation();
    Quat.rotateVectorToRef(this.#rotation, BOOM, this.#offset);
    this.#desired.x = this.#pivot.x - this.#offset.x * this.distance;
    this.#desired.y = this.#pivot.y - this.#offset.y * this.distance;
    this.#desired.z = this.#pivot.z - this.#offset.z * this.distance;
    // `ignore: target` is what keeps the boom off the character's own capsule. The pivot usually
    // sits *inside* that capsule — a shoulder is inside the body — and Lite's sweep cannot be
    // filtered by layer, only told to pass through one body; without it half of every orbit reported
    // the capsule at fraction zero and the camera sat in the character's head (measured 2026-09-08).
    // `collisionLayers` still decides which hit is attributed an entity; any other body in the way
    // shortens the boom regardless, which for scenery is the point.
    const hit = this.app.physics.shapeCast(
      { kind: "sphere", radius: this.collisionRadius },
      this.#pivot,
      this.#desired,
      { layerMask: this.#mask(), ignore: target },
    );
    if (hit === null) {
      // Ease back out, so leaving cover is a glide rather than a jump cut.
      this.#currentDistance = Math.min(
        this.distance,
        this.#currentDistance + Math.max(0, this.collisionRecoverySpeed) * dt,
      );
      return;
    }
    // Going in is immediate: an eased pull-in spends its ease inside the wall.
    this.#currentDistance = Math.max(0, Math.min(this.#currentDistance, hit.distance - COLLISION_PADDING));
  }

  /**
   * Writes the orbit rotation — yaw about the world's up, then pitch about the camera's own right —
   * into `#rotation`.
   *
   * @remarks
   * `Ry(yaw) * Rx(pitch)`: the Hamilton product applies its right factor first, so the pitch tilts
   * the boom about the camera's right axis and the yaw then swings that tilted boom around the
   * vertical. The other order — one `fromEulerDegrees(pitch, yaw, 0)` call, which is intrinsic XYZ —
   * yaws about an axis that has already been pitched, and rolls the horizon.
   */
  #orbitRotation(): void {
    Quat.fromEulerDegreesToRef(0, this.#yaw, 0, this.#yawRotation);
    Quat.fromEulerDegreesToRef(this.#pitch, 0, 0, this.#pitchRotation);
    Quat.multiplyToRef(this.#yawRotation, this.#pitchRotation, this.#rotation);
  }

  /**
   * The layer mask the collision sweep uses, resolved from the field's names.
   *
   * @returns The mask; everything when the field is empty.
   */
  #mask(): LayerMask {
    return this.collisionLayers.length === 0
      ? LayerMask.everything()
      : LayerMask.fromNames(this.world.layers, this.collisionLayers);
  }

  /**
   * Writes the world-space orbit pivot for the current target.
   *
   * @param target - The entity being followed.
   */
  #readPivot(target: Entity): void {
    target.transform.transformPoint(this.shoulderOffset, this.#pivot);
  }
}

/** The unit boom direction the rig rotates: the camera sits *behind* the pivot, along `-forward`. */
const BOOM: Vec3Like = Object.freeze({ x: 0, y: 0, z: 1 });
