import { LayerMask, MeshAsset } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController } from "../../src/components/character-controller.js";
import {
  BoxCollider,
  CapsuleCollider,
  CylinderCollider,
  MeshCollider,
  SphereCollider,
} from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { PhysicsErrorCode } from "../../src/errors.js";
import { loadHavokForTests } from "../lite/fixtures/havok.js";
import { createPhysicsApp } from "../support/harness.js";

/**
 * The edges of the component vocabulary: every `direction` a capsule can stand along, negative
 * scale, the explicit `collisionEvents` and `kinematicSync` modes, and the paths a controller takes
 * before its Lite object exists (`docs/architecture/09-physics.md` §2).
 */

describe("collider edges", () => {
  it("stands a capsule along each axis", async () => {
    for (const direction of ["x", "y", "z"] as const) {
      // Sequential on purpose: three Havok worlds at once would be three simulations competing for
      // the same process, and each case asserts a resting pose rather than a race.
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      const harness = await createPhysicsApp();
      try {
        harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
        const capsule = harness.world.createEntity("Capsule");
        capsule.transform.position = { x: 0, y: 5, z: 0 };
        capsule.addComponent(CapsuleCollider, { radius: 0.4, height: 2, direction });
        capsule.addComponent(Rigidbody, {
          interpolation: "none",
          freezeRotation: { x: true, y: true, z: true },
        });
        harness.stepMany(240);
        // Standing along Y the capsule rests on a hemisphere cap at half its height; lying along X
        // or Z it rests on its side, one radius up.
        const expected = direction === "y" ? 1.5 : 0.9;
        expect(capsule.transform.position.y).toBeCloseTo(expected, 1);
      } finally {
        harness.dispose();
      }
    }
  }, 60_000);

  it("uses the magnitude of a negative scale, which Havok cannot mirror", async () => {
    const harness = await createPhysicsApp();
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
      const box = harness.world.createEntity("Mirrored");
      box.transform.position = { x: 0, y: 6, z: 0 };
      box.transform.localScale.set(-1, -2, -1);
      box.addComponent(BoxCollider, { size: { x: 1, y: 1, z: 1 } });
      box.addComponent(Rigidbody, { interpolation: "none", freezeRotation: { x: true, y: true, z: true } });
      harness.stepMany(240);
      // |−2| gives a half-height of 1, so it rests at 0.5 + 1.
      expect(box.transform.position.y).toBeCloseTo(1.5, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("scales a sphere by the largest axis and a cylinder by its widest radius", async () => {
    const harness = await createPhysicsApp();
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: -4, y: 6, z: 0 };
      ball.transform.localScale.set(1, 3, 1);
      ball.addComponent(SphereCollider, { radius: 0.5 });
      ball.addComponent(Rigidbody, { interpolation: "none" });

      const drum = harness.world.createEntity("Drum");
      drum.transform.position = { x: 4, y: 6, z: 0 };
      drum.transform.localScale.set(2, 1, 1);
      drum.addComponent(CylinderCollider, { radius: 0.5, height: 1 });
      drum.addComponent(Rigidbody, { interpolation: "none", freezeRotation: { x: true, y: true, z: true } });

      harness.stepMany(300);
      // The sphere's radius follows the largest scale axis: 0.5 * 3 = 1.5.
      expect(ball.transform.position.y).toBeCloseTo(2, 1);
      expect(drum.transform.position.y).toBeCloseTo(1, 1);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("refuses a MeshCollider whose mesh asset has no geometry", async () => {
    const harness = await createPhysicsApp();
    try {
      const codes: string[] = [];
      harness.app.onError.connect((report) => {
        codes.push((report.error as { code?: string }).code ?? "");
      });
      const mesh = MeshAsset.box(harness.app, { size: 1 });
      const prop = harness.world.createEntity("Prop");
      prop.addComponent(MeshCollider, { mesh, convex: true, includeChildren: false });
      harness.step();
      expect(codes).toContain(PhysicsErrorCode.colliderGeometryUnavailable);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("respects an explicit collisionEvents mode", async () => {
    const harness = await createPhysicsApp({ collisionIdentities: "internal" });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
      // Lite only streams a contact when the participating bodies carry the event mask
      // (`lib/physics/havok-collision.js`), so both sides opt in explicitly.
      floor.addComponent(Rigidbody, { bodyType: "static", collisionEvents: "on" });

      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 2, z: 0 };
      box.addComponent(BoxCollider);
      // No script implements a collision callback, so `"auto"` would leave the stream off; `"on"`
      // asks Havok for it anyway, which is what a game that reads `app.diagnostics` wants.
      box.addComponent(Rigidbody, { interpolation: "none", collisionEvents: "on" });

      const group = harness.app.diagnostics.group("physics");
      const counter = group?.index("collisionEvents") ?? 0;
      let total = 0;
      for (let step = 0; step < 60; step += 1) {
        harness.step();
        total += group?.get(counter) ?? 0;
      }
      expect(total).toBeGreaterThan(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("drives a kinematic body by velocity when kinematicSync says so", async () => {
    const harness = await createPhysicsApp();
    try {
      const platform = harness.world.createEntity("Platform");
      platform.transform.position = { x: 0, y: 2, z: 0 };
      platform.addComponent(BoxCollider, { size: { x: 4, y: 0.5, z: 4 } });
      platform.addComponent(Rigidbody, {
        bodyType: "kinematic",
        kinematicSync: "velocity",
        interpolation: "none",
      });
      harness.stepMany(10);
      expect(platform.transform.position.y).toBeCloseTo(2, 3);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("builds an explicitly static body and one that starts asleep", async () => {
    const harness = await createPhysicsApp();
    try {
      const wall = harness.world.createEntity("Wall");
      wall.transform.position = { x: 0, y: 2, z: 0 };
      wall.addComponent(BoxCollider);
      wall.addComponent(Rigidbody, { bodyType: "static" });

      const sleeper = harness.world.createEntity("Sleeper");
      sleeper.transform.position = { x: 6, y: 6, z: 0 };
      sleeper.addComponent(BoxCollider);
      sleeper.addComponent(Rigidbody, { startAsleep: true, interpolation: "none" });

      harness.stepMany(60);
      expect(wall.transform.position.y).toBeCloseTo(2, 4);
      expect(sleeper.transform.position.y).toBeCloseTo(6, 4);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("character controller edges", () => {
  it("tolerates every call made before its Lite object exists", async () => {
    const harness = await createPhysicsApp();
    try {
      const player = harness.world.createEntity("Player");
      const controller = player.addComponent(CharacterController);
      // The Lite controller is built at the start of the next fixed step, so everything here runs
      // against a component with no runtime object behind it yet.
      controller.setVelocity({ x: 1, y: 0, z: 0 });
      expect(controller.velocity.x).toBe(0);
      controller.setHeight(1.2, false);
      controller.teleport({ x: 3, y: 0, z: 0 });
      expect(player.transform.position.x).toBeCloseTo(3, 4);
      expect(controller.isGrounded).toBe(false);
      expect(controller.supportState).toBe("unsupported");

      harness.stepMany(4);
      expect(controller.height).toBe(1.2);
      // With no listener, reporting a push is a no-op rather than a failure.
      controller.reportPush({ other: null, impulse: { x: 0, y: 0, z: 0 }, point: { x: 0, y: 0, z: 0 } });
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("releases its Lite controller when the component is removed", async () => {
    const harness = await createPhysicsApp();
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 } });
      const player = harness.world.createEntity("Player");
      player.transform.position = { x: 0, y: 1.4, z: 0 };
      const controller = player.addComponent(CharacterController);
      harness.stepMany(4);
      player.removeComponent(controller);
      harness.stepMany(4);
      const resting = player.transform.position.y;
      harness.stepMany(4);
      // Nothing writes the transform any more.
      expect(player.transform.position.y).toBe(resting);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("query shapes", () => {
  it("sweeps and measures with a capsule and a box, filtered by layer", async () => {
    const harness = await createPhysicsApp({ settings: { layers: ["Default", "Ground"] } });
    try {
      const wall = harness.world.createEntity("Wall");
      wall.layer = harness.world.layers.requireIndex("Ground");
      wall.addComponent(BoxCollider, { size: { x: 1, y: 4, z: 4 } });
      harness.stepMany(2);

      const capsuleHit = harness.app.physics.shapeCast(
        { kind: "capsule", radius: 0.25, height: 1 },
        { x: -5, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { layerMask: LayerMask.fromNames(harness.world.layers, ["Ground"]) },
      );
      expect(capsuleHit?.entity?.name).toBe("Wall");

      const masked = harness.app.physics.shapeCast(
        { kind: "box", size: { x: 0.5, y: 0.5, z: 0.5 } },
        { x: -5, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { layerMask: LayerMask.fromNames(harness.world.layers, ["Default"]) },
      );
      // Lite's sweep still finds the geometry; the layer mask is what decides the *entity*, and
      // `Wall` is not in the mask, so the hit is reported without one.
      expect(masked?.entity ?? null).toBeNull();

      expect(
        harness.app.physics.distanceToNearest({ kind: "capsule", radius: 0.25, height: 1 }, { x: 6, y: 0, z: 0 }, 20),
      ).toBeGreaterThan(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("world velocity limits", () => {
  it("clamps a falling body's speed when the project sets one", async () => {
    const harness = await createPhysicsApp({
      settings: { physics: { velocityLimits: { linear: 2, angular: 1 } } },
    });
    try {
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 40, z: 0 };
      box.addComponent(BoxCollider);
      const body = box.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(120);
      // Two seconds of free fall would reach about 19.6 m/s; the world clamp holds it at 2.
      expect(Math.abs(body.linearVelocity.y)).toBeLessThan(2.5);
      expect(box.transform.position.y).toBeGreaterThan(30);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("the extension's options", () => {
  it("accepts explicit wasm bytes and an explicit havokWasm URL", async () => {
    // Both branches of "where do the bytes come from" that `physics()` and the settings section
    // offer: `wasmBinary` short-circuits the URL entirely, and a non-`"auto"` `havokWasm` bypasses
    // the manifest lookup.
    const module = await loadHavokForTests();
    expect(module).toBeDefined();
    const harness = await createPhysicsApp({ settings: { physics: { havokWasm: "assets/HavokPhysics.wasm" } } });
    try {
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 4, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      harness.stepMany(10);
      expect(box.transform.position.y).toBeLessThan(4);
    } finally {
      harness.dispose();
    }
  }, 60_000);
});

describe("without the extension registered", () => {
  it("leaves the components inert instead of failing", async () => {
    // `Rigidbody`, the colliders, and `CharacterController` reach the runtime through
    // `app.services.tryGet`, so a scene that carries them still loads on an app that never
    // registered `physics()` — the shape `04-extensions.md` §1 prescribes for optional integrations.
    const { createApp, createManualClock, createMemorySink } = await import("@ignifx/core");
    const app = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink() });
    try {
      app.registerComponents([BoxCollider, Rigidbody, CharacterController]);
      await app.start();
      const entity = app.world.createEntity("Orphan");
      const collider = entity.addComponent(BoxCollider);
      const body = entity.addComponent(Rigidbody);
      const controller = app.world.createEntity("Walker").addComponent(CharacterController);

      collider.rebuild();
      body.rebuild();
      controller.rebuild();
      body.addForce({ x: 1, y: 0, z: 0 });
      body.addImpulse({ x: 1, y: 0, z: 0 });
      body.linearVelocity = { x: 1, y: 0, z: 0 };
      body.angularVelocity = { x: 1, y: 0, z: 0 };
      body.teleport({ x: 1, y: 2, z: 3 });
      controller.move({ x: 1, y: 0, z: 0 });
      app.step(1 / 60);

      expect(body.lite.body).toBeNull();
      expect(body.linearVelocity.x).toBe(0);
      expect(body.angularVelocity.x).toBe(0);
      // `teleport` goes through the runtime too, so with no extension it moves nothing.
      expect(entity.transform.position.x).toBe(0);
      expect(controller.velocity.x).toBe(0);
    } finally {
      app.dispose();
    }
  }, 30_000);
});
