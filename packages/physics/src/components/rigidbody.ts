import { bool, Component, createDefaults, defineSchema, enumOf, f32, record, Vec3 } from "@ignifx/core";
import { PhysicsHostKey } from "../runtime/runtime-key.js";
import type { LitePhysicsBody } from "../lite/havok.js";
import type { PhysicsRuntime } from "../runtime/runtime.js";
import type { ComponentHooks, MutableVec3, QuatLike, Schema, Vec3Like } from "@ignifx/core";

/**
 * The `Rigidbody` component (`docs/architecture/09-physics.md` §2.1): what makes an entity's
 * colliders a simulated, kinematic, or explicitly static Havok body.
 *
 * ## Corrections to §2.1, all forced by `@babylonjs/lite@1.27.0`
 *
 * - **`collisionEvents` is a three-valued enum, not a boolean.** §2.1 describes a field whose value
 *   is "auto"; a schema field has one kind and one value (ADR-0004), so the field is
 *   `"auto" | "on" | "off"` and `"auto"` is the default. `"auto"` is what §2.1 actually specifies:
 *   recomputed from `ctx.entityImplements` whenever a component is added to or removed from the
 *   entity.
 * - **`velocityLimits` is not a per-body field.** Lite exposes `setPhysicsVelocityLimits(world, …)`
 *   only (`index.d.ts` 10880) — there is no per-body clamp — so the limits live in the `physics`
 *   settings section and the field is absent.
 * - **A body's entity must be a root entity.** Lite's post-step sync writes `node.position` and
 *   `node.rotationQuaternion`, which are *local* values (`lib/physics/havok.js:_syncBodyToNode`), so
 *   a parented entity would be simulated in its parent's space. The extension reports `IGX-0907`
 *   and simulates it anyway rather than silently misplacing it.
 *
 * Not available in Lite 1.27.0 and therefore absent, as §2.1 already records: per-body damping,
 * per-body gravity factor, sleep thresholds, and an explicit `wakeUp()`.
 */

/**
 * How a body moves.
 *
 * @public
 */
export const BODY_TYPES = ["dynamic", "kinematic", "static"] as const;

/**
 * The union of {@link BODY_TYPES}.
 *
 * @public
 */
export type BodyType = (typeof BODY_TYPES)[number];

/**
 * Whether a body's display pose is interpolated between fixed steps.
 *
 * @public
 */
export const INTERPOLATION_MODES = ["none", "interpolate"] as const;

/**
 * The union of {@link INTERPOLATION_MODES}.
 *
 * @public
 */
export type InterpolationMode = (typeof INTERPOLATION_MODES)[number];

/**
 * Whether collision callbacks are delivered for this body.
 *
 * @public
 */
export const COLLISION_EVENT_MODES = ["auto", "on", "off"] as const;

/**
 * The union of {@link COLLISION_EVENT_MODES}.
 *
 * @public
 */
export type CollisionEventMode = (typeof COLLISION_EVENT_MODES)[number];

/**
 * How a moved kinematic node reaches Havok.
 *
 * @public
 */
export const KINEMATIC_SYNC_MODES = ["teleport", "velocity"] as const;

/**
 * The union of {@link KINEMATIC_SYNC_MODES}.
 *
 * @public
 */
export type KinematicSyncMode = (typeof KINEMATIC_SYNC_MODES)[number];

/**
 * Whether each rotation axis is frozen.
 *
 * @public
 */
export interface FreezeRotation {
  /** Freeze rotation about X. */
  readonly x: boolean;
  /** Freeze rotation about Y. */
  readonly y: boolean;
  /** Freeze rotation about Z. */
  readonly z: boolean;
}

/**
 * The Babylon Lite objects a `Rigidbody` owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface RigidbodyLiteHandles {
  /** The Havok body, or `null` before the first fixed step has built it. */
  readonly body: LitePhysicsBody | null;
}

/**
 * Makes an entity's colliders a Havok body (`09-physics.md` §2.1).
 *
 * @example
 * ```ts
 * const crate = world.createEntity("Crate");
 * crate.transform.position = { x: 0, y: 5, z: 0 };
 * crate.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
 * crate.addComponent(Rigidbody, { mass: 2 });
 * ```
 *
 * @public
 */
