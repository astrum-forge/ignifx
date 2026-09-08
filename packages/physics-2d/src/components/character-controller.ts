import { bool, Component, createDefaults, defineSchema, enumOf, f32, Signal, Vec2, vec2 } from "@ignifx/core";
import { Physics2DHostKey } from "../runtime/runtime-key.js";
import { INTERPOLATION_MODES_2D } from "./rigidbody.js";
import type { CharacterCollision2D } from "../events.js";
import type { InterpolationMode2D } from "./rigidbody.js";
import type { Physics2DRuntime } from "../runtime/runtime.js";
import type { ComponentHooks, Schema, Vec2Like } from "@ignifx/core";

/**
 * The `CharacterController2D` component (`docs/architecture/11-2d-toolkit.md` §8): Rapier's
 * `KinematicCharacterController` (`control/character_controller.d.ts`) driven from `fixedUpdate`.
 *
 * ## How it is driven
 *
 * Call {@link CharacterController2D.move} from `fixedUpdate`. The requested displacements of one
 * step are summed and handed to Rapier's `computeColliderMovement` by the step system, so two
 * scripts moving the same character compose instead of fighting. Gravity is **not** applied by this
 * component: a bare controller is purely kinematic, exactly as the 3D one is, and the toolkit
 * controller scripts integrate gravity themselves.
 *
 * After the step the controller owns the entity's world X and Y. Z and `rotation2D` stay
 * user-controlled.
 *
 * ## The one addition to §8: `shape`
 *
 * §8 describes the controller as a capsule. Measured against `@dimforge/rapier2d-compat@0.20.0`
 * (spike S6.2), Rapier's autostep clears a 0.3 m step with a **box** character and refuses anything
 * above about 0.15 m with a capsule of radius 0.2 — so `stepOffset` is only usable with a box.
 * {@link CharacterController2D.shape} therefore chooses between the two, defaulting to `"capsule"`
 * as §8 says, and the limitation is documented in the skill and in ADR-0006's validation section.
 */

/**
 * The collision shape a 2D character controller uses.
 *
 * @public
 */
export const CHARACTER_SHAPES_2D = ["capsule", "box"] as const;

/**
 * The union of {@link CHARACTER_SHAPES_2D}.
 *
 * @public
 */
export type CharacterShape2D = (typeof CHARACTER_SHAPES_2D)[number];

/**
 * A kinematic character that walks, slides, climbs slopes, and steps up.
 *
 * @example
 * ```ts
 * class Walk extends Script implements ScriptCallbacks {
 *   static typeId = "mygame/Walk";
 *   fixedUpdate(dt: number): void {
 *     const controller = this.entity.requireComponent(CharacterController2D);
 *     controller.move({ x: 4 * dt, y: -9.81 * dt });
 *   }
 * }
 * ```
 *
 * @public
 */
