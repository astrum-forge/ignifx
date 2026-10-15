import { CharacterSupportedState, PhysicsMotionType, PhysicsPrestepType, PhysicsShapeType } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { SupportState } from "../../src/lite/character.js";
import { loadHavok } from "../../src/lite/havok-module.js";
import { BodyMotion, PrestepMode, ShapeGeometry } from "../../src/lite/havok.js";
import { havokWasmBytes } from "./fixtures/havok.js";

/**
 * The adapter's own constants and guards. The tables here mirror Babylon Lite's numeric enums, and
 * `isolatedDeclarations` forbids an exported `as const` table from referring to another module's
 * constant, so the ignifx copies are literals — which is exactly what this suite pins.
 */

describe("the adapter's mirrored enums", () => {
  it("matches Babylon Lite's PhysicsMotionType, PhysicsPrestepType, and PhysicsShapeType", () => {
    expect({ ...BodyMotion }).toEqual({
      static: PhysicsMotionType.STATIC,
      kinematic: PhysicsMotionType.ANIMATED,
      dynamic: PhysicsMotionType.DYNAMIC,
    });
    expect({ ...PrestepMode }).toEqual({
      disabled: PhysicsPrestepType.DISABLED,
      teleport: PhysicsPrestepType.TELEPORT,
      velocity: PhysicsPrestepType.ACTION,
    });
    expect({ ...ShapeGeometry }).toEqual({
      sphere: PhysicsShapeType.SPHERE,
      capsule: PhysicsShapeType.CAPSULE,
      cylinder: PhysicsShapeType.CYLINDER,
      box: PhysicsShapeType.BOX,
      convexHull: PhysicsShapeType.CONVEX_HULL,
      container: PhysicsShapeType.CONTAINER,
      mesh: PhysicsShapeType.MESH,
    });
    expect({ ...SupportState }).toEqual({
      unsupported: CharacterSupportedState.UNSUPPORTED,
      sliding: CharacterSupportedState.SLIDING,
      supported: CharacterSupportedState.SUPPORTED,
    });
  });
});

describe("loadHavok's source precedence", () => {
  it("ignores a null module and falls through to the bytes", async () => {
    // `module: null` is what an options object built from a nullable field hands over; it must not
    // be mistaken for an instantiated module.
    const module = await loadHavok({ module: null, wasmBinary: havokWasmBytes() });
    expect(module).toBeDefined();
  }, 60_000);
});
