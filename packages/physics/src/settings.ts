import { array, bool, defineSchema, f32, map, record, str, vec3 } from "@ignifx/core";
import type { Schema, Vec3Like } from "@ignifx/core";

/**
 * The `physics` project settings section (`docs/architecture/09-physics.md` §6). `fixedDeltaTime` is
 * **not** here: the fixed step is shared with the core `time` section, and the extension reads it
 * from `app.time.fixedDeltaTime` on every step so a game that changes it at runtime keeps Lite's
 * per-step delta in sync.
 */

/**
 * The section name as it appears in `ignifx.config.ts`.
 *
 * @public
 */
export const PHYSICS_SETTINGS_SECTION = "physics";

/**
 * The value {@link PhysicsSettings.havokWasm} carries when the address comes from the manifest.
 *
 * @public
 */
export const HAVOK_WASM_AUTO = "auto";

/**
 * A surface material, either as the `physics.defaultMaterial` setting or inline on a collider
 * (`09-physics.md` §2.2, §2.4).
 *
 * @public
 */
export interface PhysicsMaterialValues {
  /** The dynamic friction coefficient. */
  readonly friction: number;
  /** The static friction coefficient. */
  readonly staticFriction: number;
  /** How much of the approach speed is returned, `0` to `1`. */
  readonly restitution: number;
}

/**
 * The world-wide speed clamps Havok applies (`setPhysicsVelocityLimits`, `index.d.ts` 10880). A
 * value of `0` means "leave Havok's own default alone".
 *
 * @public
 */
export interface VelocityLimitSettings {
  /** Maximum linear speed in metres per second, or `0` for Havok's default. */
  readonly linear: number;
  /** Maximum angular speed in radians per second, or `0` for Havok's default. */
  readonly angular: number;
}

/**
 * The resolved `physics` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default {
 *   layers: { layers: ["Default", "Player", "Enemy"] },
 *   physics: {
 *     gravity: { x: 0, y: -9.81, z: 0 },
 *     collisionMatrix: { Player: ["Default", "Enemy"], Enemy: ["Default"] },
 *   },
 * };
 * ```
 *
 * @public
 */
export interface PhysicsSettings {
  /** World gravity in metres per second squared. */
  readonly gravity: Vec3Like;
  /**
   * Which layers each layer collides with. A layer the map does not mention collides with
   * everything, which is what makes the default project need no matrix at all.
   */
  readonly collisionMatrix: Readonly<Record<string, readonly string[]>>;
  /** The material a collider with no material of its own uses. */
  readonly defaultMaterial: PhysicsMaterialValues;
  /** The world speed clamps. */
  readonly velocityLimits: VelocityLimitSettings;
  /** Whether dynamic bodies and character controllers interpolate between fixed steps. */
  readonly interpolation: boolean;
  /** `"auto"` to resolve `HavokPhysics.wasm` through the asset manifest, or an explicit URL. */
  readonly havokWasm: string;
}

/** Standard gravity, matching Lite's own Havok default. */
const DEFAULT_GRAVITY: Vec3Like = Object.freeze({ x: 0, y: -9.81, z: 0 });

/** The default surface: ordinary friction, no bounce. */
const DEFAULT_MATERIAL: PhysicsMaterialValues = Object.freeze({
  friction: 0.6,
  staticFriction: 0.6,
  restitution: 0,
});

/** No clamps beyond Havok's own. */
const DEFAULT_VELOCITY_LIMITS: VelocityLimitSettings = Object.freeze({ linear: 0, angular: 0 });

/** An empty matrix, which means "everything collides with everything". */
const DEFAULT_COLLISION_MATRIX: Readonly<Record<string, readonly string[]>> = Object.freeze({});

/**
 * Builds the schema the `physics` section is validated against.
 *
 * @remarks
 * It is a function, not a module-level constant: every field kind is a function call, and module
 * scope holds declarations and immutable constants only (`CONSTITUTION.md` §3.5).
 *
 * @returns The schema.
 *
 * @public
 */
export function physicsSettingsSchema(): Schema {
  return defineSchema({
    gravity: vec3(DEFAULT_GRAVITY),
    collisionMatrix: map(array(str())),
    defaultMaterial: record({
      friction: f32(DEFAULT_MATERIAL.friction, { min: 0 }),
      staticFriction: f32(DEFAULT_MATERIAL.staticFriction, { min: 0 }),
      restitution: f32(DEFAULT_MATERIAL.restitution, { min: 0, max: 1 }),
    }),
    velocityLimits: record({
      linear: f32(DEFAULT_VELOCITY_LIMITS.linear, { min: 0 }),
      angular: f32(DEFAULT_VELOCITY_LIMITS.angular, { min: 0 }),
    }),
    interpolation: bool(true),
    havokWasm: str(HAVOK_WASM_AUTO),
  });
}

/**
 * The values used when a project omits the `physics` section.
 *
 * @returns A fresh defaults object.
 *
 * @public
 */
export function defaultPhysicsSettings(): PhysicsSettings {
  return {
    gravity: DEFAULT_GRAVITY,
    collisionMatrix: DEFAULT_COLLISION_MATRIX,
    defaultMaterial: DEFAULT_MATERIAL,
    velocityLimits: DEFAULT_VELOCITY_LIMITS,
    interpolation: true,
    havokWasm: HAVOK_WASM_AUTO,
  };
}
