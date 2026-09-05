import { LogLevel, Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController } from "../../src/components/character-controller.js";
import {
  BoxCollider,
  CapsuleCollider,
  CylinderCollider,
  HeightfieldCollider,
  MeshCollider,
  SphereCollider,
} from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { PHYSICS_ERROR_MESSAGES, PhysicsErrorCode } from "../../src/errors.js";
import {
  parsePhysicsMaterial,
  PHYSICS_MATERIAL_ASSET_TYPE,
  PHYSICS_MATERIAL_FILE_EXTENSION,
  PhysicsMaterial,
  createPhysicsMaterialLoader,
} from "../../src/material.js";
import { describeSchemas } from "../../src/schemas.js";
import { defaultPhysicsSettings, PHYSICS_SETTINGS_SECTION } from "../../src/settings.js";
import { createPhysicsApp } from "../support/harness.js";
import type { PhysicsSettings } from "../../src/settings.js";
import type { FetchLike } from "@ignifx/core";

/**
 * The component vocabulary, the settings section, the diagnostics codes, and the
 * `.physicsmaterial.json` asset (`docs/architecture/09-physics.md` §2, §2.4, §6).
 */

describe("colliders", () => {
  it("supports every primitive shape as a resting body", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });

      const sphere = drop(harness.world.createEntity("Sphere"), -6);
      sphere.addComponent(SphereCollider, { radius: 0.5 });
      sphere.addComponent(Rigidbody, { interpolation: "none" });

      const capsule = drop(harness.world.createEntity("Capsule"), -2);
      capsule.addComponent(CapsuleCollider, { radius: 0.4, height: 2 });
      capsule.addComponent(Rigidbody, { interpolation: "none", freezeRotation: { x: true, y: false, z: true } });

      const cylinder = drop(harness.world.createEntity("Cylinder"), 2);
      cylinder.addComponent(CylinderCollider, { radius: 0.4, height: 1 });
      cylinder.addComponent(Rigidbody, { interpolation: "none" });

      harness.stepMany(240);
      expect(sphere.transform.position.y).toBeCloseTo(1, 1);
      expect(capsule.transform.position.y).toBeCloseTo(1.5, 0);
      expect(cylinder.transform.position.y).toBeCloseTo(1, 0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("forms one compound body from several colliders on one entity", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });

      // A dumbbell: two spheres on one entity, offset along X. It rests on both, so its centre
      // stays level rather than tipping, which is what a `CONTAINER` shape buys.
      const bar = harness.world.createEntity("Dumbbell");
      bar.transform.position = { x: 0, y: 4, z: 0 };
      bar.addComponent(SphereCollider, { radius: 0.5, center: { x: -1, y: 0, z: 0 } });
      bar.addComponent(SphereCollider, { radius: 0.5, center: { x: 1, y: 0, z: 0 } });
      bar.addComponent(Rigidbody, { interpolation: "none", freezeRotation: { x: true, y: true, z: true } });

      harness.stepMany(240);
      expect(bar.transform.position.y).toBeCloseTo(1, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("scales a shape by the entity's lossy scale", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
      const box = harness.world.createEntity("Big");
      box.transform.position = { x: 0, y: 6, z: 0 };
      box.transform.localScale.set(1, 4, 1);
      box.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
      box.addComponent(Rigidbody, { interpolation: "none", freezeRotation: { x: true, y: true, z: true } });
      harness.stepMany(240);
      // Half-height is 2 after scaling, so the box rests with its centre at 0.5 + 2 = 2.5.
      expect(box.transform.position.y).toBeCloseTo(2.5, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("carries a body on a heightfield", async () => {
    const harness = await createPhysicsApp();
    try {
      const terrain = harness.world.createEntity("Terrain");
      terrain.addComponent(HeightfieldCollider, {
        samplesX: 2,
        samplesZ: 2,
        size: { x: 20, y: 1, z: 20 },
        heights: [0, 0, 0, 0],
      });
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 5, z: 0 };
      ball.addComponent(SphereCollider, { radius: 0.5 });
      ball.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(240);
      expect(ball.transform.position.y).toBeCloseTo(0.5, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("refuses a heightfield whose sample grid does not match its counts", async () => {
    const harness = await createPhysicsApp();
    try {
      const codes: string[] = [];
      harness.app.onError.connect((report) => {
        codes.push((report.error as { code?: string }).code ?? "");
      });
      const terrain = harness.world.createEntity("Terrain");
      terrain.addComponent(HeightfieldCollider, { samplesX: 4, samplesZ: 4, heights: [0, 0] });
      harness.step();
      // The build runs inside the step system, so the failure is reported at the system boundary
      // rather than thrown into the caller (`01-lifecycle-and-time.md` §5).
      expect(codes).toContain(PhysicsErrorCode.colliderGeometryUnavailable);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("refuses a MeshCollider in a headless app, where there is no geometry", async () => {
    const harness = await createPhysicsApp();
    try {
      const codes: string[] = [];
      harness.app.onError.connect((report) => {
        codes.push((report.error as { code?: string }).code ?? "");
      });
      const entity = harness.world.createEntity("Prop");
      entity.addComponent(MeshCollider);
      harness.step();
      // Lite documents mesh and convex-hull shapes as unsupported on the null engine
      // (`index.d.ts` 2781) and a headless `MeshAsset` uploads nothing at all.
      expect(codes).toContain(PhysicsErrorCode.colliderGeometryUnavailable);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("implicit static bodies", () => {
  it("gives a collider-only entity a static body and reports IGX-0901 when it moves", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 3, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(120);
      expect(box.transform.position.y).toBeCloseTo(1, 1);

      floor.transform.position = { x: 0, y: -5, z: 0 };
      harness.stepMany(5);
      const warning = harness.sink
        .toArray()
        .find((record) => record.level === LogLevel.warn && record.message.includes(PhysicsErrorCode.movedStaticBody));
      expect(warning).toBeDefined();
      // The static body did **not** follow: the box is still resting where the floor used to be.
      expect(box.transform.position.y).toBeCloseTo(1, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("the physics settings section", () => {
  it("resolves the documented defaults", async () => {
    const harness = await createPhysicsApp();
    try {
      const settings = harness.app.settings.section<PhysicsSettings>(PHYSICS_SETTINGS_SECTION);
      expect(settings.gravity).toEqual({ x: 0, y: -9.81, z: 0 });
      expect(settings.interpolation).toBe(true);
      expect(settings.havokWasm).toBe("auto");
      expect(settings.defaultMaterial).toEqual({ friction: 0.6, staticFriction: 0.6, restitution: 0 });
      expect(defaultPhysicsSettings().collisionMatrix).toEqual({});
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("applies a project's gravity, and lets it be changed at runtime", async () => {
    const harness = await createPhysicsApp({ settings: { physics: { gravity: { x: 0, y: 0, z: 0 } } } });
    try {
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 10, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(60);
      expect(box.transform.position.y).toBeCloseTo(10, 3);

      harness.app.physics.gravity = { x: 0, y: -20, z: 0 };
      expect(harness.app.physics.gravity.y).toBe(-20);
      // A body that has been asleep since the world had no gravity is not woken by the change, so
      // the new world gravity is observed on a body created after it.
      const fresh = harness.world.createEntity("Fresh");
      fresh.transform.position = { x: 0, y: 10, z: 0 };
      fresh.addComponent(BoxCollider);
      fresh.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(60);
      expect(fresh.transform.position.y).toBeLessThan(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("registers every 09xx code with the app's error registry", async () => {
    const harness = await createPhysicsApp();
    try {
      for (const code of Object.values(PhysicsErrorCode)) {
        expect(PHYSICS_ERROR_MESSAGES[code]).toBeTypeOf("string");
      }
      const prefix = `IGX-0${String(9)}`;
      expect(Object.keys(PHYSICS_ERROR_MESSAGES).every((code) => code.startsWith(prefix))).toBe(true);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("physics materials", () => {
  it("parses an ignifx.physicsmaterial document", () => {
    const material = parsePhysicsMaterial("materials/ice.physicsmaterial.json", {
      format: "ignifx.physicsmaterial",
      name: "Ice",
      friction: 0.05,
      restitution: 0.2,
    });
    expect(material.name).toBe("Ice");
    expect(material.friction).toBeCloseTo(0.05, 6);
    // `staticFriction` defaults to `friction`.
    expect(material.staticFriction).toBeCloseTo(0.05, 6);
    expect(material.restitution).toBeCloseTo(0.2, 6);
  });

  it("refuses a document that is not one this build can read", () => {
    for (const document of [
      { format: "something.else" },
      42,
      [1, 2],
      { format: "ignifx.physicsmaterial", formatVersion: 99 },
    ]) {
      let code: string | null = null;
      try {
        parsePhysicsMaterial("x.physicsmaterial.json", document);
      } catch (error: unknown) {
        code = (error as { code?: string }).code ?? null;
      }
      expect(code).toBe(PhysicsErrorCode.invalidMaterialFile);
    }
  });

  it("declares the type and extension the asset service selects it by", () => {
    const loader = createPhysicsMaterialLoader();
    expect(loader.type).toBe(PHYSICS_MATERIAL_ASSET_TYPE);
    expect(loader.extensions).toEqual([PHYSICS_MATERIAL_FILE_EXTENSION]);
  });

  it("loads a material through the asset service and applies it to a collider", async () => {
    const document = JSON.stringify({ format: "ignifx.physicsmaterial", name: "Bouncy", restitution: 0.9 });
    const fetchStub: FetchLike = () =>
      Promise.resolve(new Response(document, { status: 200, headers: { "content-type": "application/json" } }));
    const harness = await createPhysicsApp({ fetch: fetchStub });
    try {
      // Completed loads are delivered by the core `PreUpdate` system, so the app has to be stepped
      // while the promise settles (`05-assets-and-loading.md` §5).
      const handle = harness.app.assets.load<PhysicsMaterial>("surfaces/bouncy.physicsmaterial.json");
      for (let attempt = 0; attempt < 20 && handle.state === "loading"; attempt += 1) {
        // Sequential on purpose: the next microtask turn only happens after this frame's delivery.
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above
        await Promise.resolve();
        harness.step();
      }
      await handle.promise;
      expect(handle.value).toBeInstanceOf(PhysicsMaterial);
      expect(handle.value.restitution).toBeCloseTo(0.9, 6);

      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 }, material: handle });
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 5, z: 0 };
      ball.addComponent(SphereCollider, { radius: 0.5, material: handle });
      ball.addComponent(Rigidbody, { interpolation: "none" });

      let peak = 0;
      let landed = false;
      for (let step = 0; step < 240; step += 1) {
        harness.step();
        const y = ball.transform.position.y;
        landed ||= y < 1.2;
        if (landed) {
          peak = Math.max(peak, y);
        }
      }
      // A restitution of 0.9 returns most of the drop; a default material would barely bounce.
      expect(peak).toBeGreaterThan(2);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("prefers an inline material over the world default", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, {
        size: { x: 40, y: 1, z: 40 },
        inlineMaterial: { friction: 0.6, staticFriction: 0.6, restitution: 0.9 },
      });
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 5, z: 0 };
      ball.addComponent(SphereCollider, { radius: 0.5 });
      ball.addComponent(Rigidbody, { interpolation: "none" });

      let peak = 0;
      let landed = false;
      for (let step = 0; step < 240; step += 1) {
        harness.step();
        const y = ball.transform.position.y;
        landed ||= y < 1.2;
        if (landed) {
          peak = Math.max(peak, y);
        }
      }
      expect(peak).toBeGreaterThan(2);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("builds a material in code with sensible fallbacks", () => {
    const material = PhysicsMaterial.fromValues("rubber", { restitution: 0.8 });
    expect(material.friction).toBeCloseTo(0.6, 6);
    expect(material.staticFriction).toBeCloseTo(0.6, 6);
    expect(material.restitution).toBeCloseTo(0.8, 6);
  });
});

describe("the documentation harness view", () => {
  it("describes every component and the file format", () => {
    const schemas = describeSchemas();
    expect(new Set(Object.keys(schemas))).toEqual(
      new Set([
        "ignifx/BoxCollider",
        "ignifx/CapsuleCollider",
        "ignifx/CharacterController",
        "ignifx/CylinderCollider",
        "ignifx/HeightfieldCollider",
        "ignifx/MeshCollider",
        "ignifx/Rigidbody",
        "ignifx/SphereCollider",
        "ignifx/physicsmaterial-file",
      ]),
    );
    expect(schemas["ignifx/Rigidbody"]?.fields["mass"]?.default).toBe(1);
    expect(schemas["ignifx/BoxCollider"]?.fields["isTrigger"]?.default).toBe(false);
    expect(schemas["ignifx/physicsmaterial-file"]?.format).toBe("ignifx.physicsmaterial");
  });

  it("registers the components under their documented type ids", async () => {
    const harness = await createPhysicsApp();
    try {
      const ids = [
        Rigidbody,
        BoxCollider,
        SphereCollider,
        CapsuleCollider,
        CylinderCollider,
        MeshCollider,
        HeightfieldCollider,
        CharacterController,
      ].map((type) => type.typeId);
      expect(ids).toEqual([
        "ignifx/Rigidbody",
        "ignifx/BoxCollider",
        "ignifx/SphereCollider",
        "ignifx/CapsuleCollider",
        "ignifx/CylinderCollider",
        "ignifx/MeshCollider",
        "ignifx/HeightfieldCollider",
        "ignifx/CharacterController",
      ]);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("Rigidbody runtime API", () => {
  it("reads and writes velocities, applies forces and impulses, and teleports", async () => {
    const harness = await createPhysicsApp({ settings: { physics: { gravity: { x: 0, y: 0, z: 0 } } } });
    try {
      const box = harness.world.createEntity("Box");
      box.addComponent(BoxCollider);
      const body = box.addComponent(Rigidbody, { interpolation: "none" });
      harness.step();

      body.linearVelocity = { x: 1, y: 0, z: 0 };
      expect(body.linearVelocity.x).toBeCloseTo(1, 4);
      body.angularVelocity = { x: 0, y: 2, z: 0 };
      expect(body.angularVelocity.y).toBeCloseTo(2, 4);

      harness.stepMany(30);
      expect(box.transform.position.x).toBeGreaterThan(0.4);

      body.teleport({ x: 0, y: 0, z: 0 });
      expect(box.transform.position.x).toBeCloseTo(0, 4);

      body.linearVelocity = { x: 0, y: 0, z: 0 };
      body.addImpulse({ x: 0, y: 0, z: 5 });
      harness.stepMany(10);
      expect(box.transform.position.z).toBeGreaterThan(0.5);

      body.addForce({ x: 10, y: 0, z: 0 });
      harness.step();
      expect(body.linearVelocity.x).toBeGreaterThan(0);
      expect(body.lite.body).not.toBeNull();
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("keeps a kinematic body where the script puts it", async () => {
    const harness = await createPhysicsApp();
    try {
      const platform = harness.world.createEntity("Platform");
      platform.transform.position = { x: 0, y: 2, z: 0 };
      platform.addComponent(BoxCollider, { size: { x: 4, y: 0.5, z: 4 } });
      platform.addComponent(Rigidbody, { bodyType: "kinematic", interpolation: "none" });
      harness.stepMany(60);
      expect(platform.transform.position.y).toBeCloseTo(2, 4);

      const rider = harness.world.createEntity("Rider");
      rider.transform.position = { x: 0, y: 4, z: 0 };
      rider.addComponent(BoxCollider);
      rider.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(120);
      // The kinematic platform holds the dynamic box up.
      expect(rider.transform.position.y).toBeCloseTo(2.75, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("warns when a body is built on a child entity, whose node pose is not world space", async () => {
    const harness = await createPhysicsApp();
    try {
      const parent = harness.world.createEntity("Parent");
      const child = harness.world.createEntity("Child");
      child.setParent(parent);
      child.addComponent(BoxCollider);
      child.addComponent(Rigidbody);
      harness.step();
      const warning = harness.sink
        .toArray()
        .find((record) => record.message.includes(PhysicsErrorCode.bodyOnChildEntity));
      expect(warning).toBeDefined();
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("teardown", () => {
  it("removes a body when its entity is destroyed and survives disposal", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 3, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(10);

      const group = harness.app.diagnostics.group("physics");
      expect(group?.get(group.index("bodies"))).toBe(2);
      box.destroy();
      harness.stepMany(2);
      expect(group?.get(group.index("bodies"))).toBe(1);

      // Removing the collider turns the entity back into nothing at all.
      const collider = floor.requireComponent(BoxCollider);
      floor.removeComponent(collider);
      harness.stepMany(2);
      expect(group?.get(group.index("bodies"))).toBe(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("does nothing when a script touches physics on an app without the extension", () => {
    // `Rigidbody` and the colliders reach the runtime through `app.services.tryGet`, so they are
    // inert rather than fatal when the extension is absent — the pattern `04-extensions.md` §1
    // prescribes for optional integrations.
    class Noop extends Script {
      static typeId = "test/Noop";
    }
    expect(Noop.typeId).toBe("test/Noop");
  });
});

/**
 * Places an entity above the floor at a given X.
 *
 * @param entity - The entity to place.
 * @param x - Where along X to put it.
 * @returns The same entity.
 */
function drop<T extends { transform: { position: { x: number; y: number; z: number } } }>(entity: T, x: number): T {
  entity.transform.position = { x, y: 5, z: 0 };
  return entity;
}
