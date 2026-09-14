import { afterEach, describe, expect, it } from "vitest";
import { particleAssetFromDefinition } from "../../src/assets/loader.js";
import { defineParticles } from "../../src/definition/define-particles.js";
import { createParticleState } from "../../src/evaluate/particle-math.js";
import { ParticleSystem } from "../../src/gpu/particle-system.js";
import {
  PARTICLES_DIAGNOSTICS_COUNTERS,
  PARTICLES_DIAGNOSTICS_GROUP,
  ParticlesService,
} from "../../src/service/particles-service.js";
import { defaultParticlesSettings } from "../../src/settings.js";
import { createParticlesApp, physicsSettingsStub } from "../support/harness.js";
import type { ParticlesAppHarness } from "../support/harness.js";
import type { Vec3Like } from "@ignifx/core";

/** A sixty-fourth of a second. */
const FRAME = 1 / 64;

let harness: ParticlesAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("app.particles", () => {
  it("is the same object the service registry holds", async () => {
    const app = await createParticlesApp();
    harness = app;
    expect(app.app.particles).toBeInstanceOf(ParticlesService);
    expect(app.app.particles).toBe(app.app.services.get(ParticlesService));
  });

  it("starts from the settings section's values", async () => {
    const app = await createParticlesApp();
    harness = app;
    const defaults = defaultParticlesSettings();
    expect(app.app.particles.maxParticles).toBe(defaults.maxParticles);
    expect(app.app.particles.qualityScale).toBe(1);
    expect(app.app.particles.gravity).toEqual(defaults.gravity);
  });

  it("takes the extension's options over the settings section", async () => {
    const app = await createParticlesApp({
      settings: { particles: { maxParticles: 10, qualityScale: 0.2 } },
      particles: { maxParticles: 999, qualityScale: 0.75 },
    });
    harness = app;
    expect(app.app.particles.maxParticles).toBe(999);
    expect(app.app.particles.qualityScale).toBe(0.75);
  });

  it("copies an assigned gravity rather than keeping the caller's object", async () => {
    const app = await createParticlesApp();
    harness = app;
    const mine = { x: 0, y: -3, z: 0 };
    app.app.particles.gravity = mine;
    mine.y = -100;
    expect(app.app.particles.gravity).toEqual({ x: 0, y: -3, z: 0 });
  });

  it("registers the particles diagnostics group with its five counters", async () => {
    const app = await createParticlesApp();
    harness = app;
    const counters = app.app.particles.counters;
    expect(counters?.name).toBe(PARTICLES_DIAGNOSTICS_GROUP);
    for (const name of PARTICLES_DIAGNOSTICS_COUNTERS) {
      expect(counters?.index(name)).toBeGreaterThanOrEqual(0);
    }
  });

  it("lists attached systems in attach order and drops them when they detach", async () => {
    const app = await createParticlesApp();
    harness = app;
    const handle = particleAssetFromDefinition(app.app, defineParticles({}), "test");
    const first = app.world.createEntity("First").addComponent(ParticleSystem, { definition: handle });
    const second = app.world.createEntity("Second").addComponent(ParticleSystem, { definition: handle });
    expect([...app.app.particles.systems]).toEqual([first, second]);
    first.destroy();
    app.step(FRAME);
    expect([...app.app.particles.systems]).toEqual([second]);
  });
});

describe("the particle budget", () => {
  it("hands out capacity until it runs out, then clamps", async () => {
    const app = await createParticlesApp({ particles: { maxParticles: 150 } });
    harness = app;
    const handle = particleAssetFromDefinition(app.app, defineParticles({ main: { capacity: 100 } }), "test");
    const first = app.world.createEntity("First").addComponent(ParticleSystem, { definition: handle });
    const second = app.world.createEntity("Second").addComponent(ParticleSystem, { definition: handle });
    app.step(FRAME);
    expect(first.capacity).toBe(100);
    expect(second.capacity).toBe(50);
    expect(app.app.particles.capacityInUse).toBe(150);
  });

  it("still grants one record to a system that arrives with nothing left", async () => {
    const app = await createParticlesApp({ particles: { maxParticles: 0 } });
    harness = app;
    const handle = particleAssetFromDefinition(app.app, defineParticles({ main: { capacity: 10 } }), "test");
    const system = app.world.createEntity("Late").addComponent(ParticleSystem, { definition: handle });
    app.step(FRAME);
    expect(system.capacity).toBe(1);
  });

  it("gives the capacity back when a system goes away", async () => {
    const app = await createParticlesApp({ particles: { maxParticles: 500 } });
    harness = app;
    const handle = particleAssetFromDefinition(app.app, defineParticles({ main: { capacity: 200 } }), "test");
    const system = app.world.createEntity("One").addComponent(ParticleSystem, { definition: handle });
    app.step(FRAME);
    expect(app.app.particles.capacityInUse).toBe(200);
    system.destroy();
    app.step(FRAME);
    expect(app.app.particles.capacityInUse).toBe(0);
  });
});

