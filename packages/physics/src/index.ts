/**
 * `@ignifx/physics` public barrel: 3D physics on Havok through Babylon Lite — rigidbodies,
 * colliders, triggers, the character controller, queries, the layer matrix, and interpolation
 * (`docs/architecture/09-physics.md`).
 *
 * Explicit named re-exports only, no `export *` (coding standards §4).
 *
 * @packageDocumentation
 */

// components — the vocabulary a scene file and a script use.
export { CharacterController, SUPPORT_STATES, type SupportStateName } from "./components/character-controller.js";
export { Collider, colliderFields } from "./components/collider.js";
export {
  BoxCollider,
  CAPSULE_DIRECTIONS,
  CapsuleCollider,
  CylinderCollider,
  HeightfieldCollider,
  MeshCollider,
  SphereCollider,
  type CapsuleDirection,
} from "./components/colliders.js";
export {
  BODY_TYPES,
  COLLISION_EVENT_MODES,
  INTERPOLATION_MODES,
  KINEMATIC_SYNC_MODES,
  Rigidbody,
  type BodyType,
  type CollisionEventMode,
  type FreezeRotation,
  type InterpolationMode,
  type KinematicSyncMode,
  type RigidbodyLiteHandles,
} from "./components/rigidbody.js";

// errors — the 09xx code space this package owns.
export { PHYSICS_ERROR_MESSAGES, PhysicsErrorCode, physicsError, type PhysicsErrorOptions } from "./errors.js";

// events — the payloads the five physics callbacks receive.
export type { CharacterCollision, Collision, ContactPoint, TriggerEvent } from "./events.js";

// extension — the factory a game registers.
export { physics, type PhysicsOptions } from "./extension.js";

// material — the `.physicsmaterial.json` asset, its loader, and its format description.
export {
  createPhysicsMaterialLoader,
  describePhysicsMaterialFileFormat,
  parsePhysicsMaterial,
  PHYSICS_MATERIAL_ASSET_TYPE,
  PHYSICS_MATERIAL_FILE_EXTENSION,
  PHYSICS_MATERIAL_FILE_FORMAT,
  PHYSICS_MATERIAL_FORMAT_VERSION,
  PhysicsMaterial,
} from "./material.js";

// queries — what `app.physics` answers.
export type { QueryOptions, QueryShape, RaycastHit, ShapeCastHit } from "./queries.js";

// runtime — the diagnostics group name and the collision-identity modes the options accept.
export {
  COLLISION_IDENTITY_MODES,
  PHYSICS_DIAGNOSTICS_COUNTERS,
  PHYSICS_DIAGNOSTICS_GROUP,
  type CollisionIdentityMode,
} from "./runtime/runtime.js";

// schemas — the documentation harness entry point.
export { describeSchemas } from "./schemas.js";

// service — `app.physics`.
export { PhysicsService, type PhysicsDebugViewer, type PhysicsLiteHandles } from "./service.js";

// settings — the `physics` project settings section.
export {
  defaultPhysicsSettings,
  HAVOK_WASM_AUTO,
  PHYSICS_SETTINGS_SECTION,
  physicsSettingsSchema,
  type PhysicsMaterialValues,
  type PhysicsSettings,
  type VelocityLimitSettings,
} from "./settings.js";
