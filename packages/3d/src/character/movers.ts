import { bool, createDefaults, defineSchema, entityRef, f32, Script, str, vec3, Vec3 } from "@ignifx/core";
import { CharacterController, Rigidbody } from "@ignifx/physics";
import { mainCameraForward } from "../camera/main-camera.js";
import { ActionSlot } from "./actions.js";
import { cameraRelativeToRef } from "./movement.js";
import type { Entity, MutableVec3, Schema, Vec2Like, Vec3Like } from "@ignifx/core";

/**
 * The `Rigidbody`-based movers of `docs/architecture/12-3d-toolkit.md` §1.3: a force-driven
 * character or vehicle, a kinematic platform that carries what stands on it, and a projectile.
 *
 * All three push physics from `fixedUpdate`, which is the only phase where a force means anything:
 * a force applied in `update` would be scaled by however many fixed steps happened to run that
 * frame (`docs/architecture/09-physics.md` §1).
 */

/** The reading a missing action stands in for. */
const ZERO_STICK: Vec2Like = Object.freeze({ x: 0, y: 0 });

/**
 * Builds the `RigidbodyMover` field declarations.
 *
 * @returns The schema.
 */
function rigidbodyMoverSchema(): Schema {
  return defineSchema({
    moveAction: str("Move", { tooltip: "The vector2 action that steers." }),
    force: f32(40, { min: 0, tooltip: "How hard the body is pushed, in newtons." }),
    maxSpeed: f32(12, { min: 0, tooltip: "The horizontal speed the mover stops adding force at." }),
    cameraRelative: bool(true, { tooltip: "Whether the stick is read relative to the main camera." }),
    torqueSteering: bool(false, { tooltip: "Whether the stick's X steers by torque rather than by force." }),
  });
}

/**
 * A physics-driven character or vehicle: forces in, momentum out
 * (`docs/architecture/12-3d-toolkit.md` §1.3).
 *
 * @example
 * ```ts
 * const ball = app.world.createEntity("Ball");
 * ball.addComponent(SphereCollider, { radius: 0.5 });
 * ball.addComponent(Rigidbody, { mass: 2 });
 * ball.addComponent(RigidbodyMover, { force: 30, maxSpeed: 10 });
 * ```
 *
 * @public
 */
export class RigidbodyMover extends Script {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/RigidbodyMover";

  /** One mover per entity. */
  static allowMultiple = false;

  /** The `Rigidbody` this pushes. */
  static requires: readonly [typeof Rigidbody] = [Rigidbody];

  /** The declarative fields (ADR-0004). */
  static schema: Schema = rigidbodyMoverSchema();

  /** The vector2 action that steers. */
  declare moveAction: string;

  /** How hard the body is pushed, in newtons. */
  declare force: number;

  /** The horizontal speed the mover stops adding force at. */
  declare maxSpeed: number;

  /** Whether the stick is read relative to the main camera. */
  declare cameraRelative: boolean;

  /** Whether the stick's X steers by torque rather than by force. */
  declare torqueSteering: boolean;

  #body: Rigidbody | null = null;

  readonly #move = new ActionSlot("");

  readonly #direction: MutableVec3 = new Vec3();

