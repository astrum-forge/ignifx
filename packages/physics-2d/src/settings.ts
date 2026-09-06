import { array, bool, defineSchema, f32, map, record, str, u32, vec2 } from "@ignifx/core";
import type { Schema, Vec2Like } from "@ignifx/core";

/**
 * The `physics2d` project settings section (`docs/architecture/11-2d-toolkit.md` §8,
 * `09-physics.md` §6). It mirrors the 3D `physics` section with a 2D gravity vector and Rapier's
 * solver knob in place of Havok's world velocity clamps, which Rapier has no equivalent of.
 *
 * `fixedDeltaTime` is **not** here: the fixed step is shared with the core `time` section and the
 * extension reads it from `app.time.fixedDeltaTime` on every step.
 */

/**
 * The section name as it appears in `ignifx.config.ts`.
 *
 * @public
 */
export const PHYSICS_2D_SETTINGS_SECTION = "physics2d";

/**
 * A surface, either as the `physics2d.defaultMaterial` setting or inline on a collider.
 *
 * @public
 */
export interface Physics2DMaterialValues {
  /** The friction coefficient. */
  readonly friction: number;
  /** How much of the approach speed is returned, `0` to `1`. */
  readonly restitution: number;
}

/**
 * The resolved `physics2d` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default {
 *   layers: { layers: ["Default", "Player", "Enemy"] },
 *   physics2d: {
 *     gravity: { x: 0, y: -9.81 },
 *     collisionMatrix: { Player: ["Default", "Enemy"], Enemy: ["Default"] },
 *   },
 * };
 * ```
 *
 * @public
 */
export interface Physics2DSettings {
  /** World gravity in metres per second squared; +Y is up (`11-2d-toolkit.md` §3). */
  readonly gravity: Vec2Like;
  /**
   * Which layers each layer collides with. A layer the map does not mention collides with
   * everything, which is what makes the default project need no matrix at all.
   */
  readonly collisionMatrix: Readonly<Record<string, readonly string[]>>;
  /** The surface a collider with no material of its own uses. */
  readonly defaultMaterial: Physics2DMaterialValues;
  /** How many iterations Rapier's constraint solver runs; `0` leaves Rapier's own default (4). */
  readonly velocityIterations: number;
  /** Whether dynamic bodies and character controllers interpolate between fixed steps. */
  readonly interpolation: boolean;
}

/** Standard gravity in the 2D plane. */
const DEFAULT_GRAVITY: Vec2Like = Object.freeze({ x: 0, y: -9.81 });

/** The default surface: ordinary friction, no bounce — the same numbers the 3D section uses. */
const DEFAULT_MATERIAL: Physics2DMaterialValues = Object.freeze({ friction: 0.6, restitution: 0 });

/** An empty matrix, which means "everything collides with everything". */
const DEFAULT_COLLISION_MATRIX: Readonly<Record<string, readonly string[]>> = Object.freeze({});

/**
 * Builds the schema the `physics2d` section is validated against.
 *
 * @remarks
 * It is a function, not a module-level constant: every field kind is a function call, and module
 * scope holds declarations and immutable constants only (`CONSTITUTION.md` §3.5).
 *
 * @returns The schema.
 *
 * @public
 */
export function physics2DSettingsSchema(): Schema {
  return defineSchema({
    gravity: vec2(DEFAULT_GRAVITY),
    collisionMatrix: map(array(str())),
    defaultMaterial: record({
      friction: f32(DEFAULT_MATERIAL.friction, { min: 0 }),
      restitution: f32(DEFAULT_MATERIAL.restitution, { min: 0, max: 1 }),
    }),
    velocityIterations: u32(0),
    interpolation: bool(true),
  });
}

/**
 * The values used when a project omits the `physics2d` section.
 *
 * @returns A fresh defaults object.
 *
 * @public
 */
export function defaultPhysics2DSettings(): Physics2DSettings {
  return {
    gravity: DEFAULT_GRAVITY,
    collisionMatrix: DEFAULT_COLLISION_MATRIX,
    defaultMaterial: DEFAULT_MATERIAL,
    velocityIterations: 0,
    interpolation: true,
  };
}
