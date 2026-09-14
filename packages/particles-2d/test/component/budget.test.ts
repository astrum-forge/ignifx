import { defineParticles, ParticleSystem, particleAssetFromDefinition, ParticlesService } from "@ignifx/particles";
import { afterEach, describe, expect, it } from "vitest";
import { ParticleSystem2D } from "../../src/index.js";
import { createParticles2DApp, requireService } from "../support/app.js";
import type { Particles2DAppHarness } from "../support/app.js";
import type { SpriteAtlasAsset } from "@ignifx/2d";

/**
 * One budget for both dimensions (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3): a 2D
 * system reserves its capacity from `app.particles`, so `maxParticles` and `qualityScale` mean the
 * same thing whichever renderer draws the effect.
 */

/** An effect asking for 600 records, so two of them do not fit a 1,000 budget. */
function hungry(): ReturnType<typeof defineParticles> {
  return defineParticles({
    main: { capacity: 600, duration: 1, looping: true, seed: 2 },
    emission: { rateOverTime: 120 },
    shape: { kind: "point" },
    start: { lifetime: 4, speed: 0, size: 0.2 },
  });
}

let harness: Particles2DAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the shared particle budget", () => {
  it("counts a 2D system against app.particles like a 3D one", async () => {
    harness = await createParticles2DApp({ settings: { particles: { maxParticles: 1000 } } });
    const atlas = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(harness.app, hungry(), "memory:hungry.particles.json");
    const service = requireService(harness.app, ParticlesService);

    const solid = harness.app.world.createEntity("solid").addComponent(ParticleSystem, { definition });
    const flat = harness.app.world.createEntity("flat").addComponent(ParticleSystem2D, { definition, atlas });
    harness.step();

    expect(solid.capacity).toBe(600);
    // 400 of the 1,000 were left, so the 2D system was clamped and told the developer why.
    expect(flat.capacity).toBe(400);
    expect(service.capacityInUse).toBe(1000);
    const clamped = harness.log
      .toArray()
      .map((record) => record.message)
      .filter((message) => message.includes("IGX-1702"));
    expect(clamped).toHaveLength(1);
  });

  it("gives the capacity back when the 2D system is destroyed", async () => {
    harness = await createParticles2DApp({ settings: { particles: { maxParticles: 1000 } } });
    const atlas = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(harness.app, hungry(), "memory:hungry.particles.json");
    const service = requireService(harness.app, ParticlesService);
    const entity = harness.app.world.createEntity("flat");
    entity.addComponent(ParticleSystem2D, { definition, atlas });
    harness.step();
    expect(service.capacityInUse).toBe(600);

    entity.destroy();
    harness.step();
    expect(service.capacityInUse).toBe(0);
  });

  it("scales 2D emission with app.particles.qualityScale", async () => {
    harness = await createParticles2DApp();
    const atlas = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(harness.app, hungry(), "memory:hungry.particles.json");
    const flat = harness.app.world.createEntity("flat").addComponent(ParticleSystem2D, { definition, atlas });
    requireService(harness.app, ParticlesService).qualityScale = 0.25;
    for (let frame = 0; frame < 30; frame += 1) {
      harness.step();
    }
    const quartered = flat.aliveCount;

    requireService(harness.app, ParticlesService).qualityScale = 1;
    for (let frame = 0; frame < 30; frame += 1) {
      harness.step();
    }
    expect(flat.aliveCount).toBeGreaterThan(quartered * 2);
  });
});