  readonly #push: MutableVec3 = new Vec3();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(RigidbodyMover.schema));
  }

  /** Finds the body and binds the action name. */
  awake(): void {
    this.#body = this.entity.getComponent(Rigidbody);
    this.#move.retarget(this.moveAction);
  }

  /**
   * Pushes the body.
   *
   * @param dt - The fixed step, in seconds.
   */
  fixedUpdate(dt: number): void {
    const body = this.#body;
    if (body === null) {
      return;
    }
    const stick = this.#move.resolve(this)?.vector ?? ZERO_STICK;
    if (stick.x === 0 && stick.y === 0) {
      return;
    }
    const transform = this.entity.transform;
    const reference = this.cameraRelative ? mainCameraForward(this.world) : transform.forward;
    if (this.torqueSteering) {
      // A vehicle: X turns, Y drives.
      const spin = body.angularVelocityToRef(this.#push);
      spin.y += stick.x * this.force * dt;
      body.angularVelocity = spin;
      this.#direction.x = transform.forward.x;
      this.#direction.y = 0;
      this.#direction.z = transform.forward.z;
      this.#applyDrive(body, stick.y);
      return;
    }
    cameraRelativeToRef(stick.x, stick.y, reference, this.#direction);
    this.#applyDrive(body, Math.min(1, Math.hypot(stick.x, stick.y)));
  }

  /**
   * Adds the drive force, unless the body is already at its speed limit.
   *
   * @param body - The rigidbody.
   * @param throttle - How much of the force to apply, in `[-1, 1]`.
   */
  #applyDrive(body: Rigidbody, throttle: number): void {
    const velocity = body.linearVelocity;
    if (Math.hypot(velocity.x, velocity.z) >= this.maxSpeed) {
      return;
    }
    this.#push.x = this.#direction.x * this.force * throttle;
    this.#push.y = 0;
    this.#push.z = this.#direction.z * this.force * throttle;
    body.addForce(this.#push);
  }
}

/**
 * Builds the `PlatformMover` field declarations.
 *
 * @returns The schema.
 */
function platformMoverSchema(): Schema {
  return defineSchema({
    offset: vec3({ x: 0, y: 0, z: 6 }, { tooltip: "How far the platform travels from where it started." }),
    duration: f32(4, { min: 0.01, tooltip: "How long one leg of the trip takes, in seconds." }),
    waitSeconds: f32(0.5, { min: 0, tooltip: "How long the platform pauses at each end." }),
    carryRiders: bool(true, { tooltip: "Whether characters standing on the platform ride it." }),
  });
}

/**
 * A kinematic platform that carries what stands on it
 * (`docs/architecture/12-3d-toolkit.md` §1.3).
 *
 * @remarks
 * Riders are found with a short downward `app.physics.raycast` from each character's feet
 * (`09-physics.md` §5): a character standing on this platform is handed the platform's own delta in
 * the same fixed step, which is what stops it sliding off a moving lift. A ground probe is used
 * rather than `CharacterController.onCollided` because the contact stream reports a character's
 * collisions*, and a character resting on a surface it never pushes into produces none.
 *
 * @example
 * ```ts
 * lift.addComponent(Rigidbody, { bodyType: "kinematic" });
 * lift.addComponent(BoxCollider, { size: { x: 4, y: 0.4, z: 4 } });
 * lift.addComponent(PlatformMover, { offset: { x: 0, y: 6, z: 0 }, duration: 3 });
 * ```
 *
 * @public
 */
export class PlatformMover extends Script {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/PlatformMover";

  /** One mover per entity. */
  static allowMultiple = false;

  /** The kinematic `Rigidbody` this drives. */
  static requires: readonly [typeof Rigidbody] = [Rigidbody];

  /** The declarative fields (ADR-0004). */
  static schema: Schema = platformMoverSchema();

  /** How far the platform travels from where it started. */
  declare offset: Vec3Like;

  /** How long one leg of the trip takes, in seconds. */
  declare duration: number;

  /** How long the platform pauses at each end. */
  declare waitSeconds: number;

  /** Whether characters standing on the platform ride it. */
  declare carryRiders: boolean;

  #body: Rigidbody | null = null;

  #elapsed = 0;

  readonly #origin: MutableVec3 = new Vec3();

  readonly #target: MutableVec3 = new Vec3();

  readonly #delta: MutableVec3 = new Vec3();

  readonly #riders: CharacterController[] = [];

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(PlatformMover.schema));
  }

  /**
   * The platform's movement last step, which riders are handed. Reused each step.
   *
   * @returns The platform's movement last step, which riders are handed. Reused each step.
   */
  get deltaThisStep(): Vec3Like {
    return this.#delta;
  }

  /**
   * How many characters are currently riding.
   *
   * @returns How many characters are currently riding.
   */
  get riderCount(): number {
    return this.#riders.length;
  }

  /** Records the starting position and subscribes to every character's contacts. */
  awake(): void {
    this.#body = this.entity.getComponent(Rigidbody);
    this.#origin.x = this.entity.transform.position.x;
    this.#origin.y = this.entity.transform.position.y;
    this.#origin.z = this.entity.transform.position.z;
  }

  /**
   * Moves the platform and its riders.
   *
   * @param dt - The fixed step, in seconds.
   */
  fixedUpdate(dt: number): void {
    const body = this.#body;
    if (body === null) {
      return;
    }
    const leg = this.duration;
    const wait = this.waitSeconds;
    const cycle = (leg + wait) * 2;
    this.#elapsed = (this.#elapsed + dt) % cycle;
    const phase = this.#elapsed;
    let t: number;
    if (phase < leg) {
      t = phase / leg;
    } else if (phase < leg + wait) {
      t = 1;
    } else if (phase < leg * 2 + wait) {
      t = 1 - (phase - leg - wait) / leg;
    } else {
      t = 0;
    }
    // Smoothstep, so the platform eases in and out rather than jerking at each end.
    const eased = t * t * (3 - 2 * t);
    this.#target.x = this.#origin.x + this.offset.x * eased;
    this.#target.y = this.#origin.y + this.offset.y * eased;
    this.#target.z = this.#origin.z + this.offset.z * eased;
    const current = this.entity.transform.position;
    this.#delta.x = this.#target.x - current.x;
    this.#delta.y = this.#target.y - current.y;
    this.#delta.z = this.#target.z - current.z;
    if (this.carryRiders) {
      this.#collectRiders();
    }
    body.teleport(this.#target);
    for (const rider of this.#riders) {
      if (!rider.isDestroyed) {
        rider.move(this.#delta);
      }
    }
  }

  /** Finds every character standing on this platform, with one short downward probe each. */
  #collectRiders(): void {
    this.#riders.length = 0;
    const physics = this.world.app.physics;
    const characters = this.world.components(CharacterController);
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index];
      if (character === undefined || !character.isEnabledInHierarchy) {
        continue;
      }
      const position = character.entity.transform.position;
      const feetY = position.y + character.center.y - character.height / 2;
      const hit = physics.raycast(
        { x: position.x, y: feetY + RIDE_PROBE_LIFT, z: position.z },
        DOWN,
        RIDE_PROBE_LIFT + character.skinWidth + RIDE_PROBE_REACH,
      );
      if (hit !== null && hit.entity === this.entity) {
        this.#riders.push(character);
      }
    }
  }
}

