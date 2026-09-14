import { afterEach, describe, expect, it } from "vitest";
import { createParticleLoader, particleAssetFromDefinition } from "../../src/assets/loader.js";
import { ParticleAsset } from "../../src/assets/particle-asset.js";
import { defineParticles } from "../../src/definition/define-particles.js";
import { PARTICLE_ASSET_TYPE, PARTICLE_FILE_EXTENSIONS } from "../../src/definition/types.js";
import { ParticlesErrorCode } from "../../src/errors.js";
import { ParticleSystem } from "../../src/gpu/particle-system.js";
import { createParticlesApp, jsonFetch } from "../support/harness.js";
import type { ParticlesAppHarness } from "../support/harness.js";
import type { AssetHandle, TextureAsset } from "@ignifx/core";

/** A minimal document the suites load from a fake server. */
const SPARKS = {
  format: "ignifx.particles",
  formatVersion: 1,
  main: { capacity: 64, duration: 1, looping: false },
  emission: { rateOverTime: 0, bursts: [{ time: 0, count: 8 }] },
  start: { lifetime: 0.5, speed: 3, size: 0.1 },
  renderer: { mode: "billboard", blend: "additive" },
};

/**
 * Every message in a rejection's cause chain, joined. The asset service wraps a loader failure in
 * `IGX-0505` after its retries, so the document's own reason is one level down.
 *
 * @param error - What the load rejected with.
 * @returns The joined messages.
 */
function causeChain(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" <- ");
}

let harness: ParticlesAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the particles asset loader", () => {
  it("claims the particles type and the .particles.json suffix", () => {
    const loader = createParticleLoader();
    expect(loader.type).toBe(PARTICLE_ASSET_TYPE);
    expect([...loader.extensions]).toEqual([".particles.json"]);
    expect([...PARTICLE_FILE_EXTENSIONS]).toEqual([".particles.json"]);
    expect(ParticleAsset.assetType).toBe(PARTICLE_ASSET_TYPE);
  });

  it("loads a .particles.json through app.assets", async () => {
    const app = await createParticlesApp({ start: false, fetch: jsonFetch({ "fx/sparks.particles.json": SPARKS }) });
    harness = app;
    using handle = app.app.assets.load<ParticleAsset>("fx/sparks.particles.json");
    await handle.promise;
    expect(handle.state).toBe("loaded");
    expect(handle.value.address).toBe("fx/sparks.particles.json");
    expect(handle.value.definition.main.capacity).toBe(64);
    expect(handle.value.definition.emission.bursts).toHaveLength(1);
    expect(handle.value.texture).toBeNull();
  });

  it("fails the load with IGX-1701 when the document is not readable", async () => {
    const app = await createParticlesApp({
      start: false,
      fetch: jsonFetch({ "fx/broken.particles.json": { main: { capacity: -1 } } }),
    });
    harness = app;
    using handle = app.app.assets.load<ParticleAsset>("fx/broken.particles.json");
    const failure: unknown = await handle.promise.then(
      () => null,
      (error: unknown) => error,
    );
    expect(handle.state).toBe("failed");
    expect(causeChain(failure)).toContain(ParticlesErrorCode.invalidParticlesFile);
  });

  it("loads the renderer's texture as a dependency of the document", async () => {
    const app = await createParticlesApp({
      start: false,
      fetch: jsonFetch({
        "fx/smoke.particles.json": { ...SPARKS, renderer: { texture: "fx/smoke.png" } },
        "fx/smoke.png": {},
      }),
    });
    harness = app;
    using handle = app.app.assets.load<ParticleAsset>("fx/smoke.particles.json");
    await handle.promise.catch(() => undefined);
    expect(handle.value.definition.renderer.texture).toBe("fx/smoke.png");
  });

  it("plays a loaded document through a ParticleSystem", async () => {
    const app = await createParticlesApp({ fetch: jsonFetch({ "fx/sparks.particles.json": SPARKS }) });
    harness = app;
    const handle = app.app.assets.load<ParticleAsset>("fx/sparks.particles.json");
    const system = app.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle });
    await app.settle(() => system.capacity > 0);
    expect(system.capacity).toBe(64);
    app.step(1 / 64);
    expect(system.aliveCount).toBe(8);
  });
});

describe("particleAssetFromDefinition", () => {
  it("publishes a definition built in code, already loaded", async () => {
    const app = await createParticlesApp();
    harness = app;
    using handle = particleAssetFromDefinition(app.app, defineParticles({ main: { capacity: 12 } }), "inline");
    expect(handle.state).toBe("loaded");
    expect(handle.value.address).toBe("inline");
    expect(handle.value.definition.main.capacity).toBe(12);
  });

  it("names the asset particles when the caller gives no name", async () => {
    const app = await createParticlesApp();
    harness = app;
    using handle = particleAssetFromDefinition(app.app, defineParticles({}));
    expect(handle.value.address).toBe("particles");
  });

  it("starts the renderer's texture loading and releases it with the asset", async () => {
    const app = await createParticlesApp({ start: false, fetch: jsonFetch({}) });
    harness = app;
    const handle = particleAssetFromDefinition(
      app.app,
      defineParticles({ renderer: { texture: "fx/smoke.png" } }),
      "inline",
    );
    const texture: unknown = handle.value.texture;
    expect(texture).not.toBeNull();
    handle.release();
  });
});

describe("a particle asset", () => {
  it("releases only the texture it owns", () => {
    let released = 0;
    const fake = {
      release: (): void => {
        released += 1;
      },
      // The asset only ever calls `release`; the rest of the handle is not exercised here.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-method stand-in.
    } as unknown as AssetHandle<TextureAsset>;
    new ParticleAsset("a", defineParticles({}), fake, false).dispose();
    expect(released).toBe(0);
    new ParticleAsset("b", defineParticles({}), fake, true).dispose();
    expect(released).toBe(1);
  });
});
