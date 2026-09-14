import { createParticleState, defineParticles, particleAssetFromDefinition } from "@ignifx/particles";
import { afterEach, describe, expect, it } from "vitest";
import { ParticleSystem2D, Particles2DService } from "../../src/index.js";
import { createParticles2DApp, recordBatches, requireService } from "../support/app.js";
import type { BatchRecorder, Particles2DAppHarness } from "../support/app.js";
import type { SpriteAtlasAsset } from "@ignifx/2d";
import type { Entity } from "@ignifx/core";
import type { ParticleDefinitionInput } from "@ignifx/particles";

/**
 * `ParticleSystem2D`'s lifecycle: the same play/stop/pause/emit contract as the 3D component
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3).
 */

/** A steady emitter with no forces, so a particle sits where it was born. */
function steady(overrides?: ParticleDefinitionInput): ParticleDefinitionInput {
  return {
    main: { capacity: 64, duration: 1, looping: true, simulationSpace: "world", seed: 7 },
    emission: { rateOverTime: 60 },
    shape: { kind: "point" },
    start: { lifetime: 1, speed: 0, size: 0.5 },
    renderer: { blend: "alpha" },
    ...overrides,
  };
}

let harness: Particles2DAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** An app with one `ParticleSystem2D` on a loaded atlas, plus a recorder watching its batch. */
async function createSystem(
  input: ParticleDefinitionInput = steady(),
  fields?: { readonly playOnAwake?: boolean; readonly sortingLayer?: string },
): Promise<{
  readonly system: ParticleSystem2D;
  readonly entity: Entity;
  readonly recorder: BatchRecorder;
  readonly harness: Particles2DAppHarness;
}> {
  const created = await createParticles2DApp();
  harness = created;
  const recorder = recordBatches(created.app);
  const atlas = await created.load<SpriteAtlasAsset>("2d/hero.atlas.json");
  const definition = particleAssetFromDefinition(created.app, defineParticles(input), "memory:test.particles.json");
  const entity = created.app.world.createEntity("fx");
  const system = entity.addComponent(ParticleSystem2D, { definition, atlas, ...fields });
  return { system, entity, recorder, harness: created };
}

