import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

/**
 * The public surface of `@ignifx/physics`. The list is spelled out so that adding or removing an
 * export is a deliberate, reviewable change — the same guard `@ignifx/core` keeps on its own barrel
 * (coding standards §4).
 */

/** Every value the barrel exports, sorted. */
const EXPECTED_VALUES: readonly string[] = [
  "BODY_TYPES",
  "BoxCollider",
  "CAPSULE_DIRECTIONS",
  "COLLISION_EVENT_MODES",
  "COLLISION_IDENTITY_MODES",
  "CapsuleCollider",
  "CharacterController",
  "Collider",
  "CylinderCollider",
  "HAVOK_WASM_AUTO",
  "HeightfieldCollider",
  "INTERPOLATION_MODES",
  "KINEMATIC_SYNC_MODES",
  "MeshCollider",
  "PHYSICS_DIAGNOSTICS_COUNTERS",
  "PHYSICS_DIAGNOSTICS_GROUP",
  "PHYSICS_ERROR_MESSAGES",
  "PHYSICS_MATERIAL_ASSET_TYPE",
  "PHYSICS_MATERIAL_FILE_EXTENSION",
  "PHYSICS_MATERIAL_FILE_FORMAT",
  "PHYSICS_MATERIAL_FORMAT_VERSION",
  "PHYSICS_SETTINGS_SECTION",
  "PhysicsErrorCode",
  "PhysicsMaterial",
  "PhysicsService",
  "Rigidbody",
  "SUPPORT_STATES",
  "SphereCollider",
  "colliderFields",
  "createPhysicsMaterialLoader",
  "defaultPhysicsSettings",
  "describePhysicsMaterialFileFormat",
  "describeSchemas",
  "parsePhysicsMaterial",
  "physics",
  "physicsError",
  "physicsSettingsSchema",
];

describe("@ignifx/physics barrel", () => {
  it("exports exactly the documented surface", () => {
    expect(new Set(Object.keys(barrel))).toEqual(new Set(EXPECTED_VALUES));
  });

  it("does nothing at import time", () => {
    // `CONSTITUTION.md` §3.5: module scope holds declarations and immutable constants only. The
    // extension factory builds its descriptor when a game calls it, never on import.
    expect(barrel.physics).toBeTypeOf("function");
    const extension = barrel.physics();
    expect(extension.name).toBe("@ignifx/physics");
    expect(extension.engine).toBe(">=0.0.0 <1.0.0");
    expect(extension.requires).toEqual([]);
    expect(extension.optional).toEqual(["@ignifx/devtools"]);
  });

  it("names the diagnostics group and its counters", () => {
    expect(barrel.PHYSICS_DIAGNOSTICS_GROUP).toBe("physics");
    expect(barrel.PHYSICS_DIAGNOSTICS_COUNTERS).toEqual([
      "bodies",
      "activeBodies",
      "stepsThisFrame",
      "collisionEvents",
      "triggerEvents",
      "queries",
      "stepMs",
    ]);
  });

  it("declares the shared collider fields once", () => {
    expect(new Set(Object.keys(barrel.colliderFields()))).toEqual(
      new Set(["center", "inlineMaterial", "isTrigger", "layerOverride", "material"]),
    );
  });
});
