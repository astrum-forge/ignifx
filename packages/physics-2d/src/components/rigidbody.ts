import { bool, Component, createDefaults, defineSchema, enumOf, f32, Vec2 } from "@ignifx/core";
import { Physics2DHostKey } from "../runtime/runtime-key.js";
import type { RapierBody } from "../lite/rapier/world.js";
import type { Physics2DRuntime } from "../runtime/runtime.js";
import type { ComponentHooks, MutableVec2, Schema, Vec2Like } from "@ignifx/core";

/**
 * A nonzero mass rescales collider densities while preserving their inertia distribution.
 * Zero keeps the default density of 1 kg/m². Rotation has one freeze flag; damping is per body.
 * Automatic collision events follow callbacks as components join or leave the entity.
 */

/**
 * How a 2D body moves.
 *
 * @public
 */
export const BODY_TYPES_2D = ["dynamic", "kinematic", "static"] as const;

/**
 * The union of {@link BODY_TYPES_2D}.
 *
 * @public
 */
export type BodyType2D = (typeof BODY_TYPES_2D)[number];

/**
 * Whether a body's display pose is interpolated between fixed steps.
 *
 * @public
 */
export const INTERPOLATION_MODES_2D = ["none", "interpolate"] as const;

/**
 * The union of {@link INTERPOLATION_MODES_2D}.
 *
 * @public
 */
export type InterpolationMode2D = (typeof INTERPOLATION_MODES_2D)[number];

/**
 * Whether collision callbacks are delivered for this body.
 *
 * @public
 */
export const COLLISION_EVENT_MODES_2D = ["auto", "on", "off"] as const;

/**
 * The union of {@link COLLISION_EVENT_MODES_2D}.
 *
 * @public
 */
export type CollisionEventMode2D = (typeof COLLISION_EVENT_MODES_2D)[number];

/**
 * The Rapier objects a `Rigidbody2D` owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface Rigidbody2DRapierHandles {
  /** The Rapier body, or `null` before the first fixed step has built it. */
  readonly body: RapierBody | null;
}

/**
 * Makes an entity's 2D colliders a Rapier body.
 *
 * @example
 * ```ts
 * const crate = world.createEntity("Crate");
 * crate.transform.position2D = new Vec2(0, 5);
 * crate.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
 * crate.addComponent(Rigidbody2D, { mass: 2 });
 * ```
 *
 * @public
 */
export class Rigidbody2D extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/Rigidbody2D";

  /** One body per entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = rigidbody2DSchema();

  declare bodyType: BodyType2D;

  declare mass: number;

  declare gravityScale: number;

  declare linearDamping: number;

  declare angularDamping: number;

  declare freezeRotation: boolean;

  declare interpolation: InterpolationMode2D;

  declare collisionEvents: CollisionEventMode2D;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Rigidbody2D.schema));
  }

  /** Marks the entity's body for a rebuild at the start of the next fixed step. */
  onAttach(): void {
    this.rebuild();
  }

  /** Marks the entity's body for a rebuild, which turns it back into an implicit static body. */
  onDetach(): void {
    this.rebuild();
  }

  /**
   * Rebuilds the body at the start of the next fixed step. Call it after changing `bodyType`,
   * `mass`, `freezeRotation`, damping, or the entity's scale.
   */
  rebuild(): void {
    this.#runtime()?.markDirty(this.entity);
  }

  /**
   * The Rapier handles this component owns.
   *
   * @returns The body, or `null` before the first fixed step built it.
   */
  get rapier(): Rigidbody2DRapierHandles {
    return { body: this.#runtime()?.bodyHandleOf(this.entity) ?? null };
  }

  /**
   * The body's linear velocity in metres per second.
   *
   * @returns A freshly allocated vector; use {@link Rigidbody2D.linearVelocityToRef} in hot code.
   */
  get linearVelocity(): Vec2 {
    const out = new Vec2();
    this.linearVelocityToRef(out);
    return out;
  }

  /**
   * Replaces the body's linear velocity.
   *
   * @param value - Metres per second, world space.
   */
  set linearVelocity(value: Vec2Like) {
    this.#runtime()?.setLinearVelocity(this.entity, value);
  }

  /**
   * Reads the linear velocity without allocating.
   *
   * @param out - The vector to write.
   * @returns `out`.
   */
  linearVelocityToRef(out: MutableVec2): MutableVec2 {
    this.#runtime()?.readLinear(this.entity, out);
    return out;
  }

  /**
   * The body's angular velocity.
   *
   * @returns Degrees per second, counter-clockwise — the same unit as `Transform.rotation2D`.
   */
  get angularVelocity(): number {
    return this.#runtime()?.readAngular(this.entity) ?? 0;
  }

  /**
   * Replaces the body's angular velocity.
   *
   * @param value - Degrees per second, counter-clockwise.
   */
  set angularVelocity(value: number) {
    this.#runtime()?.setAngularVelocity(this.entity, value);
  }

  /**
   * The mass Rapier computed for the body, in kilograms.
   *
   * @returns The mass, or `0` before the body exists.
   */
  get computedMass(): number {
    return this.#runtime()?.massOf(this.entity) ?? 0;
  }

  /**
   * Applies a force for one fixed step. Call it from `fixedUpdate`.
   *
   * @param force - Newtons, world space.
   * @param point - Where to apply it; defaults to the centre of mass.
   *
   * @example
   * ```ts
   * fixedUpdate(): void {
   *   this.body.addForce({ x: 0, y: 20 });
   * }
   * ```
   */
  addForce(force: Vec2Like, point?: Vec2Like): void {
    this.#runtime()?.addForce(this.entity, force, point ?? null);
  }

  /**
   * Applies an instantaneous impulse.
   *
   * @param impulse - Newton-seconds, world space.
   * @param point - Where to apply it; defaults to the centre of mass.
   */
  addImpulse(impulse: Vec2Like, point?: Vec2Like): void {
    this.#runtime()?.addImpulse(this.entity, impulse, point ?? null);
  }

  /**
   * Applies a torque for one fixed step.
   *
   * @param torque - Newton-metres, positive counter-clockwise.
   */
  addTorque(torque: number): void {
    this.#runtime()?.addTorque(this.entity, torque);
  }

  /**
   * Moves the body without integrating a velocity, and resets the interpolation history so the
   * display pose does not slide across the gap.
   *
   * @param position - The new world position, in metres.
   * @param rotation - The new rotation in degrees counter-clockwise; defaults to the current one.
   */
  teleport(position: Vec2Like, rotation?: number): void {
    this.#runtime()?.teleport(this.entity, position, rotation ?? this.transform.rotation2D);
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
 * Builds the `Rigidbody2D` schema.
 *
 * @returns The schema.
 */
function rigidbody2DSchema(): Schema {
  return defineSchema({
    bodyType: enumOf(BODY_TYPES_2D, "dynamic"),
    mass: f32(1, { min: 0 }),
    gravityScale: f32(1),
    linearDamping: f32(0, { min: 0 }),
    angularDamping: f32(0.05, { min: 0 }),
    freezeRotation: bool(false),
    interpolation: enumOf(INTERPOLATION_MODES_2D, "interpolate"),
    collisionEvents: enumOf(COLLISION_EVENT_MODES_2D, "auto"),
  });
}
