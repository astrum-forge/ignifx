import {
  bool,
  Camera,
  clamp,
  createDefaults,
  defineSchema,
  entityRef,
  f32,
  Quat,
  Script,
  str,
  Vec3,
} from "@ignifx/core";
import { CharacterController } from "@ignifx/physics";
import { ActionSlot, isHeld, wasPressed } from "./actions.js";
import { JumpTimers, jumpVelocity } from "./movement.js";
import type { Entity, MutableVec3, Schema, Vec2Like } from "@ignifx/core";

/**
 * `FirstPersonController` (`docs/architecture/12-3d-toolkit.md` §1.2): mouse-look on the entity's
 * yaw and a child pivot's pitch, on a `CharacterController`.
 *
 * Yaw lives on the character and pitch on a child, because that is the only split that lets the
 * body collide correctly while the head looks up: rotating the capsule in pitch would tip the whole
 * collider over. The pivot is the entity a `Camera` sits on, which is also where an `AudioListener`
 * belongs.
 *
 * Look happens in `update`, on the frame delta, because a mouse is sampled per frame and a look
 * that lagged the fixed step would feel heavy. Movement happens in `fixedUpdate`, like every other
 * character in the toolkit.
 */

/** How far the head may pitch, in degrees, before the neck complains. */
const MAX_PITCH = 89;

/** The default gravity, matching `ThirdPersonController`. */
const DEFAULT_GRAVITY = 20;

/** A small downward bias that keeps a grounded character stuck to slopes. */
const GROUND_STICK_SPEED = 2;

/**
 * Builds the `FirstPersonController` field declarations.
 *
 * @returns The schema.
 */
function firstPersonSchema(): Schema {
  return defineSchema({
    cameraPivot: entityRef({ tooltip: "The child entity that pitches; usually the camera's entity." }),
    moveAction: str("Move", { tooltip: "The vector2 action that walks." }),
    lookAction: str("Look", { tooltip: "The vector2 action that looks around." }),
    jumpAction: str("Jump", { tooltip: "The button action that jumps." }),
    sprintAction: str("Sprint", { tooltip: "The button action that sprints." }),
    crouchAction: str("Crouch", { tooltip: "The button action that crouches." }),
    sensitivity: f32(0.15, { min: 0, tooltip: "Degrees of rotation per unit of look input." }),
    invertY: bool(false, { tooltip: "Whether looking up needs the stick pushed down." }),
    walkSpeed: f32(4, { min: 0, tooltip: "Ground speed, in m/s." }),
    sprintSpeed: f32(7, { min: 0, tooltip: "Ground speed while sprinting, in m/s." }),
    crouchSpeed: f32(1.8, { min: 0, tooltip: "Ground speed while crouched, in m/s." }),
    standHeight: f32(1.8, { min: 0.1, tooltip: "The controller height while standing, in metres." }),
    crouchHeight: f32(1, { min: 0.1, tooltip: "The controller height while crouched, in metres." }),
    gravity: f32(DEFAULT_GRAVITY, { min: 0, tooltip: "Downward acceleration, in m/s squared." }),
    jumpHeight: f32(1.1, { min: 0, tooltip: "How high a jump reaches, in metres." }),
    coyoteTime: f32(0.1, { min: 0, tooltip: "How long a jump stays legal after leaving the ground." }),
    jumpBufferTime: f32(0.1, { min: 0, tooltip: "How long an early jump press is remembered." }),
    airControl: f32(0.5, { min: 0, max: 1, tooltip: "How much of the ground speed applies mid-air." }),
    lockPointerOnClick: bool(true, { tooltip: "Whether the first click requests pointer lock." }),
    headBobAmplitude: f32(0, { min: 0, tooltip: "How far the head bobs while walking, in metres; 0 disables it." }),
    headBobFrequency: f32(1.8, { min: 0, tooltip: "Head bobs per metre travelled." }),
    sprintFovKick: f32(0, { min: 0, tooltip: "Extra vertical FOV while sprinting, in degrees; 0 disables it." }),
  });
}

/**
 * A first-person character.
 *
 * @example
 * ```ts
 * const player = app.world.createEntity("Player");
 * player.addComponent(CharacterController, { height: 1.8, radius: 0.35 });
 * const head = app.world.createEntity("Head", { parent: player, position: { x: 0, y: 1.6, z: 0 } });
 * head.addComponent(Camera);
 * player.addComponent(FirstPersonController, { cameraPivot: head });
 * ```
 *
 * @public
 */
export class FirstPersonController extends Script {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/FirstPersonController";

  /** One controller per entity. */
  static allowMultiple = false;

  /** The `CharacterController` this drives. */
  static requires: readonly [typeof CharacterController] = [CharacterController];

  /** The declarative fields (ADR-0004). */
  static schema: Schema = firstPersonSchema();

  /** The child entity that pitches; usually the camera's entity. */
  declare cameraPivot: Entity | null;