/** How far above its feet the rider probe starts, in metres. */
const RIDE_PROBE_LIFT = 0.1;

/** How far below its feet the rider probe reaches, in metres. */
const RIDE_PROBE_REACH = 0.2;

/** Straight down, for the rider probe. */
const DOWN: Vec3Like = Object.freeze({ x: 0, y: -1, z: 0 });

/**
 * Builds the `Projectile` field declarations.
 *
 * @returns The schema.
 */
function projectileSchema(): Schema {
  return defineSchema({
    speed: f32(30, { min: 0, tooltip: "How fast the projectile leaves the muzzle, in m/s." }),
    gravityScale: f32(1, { tooltip: "How much gravity the projectile feels; 0 flies straight." }),
    lifetimeSeconds: f32(5, { min: 0, tooltip: "How long the projectile lives before destroying itself." }),
    destroyOnHit: bool(true, { tooltip: "Whether the projectile destroys itself on its first contact." }),
    owner: entityRef({ tooltip: "The entity that fired it, so it does not hit its own shooter." }),
  });
}

/**
 * A fire-and-forget projectile (`docs/architecture/12-3d-toolkit.md` §1.3).
 *
 * @example
 * ```ts
 * const bullet = app.world.createEntity("Bullet", { position: muzzle.transform.position });
 * bullet.addComponent(SphereCollider, { radius: 0.05 });
 * bullet.addComponent(Rigidbody, { mass: 0.02 });
 * bullet.addComponent(Projectile, { speed: 60, owner: player });
 * ```
 *
 * @public
 */