describe("shared definition resources", () => {
  it("builds one identity slab big enough for the largest renderer", async () => {
    const app = await createParticlesApp();
    harness = app;
    const slab = app.app.particles.identitySlab(4);
    expect(slab.length).toBeGreaterThanOrEqual(4 * 16);
    expect([...slab.subarray(0, 16)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(app.app.particles.identitySlab(2)).toBe(slab);
    expect(app.app.particles.identitySlab(64).length).toBeGreaterThanOrEqual(64 * 16);
  });

  it("hands two systems playing one document the same shader, lookup and mesh", async () => {
    const app = await createParticlesApp();
    harness = app;
    const asset = particleAssetFromDefinition(app.app, defineParticles({}), "test");
    const service = app.app.particles;
    const first = service.acquireResources(asset.value);
    const second = service.acquireResources(asset.value);
    expect(second).toBe(first);
    service.releaseResources(asset.value);
    service.releaseResources(asset.value);
    expect(service.acquireResources(asset.value)).not.toBe(first);
    service.releaseResources(asset.value);
  });

  it("ignores a release for a document it is not holding", async () => {
    const app = await createParticlesApp();
    harness = app;
    const asset = particleAssetFromDefinition(app.app, defineParticles({}), "test");
    expect(() => {
      app.app.particles.releaseResources(asset.value);
    }).not.toThrow();
  });

  it("builds the primitive a mesh renderer asks for", async () => {
    const app = await createParticlesApp();
    harness = app;
    const service = app.app.particles;
    for (const mesh of ["box", "sphere", "plane", "cylinder", "capsule", "torus"] as const) {
      const asset = particleAssetFromDefinition(
        app.app,
        defineParticles({ renderer: { mode: "mesh", mesh } }),
        `mesh-${mesh}`,
      );
      const resources = service.acquireResources(asset.value);
      expect(resources.mesh.state, mesh).toBe("loaded");
      service.releaseResources(asset.value);
    }
  });

  it("releases everything it holds on dispose, and a second dispose is a no-op", async () => {
    const app = await createParticlesApp();
    harness = app;
    const asset = particleAssetFromDefinition(app.app, defineParticles({}), "test");
    app.app.particles.acquireResources(asset.value);
    app.app.particles.dispose();
    expect(() => {
      app.app.particles.dispose();
    }).not.toThrow();
    expect(app.app.particles.systems).toHaveLength(0);
  });
});

describe("gravity from the physics section", () => {
  it("adopts the physics gravity when the project left the particles one alone", async () => {
    const app = await createParticlesApp({ extensions: [physicsSettingsStub({ x: 0, y: -3, z: 0 })] });
    harness = app;
    expect(app.app.particles.gravity).toEqual({ x: 0, y: -3, z: 0 });
  });

  it("keeps an explicit particles gravity", async () => {
    const app = await createParticlesApp({
      extensions: [physicsSettingsStub({ x: 0, y: -3, z: 0 })],
      settings: { particles: { gravity: { x: 1, y: 2, z: 3 } } },
    });
    harness = app;
    expect(app.app.particles.gravity).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("keeps an explicit extension gravity", async () => {
    const app = await createParticlesApp({
      extensions: [physicsSettingsStub({ x: 0, y: -3, z: 0 })],
      particles: { gravity: { x: 9, y: 9, z: 9 } },
    });
    harness = app;
    expect(app.app.particles.gravity).toEqual({ x: 9, y: 9, z: 9 });
  });

  it("keeps its own default when no physics section exists", async () => {
    const app = await createParticlesApp();
    harness = app;
    expect(app.app.particles.gravity).toEqual(defaultParticlesSettings().gravity);
  });
});

/** What {@link fallAfterOneSecond} drops a particle under. */
interface FallOptions {
  /** The world gravity the app declares. */
  readonly appGravity: Vec3Like;
  /** The definition's own forces module. */
  readonly forces: { readonly gravityMultiplier?: number; readonly gravity?: Vec3Like };
}

describe("the gravity a definition sees", () => {
  /**
   * Drops one particle for a second and reports how far it fell.
   *
   * @param options - The gravity the app declares and the definition's forces.
   * @returns The particle's Y position after one second.
   */
  async function fallAfterOneSecond(options: FallOptions): Promise<number> {
    const app = await createParticlesApp({ particles: { gravity: options.appGravity } });
    harness = app;
    const handle = particleAssetFromDefinition(
      app.app,
      defineParticles({
        main: { simulationSpace: "world" },
        emission: { rateOverTime: 0 },
        shape: { kind: "point" },
        forces: options.forces,
        start: { lifetime: 10, speed: 0 },
      }),
      "test",
    );
    const system = app.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle });
    app.step(0);
    system.emit(1);
    app.stepMany(64, FRAME);
    const state = createParticleState();
    expect(system.evaluate(0, state)).toBe(true);
    return state.position[1] ?? 0;
  }

  it("scales the world gravity by the definition's multiplier", async () => {
    const fall = await fallAfterOneSecond({
      appGravity: { x: 0, y: -10, z: 0 },
      forces: { gravityMultiplier: 0.5 },
    });
    expect(fall).toBeCloseTo(-2.5, 2);
  });

  it("uses an explicit definition gravity instead of the app's", async () => {
    const fall = await fallAfterOneSecond({
      appGravity: { x: 0, y: -100, z: 0 },
      forces: { gravity: { x: 0, y: -2, z: 0 } },
    });
    expect(fall).toBeCloseTo(-1, 2);
  });

  it("ignores the world gravity entirely when the multiplier is zero", async () => {
    const fall = await fallAfterOneSecond({ appGravity: { x: 0, y: -10, z: 0 }, forces: {} });
    expect(fall).toBeCloseTo(0, 5);
  });
});
