/**
 * `@ignifx/physics-2d` public barrel: 2D physics on Rapier — `Rigidbody2D`, the 2D colliders,
 * triggers, `CharacterController2D`, one-way platforms, queries, the layer matrix, and
 * interpolation (`docs/architecture/11-2d-toolkit.md` §8, ADR-0006).
 *
 * Explicit named re-exports only, no `export *` (coding standards §4).
 *
 * @packageDocumentation
 */

// components — the vocabulary a scene file and a script use.
export {
  CHARACTER_SHAPES_2D,
  CharacterController2D,
  type CharacterShape2D,
} from "./components/character-controller.js";
export { collider2DFields, Collider2D, COMBINE_RULES, type CombineRule } from "./components/collider.js";
export {
  BoxCollider2D,
  CAPSULE_2D_DIRECTIONS,
  CapsuleCollider2D,
  CircleCollider2D,
  EdgeCollider2D,
  PolygonCollider2D,
  type Capsule2DDirection,
} from "./components/colliders.js";
export {
  BODY_TYPES_2D,
  COLLISION_EVENT_MODES_2D,
  INTERPOLATION_MODES_2D,
  Rigidbody2D,
  type BodyType2D,
  type CollisionEventMode2D,
  type InterpolationMode2D,
  type Rigidbody2DRapierHandles,
} from "./components/rigidbody.js";
export { TilemapCollider2D } from "./components/tilemap-collider.js";

// errors — the codes this package owns.
export { PHYSICS_2D_ERROR_MESSAGES, Physics2DErrorCode, physics2DError, type Physics2DErrorOptions } from "./errors.js";

// events — the payloads the five physics callbacks receive in a 2D world.
export type { CharacterCollision2D, Collision2D, ContactPoint2D, TriggerEvent2D } from "./events.js";

// extension — the factory a game registers.
export { physics2d, type Physics2DOptions } from "./extension.js";

// material — the `ignifx.physicsmaterial` asset as 2D physics reads it.
export {
  createPhysicsMaterial2DLoader,
  parsePhysicsMaterial2D,
  PHYSICS_MATERIAL_2D_ASSET_TYPE,
  PHYSICS_MATERIAL_2D_FILE_EXTENSION,
  PHYSICS_MATERIAL_2D_FILE_FORMAT,
  PHYSICS_MATERIAL_2D_FORMAT_VERSION,
  PhysicsMaterial2D,
} from "./material.js";

// queries — what `app.physics2d` answers.
export type { QueryOptions2D, RaycastHit2D, ShapeCastHit2D } from "./queries.js";

// runtime — the diagnostics group the devtools panel reads.
export { PHYSICS_2D_DIAGNOSTICS_COUNTERS, PHYSICS_2D_DIAGNOSTICS_GROUP } from "./runtime/runtime.js";

// schemas — the documentation harness entry point.
export { describeSchemas } from "./schemas.js";

// service — `app.physics2d`.
export { Physics2DService, type Physics2DRapierHandles } from "./service.js";

// settings — the `physics2d` project settings section.
export {
  defaultPhysics2DSettings,
  PHYSICS_2D_SETTINGS_SECTION,
  physics2DSettingsSchema,
  type Physics2DMaterialValues,
  type Physics2DSettings,
} from "./settings.js";
