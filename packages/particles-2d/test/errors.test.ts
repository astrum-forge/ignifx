import { twoD, TwoDService } from "@ignifx/2d";
import { createApp, createMemorySink, defineExtension } from "@ignifx/core";
import { defineParticles, particles, particleAssetFromDefinition, ParticlesService } from "@ignifx/particles";
import { afterEach, describe, expect, it } from "vitest";
import {
  PARTICLES_2D_ERROR_MESSAGES,
  ParticleSystem2D,
  particles2D,
  Particles2DErrorCode,
  Particles2DService,
} from "../src/index.js";
import { createParticles2DApp } from "./support/app.js";
import type { Particles2DAppHarness } from "./support/app.js";
import type { SpriteAtlasAsset } from "@ignifx/2d";
import type { Extension, ExtensionContext } from "@ignifx/core";

/**
 * Every `IGX-175#` code this package owns, triggered through the API that reports it
 * (coding standards §5.5). The budget warning a clamped 2D system logs is `IGX-1702`, which belongs
 * to `@ignifx/particles`; `budget.test.ts` covers it.
 */

/** How many characters of a code are the prefix before its four digits. */
const CODE_PREFIX_LENGTH = 4;

/** A one-particle effect, so a test can reach the failure without waiting for emission. */
function tiny(): ReturnType<typeof defineParticles> {
  return defineParticles({
    main: { capacity: 8, duration: 1, looping: true, seed: 3 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: 1 }] },
    shape: { kind: "point" },
    start: { lifetime: 5, speed: 0, size: 0.25 },
  });
}

let harness: Particles2DAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Everything the app logged that names a code. */
function logged(code: string): readonly string[] {
  return (harness?.log.toArray() ?? []).map((record) => record.message).filter((message) => message.includes(code));
}

describe("the particles-2d error table", () => {
  it("declares a message template for every code it can report", () => {
    for (const code of Object.values(Particles2DErrorCode)) {
      expect(PARTICLES_2D_ERROR_MESSAGES[code]).toBeTypeOf("string");
    }
    expect(Object.keys(PARTICLES_2D_ERROR_MESSAGES)).toHaveLength(Object.values(Particles2DErrorCode).length);
  });

  it("keeps every code inside the 1750-1799 range the plan assigned", () => {
    for (const code of Object.values(Particles2DErrorCode)) {
      const number = Number(code.slice(CODE_PREFIX_LENGTH));
      expect(number).toBeGreaterThanOrEqual(1750);
      expect(number).toBeLessThanOrEqual(1799);
    }
  });
});

describe("a misused 2D particle system", () => {
  it("refuses a second registration of the service with IGX-1751", async () => {
    // The kernel refuses a second `particles2D()` by name (`IGX-0406`), so the guard is reached
    // through a second extension that claims the same service.
    const squatter: () => Extension = defineExtension(() => ({
      name: "game/squatter",
      version: "0.0.0",
      requires: ["@ignifx/2d", "@ignifx/particles"],
      register(ctx: ExtensionContext): void {
        const service = new Particles2DService(ctx.require(ParticlesService), ctx.require(TwoDService), ["Default"]);
        ctx.registerService(Particles2DService, service);
      },
    }));
    await expect(
      createApp({ headless: true, extensions: [twoD(), particles(), squatter(), particles2D()] }),
    ).rejects.toThrow(/IGX-1751/u);
  });

  it("refuses play() without a definition with IGX-1752", async () => {
    harness = await createParticles2DApp();
    const system = harness.app.world.createEntity("fx").addComponent(ParticleSystem2D);
    expect(() => system.play()).toThrow(/IGX-1752/u);
    expect(() => system.emit(1)).toThrow(/IGX-1752/u);
  });

  it("refuses a nonsense emit or simulate with IGX-1753", async () => {
    harness = await createParticles2DApp();
    const atlas = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(harness.app, tiny(), "memory:tiny.particles.json");
    const system = harness.app.world.createEntity("fx").addComponent(ParticleSystem2D, { definition, atlas });
    expect(() => system.emit(-1)).toThrow(/IGX-1753/u);
    expect(() => system.simulate(Number.NaN)).toThrow(/IGX-1753/u);
  });

  it("reports an atlas that never loaded with IGX-1754, once", async () => {
    harness = await createParticles2DApp();
    const definition = particleAssetFromDefinition(harness.app, tiny(), "memory:tiny.particles.json");
    harness.app.world.createEntity("fx").addComponent(ParticleSystem2D, { definition });
    harness.step();
    harness.step();
    expect(logged(Particles2DErrorCode.atlasNotLoaded)).toHaveLength(1);
  });

  it("reports a component on an app without the extension with IGX-1755", async () => {
    const sink = createMemorySink();
    const app = await createApp({
      headless: true,
      logSink: sink,
      logLevel: "debug",
      extensions: [twoD(), particles()],
    });
    const system = app.world.createEntity("fx").addComponent(ParticleSystem2D);
    app.step(1 / 60);
    const warnings = sink
      .toArray()
      .map((record) => record.message)
      .filter((message) => message.includes(Particles2DErrorCode.extensionMissing));
    app.dispose();
    expect(warnings).toHaveLength(1);
    expect(system.aliveCount).toBe(0);
  });

  it("falls back to the Default layer for an undeclared one with IGX-1756", async () => {
    harness = await createParticles2DApp();
    const atlas = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(harness.app, tiny(), "memory:tiny.particles.json");
    const system = harness.app.world
      .createEntity("fx")
      .addComponent(ParticleSystem2D, { definition, atlas, sortingLayer: "Nowhere" });
    harness.step();
    harness.step();
    expect(logged(Particles2DErrorCode.unknownSortingLayer)).toHaveLength(1);
    expect(system.batch).not.toBeNull();
  });
});
