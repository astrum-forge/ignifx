import { createApp, defineExtension, Vec2 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { PHYSICS_2D_ERROR_MESSAGES, Physics2DErrorCode, physics2DError } from "../../src/errors.js";
import { physics2d } from "../../src/extension.js";
import { createPhysicsMaterial2DLoader, parsePhysicsMaterial2D, PhysicsMaterial2D } from "../../src/material.js";
import { describeSchemas } from "../../src/schemas.js";
import { Physics2DService } from "../../src/service.js";
import { defaultPhysics2DSettings, physics2DSettingsSchema } from "../../src/settings.js";
import { createPhysics2DApp } from "../support/harness.js";
import type { App, Extension, ExtensionContext } from "@ignifx/core";

/**
 * Registration, settings, the `ignifx.physicsmaterial` loader, the error table, the schema
 * descriptions, and the "one physics extension per world" rule of `11-2d-toolkit.md` §8.
 */

/**
 * An extension that publishes a simulation scene, standing in for `@ignifx/physics` without
 * depending on it — `physics()` is what really claims the slot, through the same kernel hook.
 *
 * @returns The extension descriptor.
 */
const fakeThreeDPhysics: () => Extension = defineExtension(() => {
  let context: ExtensionContext | null = null;
  return {
    name: "test/fake-3d-physics",
    version: "0.0.0",
    engine: ">=0.0.0 <1.0.0",
    register(ctx: ExtensionContext): void {
      context = ctx;
    },
    onStart(app: App): void {
      // The kernel only stores the reference, so the world's own scene stands in for a simulation
      // one — claiming the slot is all `physics()` does through this same hook.
      context?.setSimulationScene(app.world.lite.scene);
    },
  };
});

describe("physics2d registration", () => {
  it("publishes app.physics2d, the settings section, and the components", async () => {
    const harness = await createPhysics2DApp();
    try {
      expect(harness.app.physics2d).toBeInstanceOf(Physics2DService);
      expect(harness.app.services.get(Physics2DService)).toBe(harness.app.physics2d);
      expect(harness.settings.gravity.y).toBeCloseTo(-9.81, 5);
      const crate = harness.world.createEntity("Crate");
      crate.addComponent(BoxCollider2D);
      crate.addComponent(Rigidbody2D);
      expect(harness.world.components(Rigidbody2D).length).toBe(1);
    } finally {
      harness.dispose();
    }
  });

  it("reads gravity and the solver iteration count from settings", async () => {
    const harness = await createPhysics2DApp({
      settings: { physics2d: { gravity: { x: 2, y: 0 }, velocityIterations: 8 } },
    });
    try {
      const body = harness.world.createEntity("Body");
      body.addComponent(BoxCollider2D);
      body.addComponent(Rigidbody2D);
      harness.stepMany(30);
      expect(body.transform.position.x).toBeGreaterThan(0);
      expect(harness.app.physics2d.gravity.x).toBeCloseTo(2, 5);
    } finally {
      harness.dispose();
    }
  });

  it("lets a game change gravity at runtime", async () => {
    const harness = await createPhysics2DApp();
    try {
      const body = harness.world.createEntity("Body");
      body.transform.position = { x: 0, y: 0, z: 0 };
      body.addComponent(BoxCollider2D);
      body.addComponent(Rigidbody2D);
      harness.app.physics2d.gravity = new Vec2(0, 20);
      harness.stepMany(30);
      expect(body.transform.position.y).toBeGreaterThan(0);
    } finally {
      harness.dispose();
    }
  });

  it("throws IGX-1101 when a 3D physics extension already claimed the world", async () => {
    await expect(createPhysics2DApp({ extensions: [fakeThreeDPhysics()] })).rejects.toThrow(/IGX-1101/u);
  });

  it("reports IGX-1150 when Rapier cannot be instantiated", async () => {
    const failing = physics2d({
      initialize: (): Promise<void> => Promise.reject(new Error("no WebAssembly here")),
    });
    const app = await createApp({ headless: true, extensions: [failing] });
    try {
      // `onStart` is where the module is instantiated, so the failure surfaces from `start()`.
      await expect(app.start()).rejects.toThrow(/IGX-1150/u);
    } finally {
      app.dispose();
    }
  });

  it("tears the world down on dispose and can be started again", async () => {
    const first = await createPhysics2DApp();
    first.dispose();
    const second = await createPhysics2DApp();
    try {
      const body = second.world.createEntity("Body");
      body.transform.position = { x: 0, y: 4, z: 0 };
      body.addComponent(BoxCollider2D);
      second.stepMany(5);
      expect(body.transform.position.y).toBeLessThan(4.01);
    } finally {
      second.dispose();
    }
  });
});

describe("physics2d settings", () => {
  it("describes its section and its defaults", () => {
    const schema = physics2DSettingsSchema();
    expect(Object.keys(schema).toSorted()).toEqual([
      "collisionMatrix",
      "defaultMaterial",
      "gravity",
      "interpolation",
      "velocityIterations",
    ]);
    const defaults = defaultPhysics2DSettings();
    expect(defaults.gravity).toEqual({ x: 0, y: -9.81 });
    expect(defaults.interpolation).toBe(true);
    expect(defaults.defaultMaterial.friction).toBeCloseTo(0.6, 5);
  });
});

describe("physics material", () => {
  it("parses an ignifx.physicsmaterial document", () => {
    const material = parsePhysicsMaterial2D("materials/ice.physicsmaterial.json", {
      format: "ignifx.physicsmaterial",
      name: "ice",
      friction: 0.02,
      restitution: 0.1,
    });
    expect(material.name).toBe("ice");
    expect(material.friction).toBeCloseTo(0.02, 5);
    expect(material.restitution).toBeCloseTo(0.1, 5);
  });

  it("fills in the coefficients a document omits", () => {
    const material = parsePhysicsMaterial2D("m.physicsmaterial.json", { format: "ignifx.physicsmaterial" });
    expect(material.friction).toBeCloseTo(0.6, 5);
    expect(material.restitution).toBe(0);
    expect(material.name).toBe("m.physicsmaterial.json");
  });

  it("refuses a document that is not one, or is from the future, with IGX-1154", () => {
    expect(() => parsePhysicsMaterial2D("a.json", { format: "something-else" })).toThrow(/IGX-1154/u);
    expect(() => parsePhysicsMaterial2D("a.json", [1, 2])).toThrow(/IGX-1154/u);
    expect(() => parsePhysicsMaterial2D("a.json", { format: "ignifx.physicsmaterial", formatVersion: 99 })).toThrow(
      /IGX-1154/,
    );
  });

  it("registers a loader for .physicsmaterial.json", () => {
    const loader = createPhysicsMaterial2DLoader();
    expect(loader.type).toBe("physicsmaterial");
    expect(loader.extensions).toEqual([".physicsmaterial.json"]);
  });

  it("builds a material in code", () => {
    const bouncy = PhysicsMaterial2D.fromValues("bouncy", { restitution: 0.9 });
    expect(bouncy.restitution).toBeCloseTo(0.9, 5);
    expect(bouncy.friction).toBeCloseTo(0.6, 5);
    expect(PhysicsMaterial2D.assetType).toBe("physicsmaterial");
  });

  it("bounces a body according to its collider's inline material", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, {
        size: { x: 20, y: 1 },
        inlineMaterial: { friction: 0.2, restitution: 0.9 },
        restitutionCombine: "max",
      });
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 5, z: 0 };
      ball.addComponent(BoxCollider2D);
      const rigidbody = ball.addComponent(Rigidbody2D, { interpolation: "none" });
      harness.stepMany(70);
      // It has hit the floor and is on its way back up.
      expect(rigidbody.linearVelocity.y).toBeGreaterThan(1);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("physics2d diagnostics vocabulary", () => {
  it("describes every component for the documentation harness", () => {
    const schemas = describeSchemas();
    expect(Object.keys(schemas).toSorted()).toEqual([
      "ignifx/BoxCollider2D",
      "ignifx/CapsuleCollider2D",
      "ignifx/CharacterController2D",
      "ignifx/CircleCollider2D",
      "ignifx/EdgeCollider2D",
      "ignifx/PolygonCollider2D",
      "ignifx/Rigidbody2D",
      "ignifx/TilemapCollider2D",
    ]);
    expect(schemas["ignifx/Rigidbody2D"]?.fields["mass"]?.default).toBe(1);
    expect(schemas["ignifx/BoxCollider2D"]?.fields["oneWay"]?.default).toBe(false);
  });

  it("declares a message for every code it owns", () => {
    for (const code of Object.values(Physics2DErrorCode)) {
      expect(PHYSICS_2D_ERROR_MESSAGES[code]).toBeTypeOf("string");
    }
    const error = physics2DError(Physics2DErrorCode.queryBeforeStep, "nope", {
      context: { query: "raycast" },
      hint: "step first",
      cause: new Error("root"),
    });
    expect(error.code).toBe("IGX-1153");
    expect(error.hint).toBe("step first");
  });
});