export class Rigidbody extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/Rigidbody";

  /** One body per entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = rigidbodySchema();

  declare bodyType: BodyType;

  declare mass: number;

  declare startAsleep: boolean;

  declare freezeRotation: FreezeRotation;

  declare interpolation: InterpolationMode;

  declare collisionEvents: CollisionEventMode;

  declare kinematicSync: KinematicSyncMode;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Rigidbody.schema));
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
   * `mass`, `freezeRotation`, or the entity's scale.
   */
  rebuild(): void {
    this.#runtime()?.markDirty(this.entity);
  }

  /**
   * The Babylon Lite handles this component owns.
   *
   * @returns The Havok body, or `null` before the first fixed step built it.
   */
  get lite(): RigidbodyLiteHandles {
    return { body: this.#runtime()?.bodyHandleOf(this.entity) ?? null };
  }

  /**
   * The body's linear velocity in metres per second.
   *
   * @returns A freshly allocated vector; use {@link Rigidbody.linearVelocityToRef} in hot code.
   */
  get linearVelocity(): Vec3 {
    const out = new Vec3();
    this.linearVelocityToRef(out);
    return out;
  }

  /**
   * Replaces the body's linear velocity.
   *
   * @param value - Metres per second, world space.
   */
  set linearVelocity(value: Vec3Like) {
    this.#runtime()?.setLinearVelocity(this.entity, value);
  }

  /**
   * Reads the linear velocity without allocating.
   *
   * @param out - The vector to write.
   * @returns `out`.
   */
  linearVelocityToRef(out: MutableVec3): MutableVec3 {
    this.#runtime()?.readLinear(this.entity, out);
    return out;
  }

  /**
   * The body's angular velocity in radians per second.
   *
   * @returns A freshly allocated vector; use {@link Rigidbody.angularVelocityToRef} in hot code.
   */
  get angularVelocity(): Vec3 {
    const out = new Vec3();
    this.angularVelocityToRef(out);
    return out;
  }

  /**
   * Replaces the body's angular velocity.
   *
   * @param value - Radians per second, world space.
   */
  set angularVelocity(value: Vec3Like) {
    this.#runtime()?.setAngularVelocity(this.entity, value);
  }

  /**
   * Reads the angular velocity without allocating.
   *
   * @param out - The vector to write.
   * @returns `out`.
   */
  angularVelocityToRef(out: MutableVec3): MutableVec3 {
    this.#runtime()?.readAngular(this.entity, out);
    return out;
  }

  /**
   * Applies a force for one fixed step. Call it from `fixedUpdate`.
   *
   * @param force - Newtons, world space.
   * @param point - Where to apply it; defaults to the entity's world position.
   *
   * @example
   * ```ts
   * fixedUpdate(): void {
   *   this.body.addForce({ x: 0, y: 20, z: 0 });
   * }
   * ```
   */
  addForce(force: Vec3Like, point?: Vec3Like): void {
    this.#runtime()?.addForce(this.entity, force, point ?? this.transform.position);
  }

  /**
   * Applies an instantaneous impulse.
   *
   * @param impulse - Newton-seconds, world space.
   * @param point - Where to apply it; defaults to the entity's world position.
   */
  addImpulse(impulse: Vec3Like, point?: Vec3Like): void {
    this.#runtime()?.addImpulse(this.entity, impulse, point ?? this.transform.position);
  }

  /**
   * Moves the body without integrating a velocity, and resets the interpolation history so the
   * display pose does not slide across the gap.
   *
   * @param position - The new world position.
   * @param rotation - The new world rotation; defaults to the current one.
   */
  teleport(position: Vec3Like, rotation?: QuatLike): void {
    this.#runtime()?.teleport(this.entity, position, rotation ?? this.transform.rotation);
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
 * Builds the `Rigidbody` schema.
 *
 * @returns The schema.
 */
function rigidbodySchema(): Schema {
  return defineSchema({
    bodyType: enumOf(BODY_TYPES, "dynamic"),
    mass: f32(1, { min: 0 }),
    startAsleep: bool(false),
    freezeRotation: record({ x: bool(false), y: bool(false), z: bool(false) }),
    interpolation: enumOf(INTERPOLATION_MODES, "interpolate"),
    collisionEvents: enumOf(COLLISION_EVENT_MODES, "auto"),
    kinematicSync: enumOf(KINEMATIC_SYNC_MODES, "teleport"),
  });
}