  /** The vector2 action that walks. */
  declare moveAction: string;

  /** The vector2 action that looks around. */
  declare lookAction: string;

  /** The button action that jumps. */
  declare jumpAction: string;

  /** The button action that sprints. */
  declare sprintAction: string;

  /** The button action that crouches. */
  declare crouchAction: string;

  /** Degrees of rotation per unit of look input. */
  declare sensitivity: number;

  /** Whether looking up needs the stick pushed down. */
  declare invertY: boolean;

  /** Ground speed, in metres per second. */
  declare walkSpeed: number;

  /** Ground speed while sprinting. */
  declare sprintSpeed: number;

  /** Ground speed while crouched. */
  declare crouchSpeed: number;

  /** The controller height while standing. */
  declare standHeight: number;

  /** The controller height while crouched. */
  declare crouchHeight: number;

  /** Downward acceleration. */
  declare gravity: number;

  /** How high a jump reaches. */
  declare jumpHeight: number;

  /** How long a jump stays legal after leaving the ground. */
  declare coyoteTime: number;

  /** How long an early jump press is remembered. */
  declare jumpBufferTime: number;

  /** How much of the ground speed applies mid-air. */
  declare airControl: number;

  /** Whether the first click requests pointer lock. */
  declare lockPointerOnClick: boolean;

  /** How far the head bobs while walking, in metres. */
  declare headBobAmplitude: number;

  /** Head bobs per metre travelled. */
  declare headBobFrequency: number;

  /** Extra vertical FOV while sprinting, in degrees. */
  declare sprintFovKick: number;

  #controller: CharacterController | null = null;

  #yaw = 0;

  #pitch = 0;

  #verticalVelocity = 0;

  #speed = 0;

  #isSprinting = false;

  #isCrouched = false;

  #bobPhase = 0;

  #pivotBaseY = Number.NaN;

  #baseFov = Number.NaN;

  #lockRequested = false;

  readonly #jumps = new JumpTimers();

  readonly #move = new ActionSlot("");

  readonly #look = new ActionSlot("");

  readonly #jump = new ActionSlot("");

  readonly #sprint = new ActionSlot("");

  readonly #crouch = new ActionSlot("");

  readonly #displacement: MutableVec3 = new Vec3();

