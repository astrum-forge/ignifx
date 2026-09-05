// oxlint-disable eslint/no-underscore-dangle -- the stubs below mimic Babylon Lite's own internal field names, which is the whole point of the ADR-0013 layout guard
import { CharacterSupportedState, PhysicsMotionType, PhysicsPrestepType, PhysicsShapeType } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { SupportState } from "../../src/lite/character.js";
import { loadHavok } from "../../src/lite/havok-module.js";
import { BodyMotion, PrestepMode, ShapeGeometry } from "../../src/lite/havok.js";
import { probeCollisionLayout } from "../../src/lite/internal/collision-drain.js";
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

describe("the ADR-0013 layout probe", () => {
  it("rejects every shape that is not the world it was written against", () => {
    const events = { COLLISION_STARTED: { value: 1 }, COLLISION_CONTINUED: { value: 2 } };
    const complete = {
      _hknp: {
        HEAPU8: { buffer: new ArrayBuffer(8) },
        EventType: events,
        HP_World_GetCollisionEvents: (): readonly [unknown, number] => [0, 0],
        HP_World_GetNextCollisionEvent: (): number => 0,
      },
      _hkWorld: {},
      _bodies: [],
    };
    expect(probeCollisionLayout(complete)).toBe(true);

    // Each field the drain reads is removed in turn; every one of them is a kill switch.
    expect(probeCollisionLayout({ ...complete, _hknp: undefined })).toBe(false);
    expect(probeCollisionLayout({ ...complete, _hkWorld: undefined })).toBe(false);
    expect(probeCollisionLayout({ ...complete, _bodies: undefined })).toBe(false);
    expect(
      probeCollisionLayout({ ...complete, _hknp: { ...complete._hknp, HP_World_GetCollisionEvents: undefined } }),
    ).toBe(false);
    expect(
      probeCollisionLayout({ ...complete, _hknp: { ...complete._hknp, HP_World_GetNextCollisionEvent: undefined } }),
    ).toBe(false);
    expect(probeCollisionLayout({ ...complete, _hknp: { ...complete._hknp, EventType: {} } })).toBe(false);
    expect(
      probeCollisionLayout({
        ...complete,
        _hknp: { ...complete._hknp, EventType: { COLLISION_STARTED: { value: 1 } } },
      }),
    ).toBe(false);
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
