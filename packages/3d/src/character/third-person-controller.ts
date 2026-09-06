import { bool, createDefaults, defineSchema, f32, Quat, Script, str, Vec3 } from "@ignifx/core";
import { CharacterController } from "@ignifx/physics";
import { mainCameraForward } from "../camera/main-camera.js";
import { ActionSlot, isHeld, wasPressed } from "./actions.js";
import {
  cameraRelativeToRef,
  JumpTimers,
  jumpVelocity,
  slopeAngleDegrees,
  turnTowardsDegrees,
  yawFromDirection,
} from "./movement.js";
import type { MutableVec3, Schema, Vec2Like, Vec3Like } from "@ignifx/core";

/**
 * `ThirdPersonController` (`docs/architecture/12-3d-toolkit.md` §1.1): camera-relative movement on
 * a `CharacterController`, with the four things that separate a good character from a bad one —
 * coyote time, jump buffering, slope handling, and an optional step probe.
 *
 * Everything happens in `fixedUpdate`, on the fixed step, reading the input values captured at the
 * top of the frame (`docs/architecture/08-input.md`, frame consistency). That is what makes a
 * character behave the same at 30 fps and at 240, and what lets a replay reproduce a run.
 *
 * The exposed state — {@link ThirdPersonController.speed},
 * {@link ThirdPersonController.isGrounded}, {@link ThirdPersonController.verticalVelocity},
 * {@link ThirdPersonController.isSprinting} — is what an `Animator` reads to drive a locomotion
 * blend tree. It is written in `FixedUpdate`, well before `PostUpdate` advances animation, so the
 * pose is never a frame behind the movement that caused it.
 */

/** The default gravity, in metres per second squared: heavier than Earth, like most action games. */
const DEFAULT_GRAVITY = 20;

/** A small downward bias that keeps a grounded character stuck to slopes and steps. */
const GROUND_STICK_SPEED = 2;

/** How far ahead of itself the step probe looks, as a multiple of the controller's radius. */
const STEP_PROBE_REACH = 1.2;

/**
 * Builds the `ThirdPersonController` field declarations.
 *
 * @returns The schema.
 */
function thirdPersonSchema(): Schema {
  return defineSchema({
    moveAction: str("Move", { tooltip: "The vector2 action that steers the character." }),
    jumpAction: str("Jump", { tooltip: "The button action that jumps." }),
    sprintAction: str("Sprint", { tooltip: "The button action that sprints." }),
    walkSpeed: f32(4, { min: 0, tooltip: "Ground speed with the stick fully pressed, in m/s." }),
    sprintSpeed: f32(7, { min: 0, tooltip: "Ground speed while sprinting, in m/s." }),
    turnSpeed: f32(720, { min: 0, tooltip: "How fast the character faces its direction, in deg/s." }),
    gravity: f32(DEFAULT_GRAVITY, { min: 0, tooltip: "Downward acceleration, in m/s squared." }),
    jumpHeight: f32(1.2, { min: 0, tooltip: "How high a jump reaches, in metres." }),
    coyoteTime: f32(0.12, { min: 0, tooltip: "How long a jump stays legal after leaving the ground." }),
    jumpBufferTime: f32(0.12, { min: 0, tooltip: "How long an early jump press is remembered." }),
    airControl: f32(0.4, { min: 0, max: 1, tooltip: "How much of the ground speed applies mid-air." }),
    stepHeight: f32(0, { min: 0, tooltip: "The tallest step the probe lifts over; 0 disables it." }),
    slideSpeed: f32(6, { min: 0, tooltip: "How fast the character slides down a too-steep slope." }),
    rotateToMovement: bool(true, { tooltip: "Whether the entity turns to face the way it is moving." }),
  });
}

/**
 * A camera-relative third-person character.
 *
 * @example
 * ```ts
 * const hero = app.world.createEntity("Hero");
 * hero.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
 * hero.addComponent(ThirdPersonController, { walkSpeed: 4, sprintSpeed: 7, stepHeight: 0.3 });
 * ```
 *
 * @public
 */
export class ThirdPersonController extends Script {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/ThirdPersonController";

  /** One controller per entity. */
  static allowMultiple = false;

  /** The `CharacterController` this drives (`CONSTITUTION.md` §3, ADR-0004). */
  static requires: readonly [typeof CharacterController] = [CharacterController];

  /** The declarative fields (ADR-0004). */
  static schema: Schema = thirdPersonSchema();

  /** The vector2 action that steers the character. */
  declare moveAction: string;

  /** The button action that jumps. */
  declare jumpAction: string;

  /** The button action that sprints. */
  declare sprintAction: string;

  /** Ground speed with the stick fully pressed, in metres per second. */
  declare walkSpeed: number;

  /** Ground speed while sprinting, in metres per second. */
  declare sprintSpeed: number;

  /** How fast the character turns to face its direction, in degrees per second. */
  declare turnSpeed: number;

  /** Downward acceleration, in metres per second squared. */
  declare gravity: number;