export class Projectile extends Script {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/Projectile";

  /** One projectile per entity. */
  static allowMultiple = false;

  /** The `Rigidbody` that carries it. */
  static requires: readonly [typeof Rigidbody] = [Rigidbody];

  /** The declarative fields (ADR-0004). */
  static schema: Schema = projectileSchema();

  /** How fast the projectile leaves the muzzle. */
  declare speed: number;

  /** How much gravity the projectile feels. */
  declare gravityScale: number;

  /** How long the projectile lives before destroying itself. */
  declare lifetimeSeconds: number;

  /** Whether the projectile destroys itself on its first contact. */
  declare destroyOnHit: boolean;

  /** The entity that fired it. */
  declare owner: Entity | null;

  #age = 0;

  #launched = false;

  #body: Rigidbody | null = null;

  readonly #velocity: MutableVec3 = new Vec3();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Projectile.schema));
  }

  /**
   * How long the projectile has been alive, in seconds.
   *
   * @returns How long the projectile has been alive, in seconds.
   */
  get age(): number {
    return this.#age;
  }

  /** Finds the body; the launch itself waits for the first fixed step. */
  awake(): void {
    this.#body = this.entity.getComponent(Rigidbody);
  }

  /**
   * Ages the projectile and applies its gravity scale.
   *
   * @param dt - The fixed step, in seconds.
   */
  fixedUpdate(dt: number): void {
    this.#launch();
    this.#age += dt;
    if (this.lifetimeSeconds > 0 && this.#age >= this.lifetimeSeconds) {
      this.entity.destroy();
      return;
    }
    const body = this.#body;
    if (body === null || this.gravityScale === 1) {
      return;
    }
    // The world's gravity has already been integrated this step; the mover adds the difference so
    // that `gravityScale: 0` flies flat and `2` drops twice as fast.
    const gravity = this.app.physics.gravity;
    const correction = 1 - this.gravityScale;
    const velocity = body.linearVelocityToRef(this.#velocity);
    velocity.x -= gravity.x * correction * dt;
    velocity.y -= gravity.y * correction * dt;
    velocity.z -= gravity.z * correction * dt;
    body.linearVelocity = velocity;
  }

  /**
   * Gives the projectile its muzzle velocity, once.
   *
   * @remarks
   * Not in `awake`: `Rigidbody` builds its Havok body in the physics extension's own `FixedUpdate`
   * pass, so a velocity written before the first step is written onto nothing
   * (`docs/architecture/09-physics.md` §2.1).
   */
  #launch(): void {
    const body = this.#body;
    if (this.#launched || body === null || body.lite.body === null) {
      return;
    }
    this.#launched = true;
    const forward = this.entity.transform.forward;
    this.#velocity.x = forward.x * this.speed;
    this.#velocity.y = forward.y * this.speed;
    this.#velocity.z = forward.z * this.speed;
    body.linearVelocity = this.#velocity;
  }

  /**
   * Destroys the projectile on its first contact with anything but its owner.
   *
   * @param collision - The contact, as physics reports it.
   */
  onCollisionEnter(collision: unknown): void {
    if (!this.destroyOnHit) {
      return;
    }
    // Physics types the callback argument as `unknown` so core does not depend on it; the shape
    // below is what `@ignifx/physics` always passes (`Collision.other`).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see the comment above.
    const other = (collision as { readonly other?: Entity | null }).other ?? null;
    if (other !== null && other === this.owner) {
      return;
    }
    this.entity.destroy();
  }
}
