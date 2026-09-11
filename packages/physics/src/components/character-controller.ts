import { Component, createDefaults, defineSchema, enumOf, f32, Signal, Vec3, vec3 } from "@ignifx/core";
import { PhysicsHostKey } from "../runtime/runtime-key.js";
import { INTERPOLATION_MODES } from "./rigidbody.js";
import type { CharacterCollision } from "../events.js";
import type { InterpolationMode } from "./rigidbody.js";
import type { PhysicsRuntime } from "../runtime/runtime.js";
import type { ComponentHooks, Schema, Vec3Like } from "@ignifx/core";

/**
 * Sum `move` displacements during `fixedUpdate` and apply them in the physics step.
 * The controller owns world position after the step; game code owns rotation and gravity.
 * `supportState` is the last step's result. `pushStrength` scales Lite's default strength, not newtons.
 */

/**
 * How the character is supported by whatever is under it.
 *
 * @public
 */
export const SUPPORT_STATES = ["unsupported", "sliding", "supported"] as const;

/**
 * The union of {@link SUPPORT_STATES}.
 *
 * @public
 */
export type SupportStateName = (typeof SUPPORT_STATES)[number];

/**
 * A kinematic capsule that walks, slides, and pushes (`09-physics.md` §2.3).
 *
 * @example
 * ```ts
 * class Walk extends Script implements ScriptCallbacks {
 *   static typeId = "mygame/Walk";
 *   fixedUpdate(dt: number): void {
 *     const controller = this.entity.requireComponent(CharacterController);
 *     controller.move({ x: 2 * dt, y: 0, z: 0 });
 *   }
 * }
 * ```
 *
 * @public
 */
export class CharacterController extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/CharacterController";

  /** One controller per entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = characterSchema();

  declare radius: number;

  declare height: number;

  declare center: Vec3Like;

  declare slopeLimit: number;

  declare skinWidth: number;

  declare pushStrength: number;

  declare interpolation: InterpolationMode;

  /** The displacement requested so far this fixed step. */
  readonly #pendingMove = new Vec3();

  /** The averaged normal of the supporting surface, written by the step system. */
  readonly #groundNormal = new Vec3(0, 1, 0);

  /** How the character was supported at the end of the last step. */
  #supportState: SupportStateName = "unsupported";

  /** Emitted for every dynamic body the character pushed; created on first access. */
  #onCollided: Signal<CharacterCollision> | null = null;

  /** Applies the schema defaults. */
  constructor() {
    super();
    Object.assign(this, createDefaults(CharacterController.schema));
  }

  /** Creates the Lite controller at the start of the next fixed step. */
  onAttach(): void {
    this.rebuild();
  }

  /** Releases the Lite controller. */
  onDetach(): void {
    this.#runtime()?.releaseController(this);
  }

  /** Rebuilds the capsule at the start of the next fixed step. */
  rebuild(): void {
    this.#runtime()?.markControllerDirty(this);
  }

  /**
   * Requests a displacement for this fixed step. Displacements accumulate until the step runs.
   *
   * @param displacement - The world-space displacement to attempt.
   */
  move(displacement: Vec3Like): void {
    this.#pendingMove.set(
      this.#pendingMove.x + displacement.x,
      this.#pendingMove.y + displacement.y,
      this.#pendingMove.z + displacement.z,
    );
  }

  /**
   * Sets the controller's velocity, which is what `integrate` advances.
   *
   * @param velocity - Metres per second, world space.
   */
  setVelocity(velocity: Vec3Like): void {
    this.#runtime()?.setControllerVelocity(this, velocity);
  }

  /**
   * The controller's current velocity.
   *
   * @returns A freshly allocated vector.
   */
  get velocity(): Vec3 {
    const out = new Vec3();
    this.#runtime()?.readControllerVelocity(this, out);
    return out;
  }

  /**
   * Whether the character is standing on a walkable surface.
   *
   * @returns `true` when the last step's probe reported `supported`.
   */
  get isGrounded(): boolean {
    return this.#supportState === "supported";
  }

  /**
   * How the character was supported at the end of the last step.
   *
   * @returns `"unsupported"`, `"sliding"`, or `"supported"`.
   */
  get supportState(): SupportStateName {
    return this.#supportState;
  }

  /**
   * The averaged normal of the supporting surface.
   *
   * @returns A live view; copy it if you keep it.
   */
  get groundNormal(): Vec3 {
    return this.#groundNormal;
  }

  /**
   * Emitted once per dynamic body the character pushed during a step.
   *
   * @returns The signal, created on first access.
   */
  get onCollided(): Signal<CharacterCollision> {
    this.#onCollided ??= new Signal<CharacterCollision>();
    return this.#onCollided;
  }

  /**
   * Changes the capsule height without losing the controller's state — the crouch primitive.
   *
   * @param height - The new total height, tip to tip.
   * @param preserveFeet - Whether the foot position stays fixed; defaults to `true`.
   */
  setHeight(height: number, preserveFeet: boolean = true): void {
    this.height = height;
    this.#runtime()?.resizeController(this, preserveFeet);
  }

  /**
   * Teleports the character, clearing any swept motion and the interpolation history.
   *
   * @param position - The new world position of the entity.
   */
  teleport(position: Vec3Like): void {
    this.#runtime()?.teleportController(this, position);
  }

  /**
   * The displacement requested so far this step, consumed by the step system.
   *
   * @returns A live view of the accumulator.
   *
   * @internal
   */
  takePendingMove(): Vec3 {
    return this.#pendingMove;
  }

  /**
   * Records the outcome of a step.
   *
   * @param state - The support classification.
   * @param normal - The averaged supporting normal.
   *
   * @internal
   */
  applyStepResult(state: SupportStateName, normal: Vec3Like): void {
    this.#supportState = state;
    this.#groundNormal.set(normal.x, normal.y, normal.z);
    this.#pendingMove.set(0, 0, 0);
  }

  /**
   * Emits `onCollided` if anything is listening.
   *
   * @param collision - The push to report.
   *
   * @internal
   */
  reportPush(collision: CharacterCollision): void {
    this.#onCollided?.emit(collision);
  }

  /**
   * The runtime, or `null` when the extension is not registered on this app.
   *
   * @returns The runtime.
   */
  #runtime(): PhysicsRuntime | null {
    return this.app.services.tryGet(PhysicsHostKey)?.runtime ?? null;
  }
}

/**
 * Builds the `CharacterController` schema.
 *
 * @returns The schema.
 */
function characterSchema(): Schema {
  return defineSchema({
    radius: f32(0.4, { min: 0 }),
    height: f32(1.8, { min: 0 }),
    center: vec3(),
    slopeLimit: f32(45, { min: 0, max: 90 }),
    skinWidth: f32(0.05, { min: 0 }),
    pushStrength: f32(1, { min: 0 }),
    interpolation: enumOf(INTERPOLATION_MODES, "interpolate"),
  });
}
