import { defineParticles, particleAssetFromDefinition } from "@ignifx/particles";
import { afterEach, describe, expect, it } from "vitest";
import { ParticleSystem2D } from "../../src/index.js";
import { createParticles2DApp, recordBatches } from "../support/app.js";
import type { BatchRecorder, Particles2DAppHarness } from "../support/app.js";
import type { SpriteAtlasAsset } from "@ignifx/2d";
import type { ParticleDefinitionInput } from "@ignifx/particles";

/**
 * What a `ParticleSystem2D` writes into its batch: the frame-mapping rule, the blend, the sorting
 * layer, the world-space arithmetic, and how `count` follows the alive particles.
 */

/** Four particles born together, at rest, so every assertion is about one frame's write. */
function burst(overrides?: ParticleDefinitionInput): ParticleDefinitionInput {
  return {
    main: { capacity: 16, duration: 1, looping: false, simulationSpace: "local", seed: 5 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: 4 }] },
    shape: { kind: "point" },
    start: { lifetime: 2, speed: 0, size: 0.5 },
    renderer: { blend: "alpha" },
    ...overrides,
  };
}

let harness: Particles2DAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** An app with one system, stepped twice so its first particles are drawn. */
async function draw(
  input: ParticleDefinitionInput,
  fields?: { readonly sortingLayer?: string },
  place?: { readonly x: number; readonly y: number },
): Promise<{ readonly system: ParticleSystem2D; readonly recorder: BatchRecorder }> {
  const created = await createParticles2DApp({
    settings: { sortingLayers: { sortingLayers: ["Background", "Default", "Foreground"] } },
  });
  harness = created;
  const recorder = recordBatches(created.app);
  const atlas = await created.load<SpriteAtlasAsset>("2d/hero.atlas.json");
  const definition = particleAssetFromDefinition(created.app, defineParticles(input), "memory:fx.particles.json");
  const entity = created.app.world.createEntity("fx");
  if (place !== undefined) {
    entity.transform.position = { x: place.x, y: place.y, z: 0 };
  }
  const system = entity.addComponent(ParticleSystem2D, { definition, atlas, ...fields });
  created.step();
  created.step();
  return { system, recorder };
}

describe("the sprites a 2D particle system writes", () => {
  it("draws atlas frame 0 when the definition declares no sheet", async () => {
    const scene = await draw(burst());
    expect(scene.recorder.sprites()).toHaveLength(4);
    for (const sprite of scene.recorder.sprites()) {
      expect(sprite.frame).toBe(0);
    }
  });

  it("maps a sheet tile index straight onto the atlas frame index", async () => {
    const scene = await draw(
      burst({
        renderer: { blend: "alpha", sheet: { tiles: { x: 2, y: 2 }, frameOverTime: "random" } },
      }),
    );
    const frames = scene.recorder.sprites().map((sprite) => sprite.frame);
    expect(frames).toHaveLength(4);
    for (const frame of frames) {
      expect(Number.isInteger(frame)).toBe(true);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(4);
    }
    // A random sheet over four tiles and four particles does not land on one frame every time.
    expect(new Set(frames).size).toBeGreaterThan(1);
  });

  it("claims its layer from the definition's blend and the component's sorting layer", async () => {
    const scene = await draw(burst({ renderer: { blend: "additive" } }), { sortingLayer: "Foreground" });
    expect(scene.recorder.first()?.options.blend).toBe("additive");
    expect(scene.recorder.first()?.options.sortingLayer).toBe("Foreground");
    expect(scene.recorder.first()?.options.capacity).toBe(16);
  });

  it("writes world positions around the entity, ignoring Z", async () => {
    const scene = await draw(
      burst({ shape: { kind: "box", size: { x: 0, y: 0, z: 4 } }, start: { lifetime: 2, speed: 0, size: 0.5 } }),
      undefined,
      { x: 3, y: -2 },
    );
    for (const sprite of scene.recorder.sprites()) {
      // The box spreads along Z only, which 2D never draws, so every sprite sits on the entity.
      expect(sprite.x).toBeCloseTo(3, 6);
      expect(sprite.y).toBeCloseTo(-2, 6);
    }
  });

  it("lets count follow the alive particles and hides the slots that fall out", async () => {
    const scene = await draw(
      burst({
        emission: {
          rateOverTime: 0,
          bursts: [
            { time: 0, count: 4 },
            { time: 0.2, count: 2 },
          ],
        },
        start: { lifetime: 0.1, speed: 0, size: 0.5 },
      }),
    );
    expect(scene.recorder.first()?.count).toBe(4);

    // Ten frames in: the first burst's 0.1 s lifetime is over and the 0.2 s burst is not due.
    for (let frame = 0; frame < 8; frame += 1) {
      harness?.step();
    }
    expect(scene.system.aliveCount).toBe(0);
    expect(scene.recorder.first()?.count).toBe(0);

    for (let frame = 0; frame < 4; frame += 1) {
      harness?.step();
    }
    expect(scene.system.aliveCount).toBe(2);
    expect(scene.recorder.first()?.count).toBe(2);
  });

  it("keeps one batch while the definition and the atlas hold still", async () => {
    const scene = await draw(burst());
    for (let frame = 0; frame < 10; frame += 1) {
      harness?.step();
    }
    expect(scene.recorder.batches).toHaveLength(1);
  });

  it("re-claims its slots when the sorting layer changes", async () => {
    const scene = await draw(burst());
    scene.system.sortingLayer = "Background";
    harness?.step();
    expect(scene.recorder.batches).toHaveLength(2);
    expect(scene.recorder.batches[0]?.isDisposed).toBe(true);
    expect(scene.recorder.batches[1]?.options.sortingLayer).toBe("Background");
  });

  it("writes the linear colour a SpriteRenderer would take", async () => {
    const scene = await draw(
      burst({
        start: { lifetime: 2, speed: 0, size: 0.5, color: [1, 1, 1, 1] },
      }),
    );
    const sprite = scene.recorder.sprites()[0];
    expect(sprite?.r).toBeCloseTo(1, 6);
    expect(sprite?.g).toBeCloseTo(1, 6);
    expect(sprite?.b).toBeCloseTo(1, 6);
    expect(sprite?.a).toBeCloseTo(1, 6);
  });
});
