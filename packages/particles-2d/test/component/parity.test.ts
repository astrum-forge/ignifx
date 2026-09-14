import { createParticleState, defineParticles, ParticleSystem, particleAssetFromDefinition } from "@ignifx/particles";
import { afterEach, describe, expect, it } from "vitest";
import { ParticleSystem2D } from "../../src/index.js";
import { createParticles2DApp, recordBatches } from "../support/app.js";
import type { SpriteAtlasAsset } from "@ignifx/2d";
import type { ParticleDefinitionInput } from "@ignifx/particles";

/**
 * The claim `docs/plan/2026-09-terrain-particles-shaders.md` §4.3 makes about the two components:
 * "behaves identically to the 3D system for the same definition".
 *
 * Both systems sit on one entity, so they share a transform and an emitter matrix, and both are
 * driven by the same stepped clock. The test then asserts that every sprite the 2D system wrote is
 * at the position the 3D system's own evaluator — the one its shader is generated from — puts the
 * same record at.
 */

/** A rich effect: drag, gravity, an orbit, a size curve, a colour gradient, and a sheet. */
function workout(): ParticleDefinitionInput {
  return {
    main: { capacity: 64, duration: 1, looping: false, simulationSpace: "local", seed: 11 },
    // One burst, so every record is born at a clock both systems have long passed and neither
    // evaluator has to decide about a particle born this very frame.
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: 24 }] },
    shape: { kind: "sphere", radius: 0.5 },
    start: { lifetime: 4, speed: { min: 0.5, max: 2 }, size: { min: 0.2, max: 0.6 }, rotation: 30 },
    forces: {
      gravity: { x: 0, y: -3, z: 0 },
      drag: 0.4,
      orbit: { axis: { x: 0, y: 0, z: 1 }, speed: 20 },
    },
    overLifetime: {
      size: {
        curve: {
          keys: [
            [0, 0.5, 0, 0],
            [1, 1.5, 0, 0],
          ],
        },
      },
      color: {
        gradient: [
          [0, 1, 0.8, 0, 1],
          [1, 1, 0, 0, 0],
        ],
      },
      rotation: 45,
    },
    renderer: { blend: "alpha", sheet: { tiles: { x: 2, y: 2 }, frameOverTime: "random" } },
  };
}

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

describe("a 2D particle system and a 3D one", () => {
  it("puts the same definition's particles in the same places", async () => {
    const harness = await createParticles2DApp();
    dispose = harness.dispose;
    const recorder = recordBatches(harness.app);
    const atlas = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(
      harness.app,
      defineParticles(workout()),
      "memory:workout.particles.json",
    );
    const entity = harness.app.world.createEntity("fx");
    entity.transform.position = { x: 2, y: 3, z: 0 };
    entity.transform.rotation2D = 25;
    const flat = entity.addComponent(ParticleSystem2D, { definition, atlas, seed: 11, playOnAwake: false });
    const solid = entity.addComponent(ParticleSystem, { definition, seed: 11, playOnAwake: false });
    // Both are started by hand after a settling frame, so the two clocks are the same however long
    // each component takes to build the resources its own renderer needs.
    harness.step();
    flat.play();
    solid.play();

    for (let frame = 0; frame < 24; frame += 1) {
      harness.step();
    }

    expect(flat.time).toBe(solid.time);
    expect(flat.capacity).toBe(solid.capacity);
    const sprites = recorder.sprites();
    expect(sprites).toHaveLength(24);

    const state = createParticleState();
    for (let slot = 0; slot < sprites.length; slot += 1) {
      const sprite = sprites[slot];
      expect(solid.evaluate(slot, state)).toBe(true);
      expect(sprite?.x).toBeCloseTo(state.position[0] ?? 0, 5);
      expect(sprite?.y).toBeCloseTo(state.position[1] ?? 0, 5);
      expect(sprite?.width).toBeCloseTo(state.size[0] ?? 0, 5);
      expect(sprite?.height).toBeCloseTo(state.size[1] ?? 0, 5);
      expect(sprite?.frame).toBe(state.frame);
      expect(sprite?.r).toBeCloseTo(state.color[0] ?? 0, 5);
      expect(sprite?.a).toBeCloseTo(state.color[3] ?? 0, 5);
      expect(sprite?.rotation).toBeCloseTo(state.rotation * (180 / Math.PI), 4);
    }
  });

  it("emits the same records from the same seed", async () => {
    const harness = await createParticles2DApp();
    dispose = harness.dispose;
    const atlas = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const definition = particleAssetFromDefinition(
      harness.app,
      defineParticles(workout()),
      "memory:workout.particles.json",
    );
    const entity = harness.app.world.createEntity("fx");
    const flat = entity.addComponent(ParticleSystem2D, { definition, atlas, seed: 11, playOnAwake: false });
    const solid = entity.addComponent(ParticleSystem, { definition, seed: 11, playOnAwake: false });
    harness.step();
    flat.play();
    solid.play();
    for (let frame = 0; frame < 6; frame += 1) {
      harness.step();
    }

    const theirs = solid.records;
    const ours = flat.core?.ring.floats ?? null;
    expect(ours).not.toBeNull();
    expect(theirs).not.toBeNull();
    expect(Array.from(ours ?? [])).toEqual(Array.from(theirs ?? []));
  });
});