  readonly #rotation: Quat = new Quat();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(FirstPersonController.schema));
  }

  /**
   * The character's horizontal speed this step.
   *
   * @returns The character's horizontal speed this step.
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
   * Whether the character is crouched.
   *
   * @returns Whether the character is crouched.
   */
  get isCrouched(): boolean {
    return this.#isCrouched;
  }

  /**
   * Where the head is looking, in degrees; negative is up.
   *
   * @returns Where the head is looking, in degrees; negative is up.
   */
  get pitch(): number {
    return this.#pitch;
  }

  /**
   * Where the body is facing, in degrees.
   *
   * @returns Where the body is facing, in degrees.
   */
  get yaw(): number {
    return this.#yaw;
  }

  /** Finds the character controller and takes the entity's current facing as the starting yaw. */
  awake(): void {
    this.#controller = this.entity.getComponent(CharacterController);
    this.#yaw = this.entity.transform.eulerAngles.y;
    this.#pitch = this.cameraPivot?.transform.localEulerAngles.x ?? 0;
    this.#rebind();
  }

  /** Re-resolves the action names, after a rebind or an action-set reload. */
  rebind(): void {
    this.#rebind();
  }

  /**
   * Looks around, bobs the head, and asks for pointer lock the first time the player clicks.
   *
   * @param dt - The frame delta, in seconds.
   */
  update(dt: number): void {
    this.#requestPointerLock();
    const look = this.#look.resolve(this)?.vector ?? ZERO_STICK;
    this.#yaw += look.x * this.sensitivity;
    this.#pitch += (this.invertY ? look.y : -look.y) * this.sensitivity;
    this.#pitch = clamp(this.#pitch, -MAX_PITCH, MAX_PITCH);
    Quat.fromEulerDegreesToRef(0, this.#yaw, 0, this.#rotation);
    this.entity.transform.rotation = this.#rotation;
    const pivot = this.cameraPivot;
    if (pivot !== null && !pivot.isDestroyed) {
      Quat.fromEulerDegreesToRef(this.#pitch, 0, 0, this.#rotation);
      pivot.transform.localRotation.copyFrom(this.#rotation);
      this.#bob(pivot, dt);
      this.#fovKick(pivot, dt);
    }
  }

  /**
   * Walks, crouches, and jumps.
   *
   * @param dt - The fixed step, in seconds.
   */
  fixedUpdate(dt: number): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    this.#applyCrouch(controller);
    const stick = this.#move.resolve(this)?.vector ?? ZERO_STICK;
    const grounded = controller.isGrounded;
    this.#isSprinting = grounded && !this.#isCrouched && isHeld(this.#sprint.resolve(this)) && stick.y > 0;
    const groundSpeed = this.#isCrouched ? this.crouchSpeed : this.#isSprinting ? this.sprintSpeed : this.walkSpeed;
    const magnitude = Math.min(1, Math.hypot(stick.x, stick.y));
    this.#speed = groundSpeed * magnitude * (grounded ? 1 : this.airControl);

    const transform = this.entity.transform;
    const forward = transform.forward;
    const right = transform.right;
    const normalizer = magnitude < 1e-6 ? 0 : 1 / Math.hypot(stick.x, stick.y);
    const dirX = (right.x * stick.x + forward.x * stick.y) * normalizer;
    const dirZ = (right.z * stick.x + forward.z * stick.y) * normalizer;

    this.#jumps.step(dt, grounded, wasPressed(this.#jump.resolve(this)), this.coyoteTime, this.jumpBufferTime);
    if (this.#jumps.consume() && !this.#isCrouched) {
      this.#verticalVelocity = jumpVelocity(this.jumpHeight, this.gravity);
    } else if (grounded && this.#verticalVelocity <= 0) {
      this.#verticalVelocity = -GROUND_STICK_SPEED;
    } else {
      this.#verticalVelocity -= this.gravity * dt;
    }

    this.#displacement.x = dirX * this.#speed * dt;
    this.#displacement.y = this.#verticalVelocity * dt;
    this.#displacement.z = dirZ * this.#speed * dt;
    controller.move(this.#displacement);
  }

  /** Puts the controller back to standing height. */
  onDisable(): void {
    if (this.#isCrouched) {
      this.#controller?.setHeight(this.standHeight, true);
      this.#isCrouched = false;
    }
  }

  /**
   * Raises or lowers the capsule to match the crouch button.
   *
   * @param controller - The character controller.
   */
  #applyCrouch(controller: CharacterController): void {
    const wants = isHeld(this.#crouch.resolve(this));
    if (wants === this.#isCrouched) {
      return;
    }
    this.#isCrouched = wants;
    // `preserveFeet` keeps the capsule's bottom where it is, so crouching lowers the head rather
    // than dropping the whole character through the floor.
    controller.setHeight(wants ? this.crouchHeight : this.standHeight, true);
  }

  /**
   * Requests pointer lock once, the first time the player presses anything.
   */
  #requestPointerLock(): void {
    if (!this.lockPointerOnClick || this.#lockRequested) {
      return;
    }
    const input = this.entity.world.app.input;
    if (input.pointerLock.locked) {
      this.#lockRequested = true;
      return;
    }
    // `app.input.events` is the frame's raw event log; a pointer press is the gesture browsers
    // accept as user activation for `requestPointerLock`.
    const events = input.events;
    let pressed = false;
    for (let index = 0; index < events.length; index += 1) {
      if (events[index]?.type === "pointerdown") {
        pressed = true;
        break;
      }
    }
    if (!pressed) {
      return;
    }
    this.#lockRequested = true;
    void input.pointerLock.request().catch((error: unknown): void => {
      this.app.log.warn("Pointer lock was refused.", error);
    });
  }

  /**
   * Bobs the head with the character's speed.
   *
   * @param pivot - The head entity.
   * @param dt - The frame delta.
   */
  #bob(pivot: Entity, dt: number): void {
    if (this.headBobAmplitude <= 0) {
      return;
    }
    if (Number.isNaN(this.#pivotBaseY)) {
      this.#pivotBaseY = pivot.transform.localPosition.y;
    }
    this.#bobPhase += this.#speed * dt * this.headBobFrequency * Math.PI * 2;
    const grounded = this.#controller?.isGrounded ?? false;
    const amount = grounded ? Math.sin(this.#bobPhase) * this.headBobAmplitude : 0;
    pivot.transform.localPosition.y = this.#pivotBaseY + amount;
  }

  /**
   * Widens the camera's field of view while sprinting.
   *
   * @param pivot - The head entity.
   * @param dt - The frame delta.
   */
  #fovKick(pivot: Entity, dt: number): void {
    if (this.sprintFovKick <= 0) {
      return;
    }
    const camera = pivot.getComponent(Camera);
    if (camera === null) {
      return;
    }
    if (Number.isNaN(this.#baseFov)) {
      this.#baseFov = camera.fov;
    }
    const wanted = this.#baseFov + (this.#isSprinting ? this.sprintFovKick : 0);
    // A fixed time constant rather than a field: the kick is a flourish, not a tuning surface.
    camera.fov += (wanted - camera.fov) * Math.min(1, dt * 8);
  }

  /** Points the five action slots at the current field values. */
  #rebind(): void {
    this.#move.retarget(this.moveAction);
    this.#look.retarget(this.lookAction);
    this.#jump.retarget(this.jumpAction);
    this.#sprint.retarget(this.sprintAction);
    this.#crouch.retarget(this.crouchAction);
  }
}

/** The reading a missing action stands in for. */
const ZERO_STICK: Vec2Like = Object.freeze({ x: 0, y: 0 });