export class CharacterController2D extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/CharacterController2D";

  /** One controller per entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = characterSchema();

  declare shape: CharacterShape2D;

  declare radius: number;

  declare height: number;

  declare offset: Vec2Like;

  declare slopeLimit: number;

  declare stepOffset: number;

  declare snapToGround: number;

  declare skinWidth: number;

  declare onOneWayPlatforms: boolean;

  declare pushBodies: boolean;

  declare interpolation: InterpolationMode2D;

  /** The displacement requested so far this fixed step. */
  readonly #pendingMove = new Vec2();

  /** The movement Rapier resolved for the last step, which is what `velocity` reports. */
  readonly #resolvedMove = new Vec2();

  /** The averaged normal of the supporting surface, written by the step system. */
  readonly #groundNormal = new Vec2(0, 1);

  /** Whether the last step ended on walkable ground. */
  #grounded = false;

  /** The fixed step the last move was resolved over, for `velocity`. */
  #lastDelta = 0;

  /** Emitted for every obstacle the character hit; created on first access. */
  #onCollided: Signal<CharacterCollision2D> | null = null;

  /** Applies the schema defaults. */
  constructor() {
    super();
    Object.assign(this, createDefaults(CharacterController2D.schema));
  }

  /** Creates the Rapier controller at the start of the next fixed step. */
  onAttach(): void {
    this.rebuild();
  }

  /** Releases the Rapier controller and its collider. */
  onDetach(): void {
    this.#runtime()?.releaseController(this);
  }

  /** Rebuilds the capsule or box at the start of the next fixed step. */
  rebuild(): void {
    this.#runtime()?.markControllerDirty(this);
  }

  /**
   * Requests a displacement for this fixed step. Displacements accumulate until the step runs.
   *
   * @param displacement - The world-space displacement to attempt, in metres.
   */
  move(displacement: Vec2Like): void {
    this.#pendingMove.set(this.#pendingMove.x + displacement.x, this.#pendingMove.y + displacement.y);
  }

  /**
   * How fast the character actually moved over the last fixed step, after sliding and blocking.
   *
   * @returns A freshly allocated vector in metres per second.
   */
  get velocity(): Vec2 {
    if (this.#lastDelta <= 0) {
      return new Vec2();
    }
    return new Vec2(this.#resolvedMove.x / this.#lastDelta, this.#resolvedMove.y / this.#lastDelta);
  }

  /**
   * Whether the character ended the last step on walkable ground.
   *
   * @returns Rapier's `computedGrounded` from the last move.
   */
  get isGrounded(): boolean {
    return this.#grounded;
  }

  /**
   * The most upward-facing normal of the obstacles the last move touched.
   *
   * @returns A live view; copy it if you keep it.
   */
  get groundNormal(): Vec2 {
    return this.#groundNormal;
  }

  /**
   * Emitted once per obstacle the character hit during a step.
   *
   * @remarks
   * Trigger colliders are not obstacles — the character walks straight through them — so a sensor
   * never appears here. Listen for `onTriggerEnter`/`onTriggerExit` on the entity's scripts instead.
   *
   * @returns The signal, created on first access.
   */
  get onCollided(): Signal<CharacterCollision2D> {
    this.#onCollided ??= new Signal<CharacterCollision2D>();
    return this.#onCollided;
  }

  /**
   * Teleports the character, clearing any pending motion and the interpolation history.
   *
   * @param position - The new world position of the entity, in metres.
   */
  teleport(position: Vec2Like): void {
    this.#pendingMove.set(0, 0);
    this.#runtime()?.teleportController(this, position);
  }

  /**
   * The displacement requested so far this step, consumed by the step system.
   *
   * @returns A live view of the accumulator.
   *
   * @internal
   */
  takePendingMove(): Vec2 {
    return this.#pendingMove;
  }

  /**
   * Records the outcome of a step.
   *
   * @param movement - What Rapier resolved.
   * @param grounded - Whether the character ended on walkable ground.
   * @param normal - The most upward-facing contact normal, or `null` when there was none.
   * @param deltaSeconds - The fixed step the move covered.
   *
   * @internal
   */
  applyStepResult(movement: Vec2Like, grounded: boolean, normal: Vec2Like | null, deltaSeconds: number): void {
    this.#resolvedMove.set(movement.x, movement.y);
    this.#grounded = grounded;
    this.#lastDelta = deltaSeconds;
    if (normal !== null) {
      this.#groundNormal.set(normal.x, normal.y);
    }
    this.#pendingMove.set(0, 0);
  }

  /**
   * Emits `onCollided` if anything is listening.
   *
   * @param collision - The obstacle to report.
   *
   * @internal
   */
  reportHit(collision: CharacterCollision2D): void {
    this.#onCollided?.emit(collision);
  }

  /**
   * The runtime, or `null` when the extension is not registered on this app.
   *
   * @returns The runtime.
   */
  #runtime(): Physics2DRuntime | null {
    return this.app.services.tryGet(Physics2DHostKey)?.runtime ?? null;
  }
}

/**
 * Builds the `CharacterController2D` schema.
 *
 * @returns The schema.
 */
function characterSchema(): Schema {
  return defineSchema({
    shape: enumOf(CHARACTER_SHAPES_2D, "capsule"),
    radius: f32(0.25, { min: 0 }),
    height: f32(1, { min: 0 }),
    offset: vec2(),
    slopeLimit: f32(45, { min: 0, max: 90 }),
    stepOffset: f32(0, { min: 0 }),
    snapToGround: f32(0, { min: 0 }),
    skinWidth: f32(0.01, { min: 0 }),
    onOneWayPlatforms: bool(true),
    pushBodies: bool(false),
    interpolation: enumOf(INTERPOLATION_MODES_2D, "interpolate"),
  });
}