describe("a 2D particle system", () => {
  it("plays on awake and fills its batch with the particles it emitted", async () => {
    const scene = await createSystem();
    // Two frames at 60 particles a second and 60 frames a second: one particle each.
    scene.harness.step();
    scene.harness.step();

    expect(scene.system.isPlaying).toBe(true);
    expect(scene.system.aliveCount).toBe(2);
    expect(scene.system.spriteCount).toBe(2);
    expect(scene.recorder.first()?.count).toBe(2);
    expect(scene.recorder.sprites()[0]?.width).toBeCloseTo(0.5, 6);
  });

  it("stays silent until play() when playOnAwake is off", async () => {
    const scene = await createSystem(steady(), { playOnAwake: false });
    scene.harness.step();
    expect(scene.system.isPlaying).toBe(false);
    expect(scene.system.aliveCount).toBe(0);

    scene.system.play();
    scene.harness.step(0.5);
    expect(scene.system.isPlaying).toBe(true);
    expect(scene.system.aliveCount).toBeGreaterThan(0);
  });

  it("freezes every particle while paused and moves again on resume", async () => {
    const scene = await createSystem({
      ...steady(),
      start: { lifetime: 5, speed: 1, size: 0.5 },
      shape: { kind: "point" },
      emission: { rateOverTime: 0, bursts: [{ time: 0, count: 4 }] },
    });
    scene.harness.step();
    scene.harness.step();
    const moving = scene.recorder.sprites()[0]?.y ?? 0;
    expect(moving).toBeGreaterThan(0);

    scene.system.pause();
    scene.harness.step();
    scene.harness.step();
    expect(scene.system.isPaused).toBe(true);
    expect(scene.recorder.sprites()[0]?.y).toBe(moving);

    scene.system.resume();
    scene.harness.step();
    expect(scene.recorder.sprites()[0]?.y).toBeGreaterThan(moving);
  });

  it("emits on demand in the same frame the call was made", async () => {
    const scene = await createSystem({ ...steady(), emission: { rateOverTime: 0 } });
    scene.harness.step();
    expect(scene.system.aliveCount).toBe(0);

    scene.system.emit(5);
    scene.harness.step();
    expect(scene.system.aliveCount).toBe(5);
    expect(scene.recorder.first()?.count).toBe(5);
  });

  it("fast-forwards with simulate", async () => {
    const scene = await createSystem();
    scene.system.play();
    scene.system.simulate(0.5);
    scene.harness.step();
    expect(scene.system.time).toBeGreaterThanOrEqual(0.5);
    expect(scene.system.aliveCount).toBeGreaterThan(20);
  });

  it("keeps its particles after stop() and drops them with clear", async () => {
    const scene = await createSystem();
    scene.harness.step(0.5);
    expect(scene.system.aliveCount).toBeGreaterThan(0);

    scene.system.stop();
    scene.harness.step();
    expect(scene.system.isPlaying).toBe(false);
    expect(scene.system.aliveCount).toBeGreaterThan(0);

    scene.system.stop({ clear: true });
    scene.harness.step();
    expect(scene.system.aliveCount).toBe(0);
    expect(scene.recorder.first()?.count).toBe(0);
  });

  it("emits onStopped once a non-looping system runs dry", async () => {
    const scene = await createSystem({
      ...steady(),
      main: { capacity: 64, duration: 0.1, looping: false, simulationSpace: "world", seed: 7 },
      start: { lifetime: 0.1, speed: 0, size: 0.5 },
    });
    let stopped = 0;
    scene.system.onStopped.connect(() => {
      stopped += 1;
    });
    for (let frame = 0; frame < 30; frame += 1) {
      scene.harness.step();
    }
    expect(stopped).toBe(1);
    expect(scene.system.isPlaying).toBe(false);
  });

  it("gives its sprite slots back when the component is destroyed", async () => {
    const scene = await createSystem();
    scene.harness.step();
    const batch = scene.system.batch;
    expect(batch).not.toBeNull();

    scene.entity.destroy();
    scene.harness.step();
    expect(scene.system.batch).toBeNull();
    expect(scene.recorder.first()?.isDisposed).toBe(true);
    expect(() => batch?.write(0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1)).toThrow(/IGX-1116/u);
  });

  it("draws nothing while disabled and resumes when enabled again", async () => {
    const scene = await createSystem();
    scene.harness.step(0.2);
    expect(scene.recorder.first()?.count).toBeGreaterThan(0);

    scene.system.enabled = false;
    scene.harness.step();
    expect(scene.recorder.first()?.count).toBe(0);

    scene.system.enabled = true;
    scene.harness.step();
    expect(scene.recorder.first()?.count).toBeGreaterThan(0);
  });
});

describe("a 2D particle system whose assets change", () => {
  it("evaluates a record the same way it wrote it", async () => {
    const scene = await createSystem({ ...steady(), emission: { rateOverTime: 0, bursts: [{ time: 0, count: 2 }] } });
    scene.harness.step();
    scene.harness.step();
    const state = createParticleState();
    expect(scene.system.evaluate(0, state)).toBe(true);
    expect(scene.recorder.sprites()[0]?.x).toBeCloseTo(state.position[0] ?? 0, 6);
    expect(scene.recorder.sprites()[0]?.y).toBeCloseTo(state.position[1] ?? 0, 6);
  });

  it("answers evaluate with false before a definition is applied", async () => {
    const created = await createParticles2DApp();
    harness = created;
    const system = created.app.world.createEntity("fx").addComponent(ParticleSystem2D);
    expect(system.evaluate(0)).toBe(false);
    expect(system.capacity).toBe(0);
    expect(system.time).toBe(0);
  });

  it("starts over on a new definition", async () => {
    const scene = await createSystem();
    scene.harness.step(0.5);
    expect(scene.system.aliveCount).toBeGreaterThan(0);

    scene.system.definition = particleAssetFromDefinition(
      scene.harness.app,
      defineParticles({ ...steady(), main: { capacity: 8, duration: 1, looping: true, seed: 9 } }),
      "memory:other.particles.json",
    );
    scene.harness.step();
    expect(scene.system.capacity).toBe(8);
    expect(scene.system.time).toBeLessThan(0.1);
    expect(scene.recorder.batches).toHaveLength(2);
    expect(scene.recorder.batches[0]?.isDisposed).toBe(true);
  });

  it("ignores a second attach of the same system", async () => {
    const scene = await createSystem();
    const service = requireService(scene.harness.app, Particles2DService);
    service.attach(scene.system);
    expect(service.systems).toHaveLength(1);
    service.detach(scene.system);
    service.detach(scene.system);
    expect(service.systems).toHaveLength(0);
  });
});
