import { TWO_D_SYNC_ORDER } from "@ignifx/2d";
import { PARTICLE_UPDATE_ORDER, defineParticles, particleAssetFromDefinition } from "@ignifx/particles";
import { afterEach, describe, expect, it } from "vitest";
import {
  PARTICLE_2D_UPDATE_ORDER,
  PARTICLE_2D_WRITE_ORDER,
  PARTICLES_2D_DIAGNOSTICS_COUNTERS,
  PARTICLES_2D_DIAGNOSTICS_GROUP,
  ParticleSystem2D,
  particles2D,
  Particles2DService,
  VERSION,
} from "../src/index.js";
import { createParticles2DApp, requireService } from "./support/app.js";
import type { Particles2DAppHarness } from "./support/app.js";
import type { SpriteAtlasAsset } from "@ignifx/2d";

/**
 * What `particles2D()` contributes (`docs/architecture/04-extensions.md` §3): the component, the
 * service, the counters, and the two systems in their phases.
 */

let harness: Particles2DAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the particles2D extension", () => {
  it("declares itself with the packages it needs", () => {
    const extension = particles2D();
    expect(extension.name).toBe("@ignifx/particles-2d");
    expect(extension.version).toBe(VERSION);
    expect(extension.requires).toEqual(["@ignifx/core", "@ignifx/2d", "@ignifx/particles"]);
  });

  it("writes its sprites before the 2D sync system reads them", () => {
    expect(PARTICLE_2D_WRITE_ORDER).toBeLessThan(TWO_D_SYNC_ORDER);
    expect(PARTICLE_2D_UPDATE_ORDER).toBe(PARTICLE_UPDATE_ORDER);
  });

  it("registers the service, the component and the counters", async () => {
    harness = await createParticles2DApp();
    const service = requireService(harness.app, Particles2DService);
    expect(service.systems).toHaveLength(0);
    expect(service.counters?.name).toBe(PARTICLES_2D_DIAGNOSTICS_GROUP);
    expect(service.counters?.counterNames).toEqual(PARTICLES_2D_DIAGNOSTICS_COUNTERS);
  });

  it("publishes what its systems drew into the particles-2d counters", async () => {
    harness = await createParticles2DApp();
    const atlas = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(
      harness.app,
      defineParticles({
        main: { capacity: 16, duration: 1, looping: true, seed: 4 },
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 3 }] },
        shape: { kind: "point" },
        start: { lifetime: 5, speed: 0, size: 0.3 },
      }),
      "memory:counters.particles.json",
    );
    harness.app.world.createEntity("fx").addComponent(ParticleSystem2D, { definition, atlas });
    harness.step();
    harness.step();

    const counters = requireService(harness.app, Particles2DService).counters;
    expect(counters).not.toBeNull();
    expect(counters?.get(counters.index("systems"))).toBe(1);
    expect(counters?.get(counters.index("alive"))).toBe(3);
    expect(counters?.get(counters.index("sprites"))).toBe(3);
    expect(counters?.get(counters.index("emitted"))).toBe(0);
  });

  it("forgets its systems when the app is disposed", async () => {
    const created = await createParticles2DApp();
    const service = requireService(created.app, Particles2DService);
    const atlas = await created.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(
      created.app,
      defineParticles({ main: { capacity: 8, seed: 1 } }),
      "memory:empty.particles.json",
    );
    created.app.world.createEntity("fx").addComponent(ParticleSystem2D, { definition, atlas });
    created.step();
    expect(service.systems).toHaveLength(1);

    created.dispose();
    expect(service.systems).toHaveLength(0);
  });
});