  /** How high a jump reaches, in metres. */
  declare jumpHeight: number;

  /** How long a jump stays legal after leaving the ground. */
  declare coyoteTime: number;

  /** How long an early jump press is remembered. */
  declare jumpBufferTime: number;

  /** How much of the ground speed applies mid-air, in `[0, 1]`. */
  declare airControl: number;

  /** The tallest step the probe lifts over; `0` disables the probe. */
  declare stepHeight: number;

  /** How fast the character slides down a slope steeper than the controller's limit. */
  declare slideSpeed: number;

  /** Whether the entity turns to face the way it is moving. */
  declare rotateToMovement: boolean;

  #controller: CharacterController | null = null;

  #verticalVelocity = 0;

  #grounded = false;

  #speed = 0;

  #isSprinting = false;

  readonly #jumps = new JumpTimers();

  readonly #move = new ActionSlot("");

  readonly #jump = new ActionSlot("");

  readonly #sprint = new ActionSlot("");

  readonly #direction: MutableVec3 = new Vec3();

  readonly #displacement: MutableVec3 = new Vec3();

  readonly #scratch: MutableVec3 = new Vec3();

  readonly #rotation: Quat = new Quat();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(ThirdPersonController.schema));
  }

  /**
   * The character's horizontal speed this step, in metres per second.
   *
   * @returns The character's horizontal speed this step, in metres per second.
   */
  get speed(): number {
    return this.#speed;
  }

  /**
   * Whether the character is standing on something.
   *
   * @returns Whether the character is standing on something.
   */
  get isGrounded(): boolean {
    return this.#controller?.isGrounded ?? false;
  }

  /**
   * The character's vertical speed, positive upwards.
   *
   * @returns The character's vertical speed, positive upwards.
   */
  get verticalVelocity(): number {
    return this.#verticalVelocity;
  }

  /**
   * Whether the sprint action is held and the character is moving.
   *
   * @returns Whether the sprint action is held and the character is moving.
   */
  get isSprinting(): boolean {
    return this.#isSprinting;
  }

  /**
   * The direction the character is being pushed this step, normalized. Reused each step.
   *
   * @returns The direction the character is being pushed this step, normalized. Reused each step.
   */
  get moveDirection(): Vec3Like {
    return this.#direction;
  }

  /** Finds the character controller and binds the action names. */
  awake(): void {
    this.#controller = this.entity.getComponent(CharacterController);
    this.#rebind();
  }

  /**
   * Re-resolves the action names, for a game that changed them at runtime or reloaded its maps.
   */
  rebind(): void {
    this.#rebind();
  }

  /**
   * Cancels the character's vertical momentum — after a teleport, or when a cutscene takes over.
   */
  resetMomentum(): void {
    this.#verticalVelocity = 0;
    this.#jumps.reset();
  }

  /**
   * Moves the character.
   *
   * @param dt - The fixed step, in seconds.
   */
  fixedUpdate(dt: number): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    const move = this.#move.resolve(this);
    const jumpAction = this.#jump.resolve(this);
    const grounded = this.#isOnWalkableGround(controller);
    this.#grounded = grounded;
    const stick = move?.vector ?? ZERO_STICK;
    this.#isSprinting = grounded && isHeld(this.#sprint.resolve(this)) && (stick.x !== 0 || stick.y !== 0);

    cameraRelativeToRef(stick.x, stick.y, mainCameraForward(this.world), this.#direction);
    const magnitude = Math.min(1, Math.hypot(stick.x, stick.y));
    const groundSpeed = this.#isSprinting ? this.sprintSpeed : this.walkSpeed;
    const control = grounded ? 1 : this.airControl;
    this.#speed = groundSpeed * magnitude * control;

    this.#jumps.step(dt, grounded, wasPressed(jumpAction), this.coyoteTime, this.jumpBufferTime);
    if (this.#jumps.consume()) {
      this.#verticalVelocity = jumpVelocity(this.jumpHeight, this.gravity);
    } else if (grounded && this.#verticalVelocity <= 0) {
      // A small downward bias rather than zero: it is what keeps a character welded to a ramp
      // instead of skipping off the top of it.
      this.#verticalVelocity = -GROUND_STICK_SPEED;
    } else {
      this.#verticalVelocity -= this.gravity * dt;
    }

    this.#displacement.x = this.#direction.x * this.#speed;
    this.#displacement.y = 0;
    this.#displacement.z = this.#direction.z * this.#speed;
    this.#applySlope(controller);
    this.#applyStep(controller, dt);
    this.#displacement.x *= dt;
    this.#displacement.z *= dt;
    this.#displacement.y += this.#verticalVelocity * dt;
    controller.move(this.#displacement);

    if (this.rotateToMovement) {
      this.#face(dt);
    }
  }

  /**
   * Points the entity along its movement direction.
   *
   * @param dt - The frame's fixed step, in seconds.
   */
  #face(dt: number): void {
    const yaw = yawFromDirection(this.#direction.x, this.#direction.z);
    if (yaw === null) {
      return;
    }
    const transform = this.entity.transform;
    const current = transform.eulerAngles.y;
    Quat.fromEulerDegreesToRef(0, turnTowardsDegrees(current, yaw, this.turnSpeed, dt), 0, this.#rotation);
    transform.rotation = this.#rotation;
  }

  /**
   * Slides down a slope the controller calls too steep, and hugs one it does not.
   *
   * @param controller - The character controller.
   */
  #applySlope(controller: CharacterController): void {
    if (controller.supportState === "unsupported") {
      return;
    }
    const normal = controller.groundNormal;
    // `sin(angle)` is the length of the normal's horizontal part, and the direction it points is
    // straight downhill.
    const sine = Math.hypot(normal.x, normal.z);
    if (sine < 1e-4) {
      return;
    }
    const downhillX = normal.x / sine;
    const downhillZ = normal.z / sine;
    if (this.#grounded) {
      // Havok's character controller has no static friction (`index.d.ts` 8310), so the small
      // downward bias that keeps the capsule welded to the ground is resolved by collide-and-slide
      // into a steady creep down every incline. The creep is exactly `|v| sin(a) cos(a)`, so it is
      // cancelled rather than lived with: on ground the character can stand on, it stands.
      const creep = Math.abs(this.#verticalVelocity) * sine * Math.abs(normal.y);
      this.#displacement.x -= downhillX * creep;
      this.#displacement.z -= downhillZ * creep;
      return;
    }
    // Too steep to stand on: add a deliberate slide down the fall line instead.
    this.#displacement.x += downhillX * this.slideSpeed;
    this.#displacement.z += downhillZ * this.slideSpeed;
  }

  /**
   * Whether the character is on ground it can stand on.
   *
   * @param controller - The character controller.
   * @returns `true` when there is a contact and its slope is within `slopeLimit`.
   */
  #isOnWalkableGround(controller: CharacterController): boolean {
    if (controller.isGrounded) {
      return true;
    }
    if (controller.supportState === "unsupported") {
      return false;
    }
    return slopeAngleDegrees(controller.groundNormal) <= controller.slopeLimit;
  }

  /**
   * Lifts the character over a small step it is about to walk into.
   *
   * @remarks
   * Two sweeps: one forward at step height to check the space is clear, one down from there to find
   * the step's top. Both use `app.physics.shapeCast`, and the whole probe is skipped when
   * `stepHeight` is zero — which is the default, because Havok's character controller already
   * climbs what its own `slopeLimit` allows.
   *
   * @param controller - The character controller.
   * @param dt - The fixed step.
   */
  #applyStep(controller: CharacterController, dt: number): void {
    if (this.stepHeight <= 0 || !this.#grounded || this.#speed <= 0) {
      return;
    }
    const physics = this.entity.world.app.physics;
    const transform = this.entity.transform;
    const radius = controller.radius;
    const reach = Math.max(radius * STEP_PROBE_REACH, this.#speed * dt);
    const feet = this.#scratch;
    feet.x = transform.position.x + controller.center.x;
    feet.y = transform.position.y + controller.center.y - controller.height / 2 + radius;
    feet.z = transform.position.z + controller.center.z;
    const shape = { kind: "sphere", radius: radius * 0.9 } as const;
    const blockedAhead = physics.shapeCast(shape, feet, {
      x: feet.x + this.#direction.x * reach,
      y: feet.y,
      z: feet.z + this.#direction.z * reach,
    });
    if (blockedAhead === null) {
      return;
    }
    const lifted = { x: feet.x, y: feet.y + this.stepHeight, z: feet.z };
    const clearAbove = physics.shapeCast(shape, lifted, {
      x: lifted.x + this.#direction.x * reach,
      y: lifted.y,
      z: lifted.z + this.#direction.z * reach,
    });
    if (clearAbove !== null) {
      return;
    }
    // There is a step, and the space above it is clear: rise over it this step.
    this.#displacement.y += this.stepHeight / dt;
    if (this.#verticalVelocity < 0) {
      this.#verticalVelocity = 0;
    }
  }

  /** Points the three action slots at the current field values. */
  #rebind(): void {
    rebindSlot(this.#move, this.moveAction);
    rebindSlot(this.#jump, this.jumpAction);
    rebindSlot(this.#sprint, this.sprintAction);
  }
}

/** The reading a missing move action stands in for. */
const ZERO_STICK: Vec2Like = Object.freeze({ x: 0, y: 0 });

/**
 * Replaces a slot's action name, if it changed.
 *
 * @remarks
 * `ActionSlot` is immutable in its name, so a changed field means a new slot. The controller keeps
 * its three in `readonly` fields, so the swap is done by resetting the slot's cache instead — which
 * is the same thing from the outside and keeps the per-step path free of allocation.
 *
 * @param slot - The slot to point at `name`.
 * @param name - The action name from the field.
 */
function rebindSlot(slot: ActionSlot, name: string): void {
  if (slot.name !== name) {
    slot.retarget(name);
    return;
  }
  slot.invalidate();
}
