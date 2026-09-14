import { Script } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { particleAssetFromDefinition } from "../../src/assets/loader.js";
import { defineParticles } from "../../src/definition/define-particles.js";
import { particleDefinition } from "../../src/definition/presets/index.js";
import { ParticlesErrorCode } from "../../src/errors.js";
import { createParticleState } from "../../src/evaluate/particle-math.js";
import { ParticleSystem } from "../../src/gpu/particle-system.js";
import { ParticlesService } from "../../src/service/particles-service.js";
import { createParticlesApp } from "../support/harness.js";
import type { ParticleAsset } from "../../src/assets/particle-asset.js";
import type { ParticleDefinitionInput } from "../../src/definition/types.js";
import type { ParticlesAppHarness, ParticlesAppOptions } from "../support/harness.js";
import type { AssetHandle, Entity } from "@ignifx/core";

/** A sixty-fourth of a second: exact in binary, so an emitted count can be asserted. */
const FRAME = 1 / 64;

let harness: ParticlesAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** A system, its entity, and the handle it plays. */
interface Scene {
  readonly app: ParticlesAppHarness;
  readonly entity: Entity;
  readonly system: ParticleSystem;
  readonly handle: AssetHandle<ParticleAsset>;
}

/**
 * Builds an app with one `ParticleSystem` on one entity.
 *
 * @param input - The definition to play.
 * @param options - Harness options, for the budget and quality tests.
 * @param fields - Overrides for the component's own fields.
 * @param fields.playOnAwake - Whether the component plays on its first enabled frame.
 * @param fields.seed - The component's emission seed.
 * @returns The scene.
 */
async function scene(
  input: ParticleDefinitionInput,
  options?: ParticlesAppOptions,
  fields?: { readonly playOnAwake?: boolean; readonly seed?: number },
): Promise<Scene> {
  const app = await createParticlesApp(options);
  harness = app;
  const handle = particleAssetFromDefinition(app.app, defineParticles(input), "test");
  const entity = app.world.createEntity("Effect");
  const system = entity.addComponent(ParticleSystem, { definition: handle, ...fields });
  return { app, entity, system, handle };
}

/**
 * Asserts that every live record evaluates near a world height.
 *
 * @param system - The system to read.
 * @param height - The world Y the emitter sits at.
 */
function expectEveryRecordNear(system: ParticleSystem, height: number): void {
  const state = createParticleState();
  let checked = 0;
  for (let slot = 0; slot < system.capacity; slot += 1) {
    if (system.evaluate(slot, state)) {
      expect(state.position[1] ?? 0, `slot ${String(slot)}`).toBeCloseTo(height, 1);
      checked += 1;
    }
  }
  expect(checked).toBe(system.aliveCount);
}

describe("a ParticleSystem on a headless app", () => {
  it("declares its type id, its schema fields, and that several may share an entity", () => {
    expect(ParticleSystem.typeId).toBe("ignifx/ParticleSystem");
    expect(ParticleSystem.allowMultiple).toBe(true);
    expect(Object.keys(ParticleSystem.schema).toSorted()).toEqual(["definition", "playOnAwake", "seed"]);
  });

  it("plays on its first enabled frame and emits from then on", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 10 } });
    expect(running.system.isPlaying).toBe(false);
    running.app.stepMany(64, FRAME);
    expect(running.system.isPlaying).toBe(true);
    expect(running.system.aliveCount).toBe(64);
    expect(running.system.time).toBeCloseTo(1, 5);
  });

  it("keeps a particle spawned this frame alive, at a frame length no float can represent exactly", async () => {
    // Regression: the record's spawn time is stored as `f32` and can round a fraction above a
    // `f64` clock, which made `reconcile` walk its tail past a live particle and never come back.
    const running = await scene({ emission: { rateOverTime: 60 }, start: { lifetime: 10 } });
    running.app.stepMany(5, 1 / 60);
    expect(running.system.aliveCount).toBe(4);
    expect(running.system.drawCount).toBe(4);
    running.app.stepMany(115, 1 / 60);
    expect(running.system.aliveCount).toBe(119);
  });

  it("does not play on its own when the component says not to", async () => {
    const running = await scene({ emission: { rateOverTime: 64 } }, undefined, { playOnAwake: false });
    running.app.stepMany(64, FRAME);
    expect(running.system.isPlaying).toBe(false);
    expect(running.system.aliveCount).toBe(0);
    running.system.play();
    running.app.stepMany(64, FRAME);
    expect(running.system.aliveCount).toBeGreaterThan(0);
  });

  it("does not play on its own when the definition says not to", async () => {
    const running = await scene({ main: { playOnAwake: false }, emission: { rateOverTime: 64 } });
    running.app.stepMany(64, FRAME);
    expect(running.system.isPlaying).toBe(false);
  });

  it("stops emitting but lets the live particles finish, then clears on demand", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 1 } });
    running.app.stepMany(64, FRAME);
    expect(running.system.aliveCount).toBeGreaterThan(0);
    running.system.stop();
    running.app.stepMany(96, FRAME);
    expect(running.system.aliveCount).toBe(0);

    running.system.play();
    running.app.stepMany(32, FRAME);
    expect(running.system.aliveCount).toBeGreaterThan(0);
    running.system.stop({ clear: true });
    expect(running.system.aliveCount).toBe(0);
    expect(running.system.drawCount).toBe(0);
    expect(running.system.time).toBe(0);
  });

  it("freezes the clock, the ages and the census while paused", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 2 } });
    running.app.stepMany(64, FRAME);
    const alive = running.system.aliveCount;
    const clock = running.system.time;
    running.system.pause();
    expect(running.system.isPaused).toBe(true);
    running.app.stepMany(64, FRAME);
    expect(running.system.time).toBe(clock);
    expect(running.system.aliveCount).toBe(alive);
    running.system.resume();
    running.app.stepMany(64, FRAME);
    expect(running.system.time).toBeGreaterThan(clock);
  });

  it("freezes exactly while the app is paused, because the system clock is its own", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 2 } });
    running.app.stepMany(64, FRAME);
    const clock = running.system.time;
    const alive = running.system.aliveCount;
    running.app.app.pause();
    running.app.stepMany(120, FRAME);
    expect(running.system.time).toBe(clock);
    expect(running.system.aliveCount).toBe(alive);
    running.app.app.resume();
    running.app.stepMany(64, FRAME);
    expect(running.system.time).toBeCloseTo(clock + 1, 5);
  });

  it("spawns exactly what emit asks for, whatever the rate", async () => {
    const running = await scene({ emission: { rateOverTime: 0 }, start: { lifetime: 10 } });
    running.app.step(FRAME);
    running.system.emit(25);
    running.app.step(FRAME);
    expect(running.system.aliveCount).toBe(25);
  });

  it("draws a particle a script emitted in the same frame, because emission runs late in Update", async () => {
    const running = await scene({ emission: { rateOverTime: 0 }, start: { lifetime: 10 } });
    const target = running.system;

    class Sparkler extends Script {
      static typeId = "test/Sparkler";
      update(): void {
        target.emit(1);
      }
    }

    running.app.app.registerComponents([Sparkler]);
    running.entity.addComponent(Sparkler);
    running.app.step(FRAME);
    expect(running.system.aliveCount).toBe(1);
    running.app.step(FRAME);
    expect(running.system.aliveCount).toBe(2);
  });

  it("fast-forwards with simulate to the same state as stepping", async () => {
    const stepped = await scene({ emission: { rateOverTime: 60 }, start: { lifetime: 10 } }, undefined, { seed: 9 });
    stepped.app.stepMany(120, 1 / 60);
    const jumped = await createParticlesApp();
    const handle = particleAssetFromDefinition(
      jumped.app,
      defineParticles({ emission: { rateOverTime: 60 }, start: { lifetime: 10 } }),
      "test",
    );
    const other = jumped.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle, seed: 9 });
    jumped.step(0);
    other.simulate(2);
    jumped.step(0);
    expect(other.aliveCount).toBe(stepped.system.aliveCount);
    expect(other.time).toBeCloseTo(stepped.system.time, 6);
    jumped.dispose();
  });

  it("fires onStopped once for a non-looping system", async () => {
    const running = await scene({
      main: { duration: 0.25, looping: false },
      emission: { rateOverTime: 32 },
      start: { lifetime: 0.25 },
    });
    let stopped = 0;
    running.system.onStopped.connect(() => {
      stopped += 1;
    });
    running.app.stepMany(16, FRAME);
    expect(stopped).toBe(0);
    running.app.stepMany(64, FRAME);
    expect(stopped).toBe(1);
    expect(running.system.isPlaying).toBe(false);
    running.app.stepMany(64, FRAME);
    expect(stopped).toBe(1);
  });

  it("scales its rate with the app's quality multiplier, frame by frame", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 10 } });
    running.app.app.particles.qualityScale = 0.5;
    running.app.stepMany(64, FRAME);
    expect(running.system.aliveCount).toBe(32);
  });

  it("clamps its capacity to the budget and counts the particles the budget cost it", async () => {
    const running = await scene(
      { main: { capacity: 10_000 }, emission: { rateOverTime: 64 }, start: { lifetime: 10 } },
      { particles: { maxParticles: 16 } },
    );
    running.app.stepMany(64, FRAME);
    expect(running.system.capacity).toBe(16);
    expect(running.system.aliveCount).toBe(16);
    expect(running.system.droppedCount).toBeGreaterThan(0);
    expect(running.app.messages().join("\n")).toContain(ParticlesErrorCode.budgetExceeded);
  });

  it("gives two systems with one seed identical particles", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, shape: { kind: "sphere", radius: 1 } }, undefined, {
      seed: 4242,
    });
    const twin = running.entity.addComponent(ParticleSystem, { definition: running.handle, seed: 4242 });
    running.app.stepMany(64, FRAME);
    expect(twin.records).not.toBeNull();
    expect([...(twin.records ?? [])]).toEqual([...(running.system.records ?? [])]);
  });

  it("evaluates a live record with the same arithmetic the shader runs", async () => {
    const running = await scene({
      emission: { rateOverTime: 64 },
      forces: { gravityMultiplier: 1 },
      start: { lifetime: 10, speed: 0 },
    });
    running.app.stepMany(64, FRAME);
    const state = createParticleState();
    expect(running.system.evaluate(0, state)).toBe(true);
    expect(state.position[1]).toBeLessThan(0);
    expect(state.age).toBeGreaterThan(0);
    expect(state.life).toBeGreaterThan(0);
  });

  it("reports a slot with no live particle as not evaluated", async () => {
    const running = await scene({ emission: { rateOverTime: 0 } });
    running.app.step(FRAME);
    expect(running.system.evaluate(0)).toBe(false);
  });

  it("prewarms a world-space effect at the entity, not at the origin", async () => {
    // Regression: `play()` fast-forwards a whole cycle for a prewarmed document, so the emitter
    // matrix has to reach the core before the auto-play branch runs, not after it.
    const running = await scene({
      main: { simulationSpace: "world", duration: 2, looping: true, prewarm: true, capacity: 256 },
      emission: { rateOverTime: 64 },
      shape: { kind: "box", size: { x: 4, y: 0.1, z: 4 } },
      start: { lifetime: 4, speed: 0, size: 0.1 },
    });
    running.entity.transform.localPosition.set(0, 12, 0);
    running.app.step(FRAME);
    expect(running.system.aliveCount).toBeGreaterThan(100);
    expectEveryRecordNear(running.system, 12);

    const swapped = particleAssetFromDefinition(
      running.app.app,
      defineParticles({
        main: { simulationSpace: "world", duration: 2, looping: true, prewarm: true, capacity: 256 },
        emission: { rateOverTime: 64 },
        shape: { kind: "box", size: { x: 4, y: 0.1, z: 4 } },
        start: { lifetime: 4, speed: 0, size: 0.2 },
      }),
      "swapped",
    );
    running.system.definition = swapped;
    running.app.step(FRAME);
    expect(running.system.aliveCount).toBeGreaterThan(100);
    expectEveryRecordNear(running.system, 12);
  });

  it("prewarms at the entity when a script plays it on the frame it was attached", async () => {
    const running = await scene(
      {
        main: { simulationSpace: "world", duration: 2, looping: true, prewarm: true, capacity: 256 },
        emission: { rateOverTime: 64 },
        shape: { kind: "point" },
        start: { lifetime: 4, speed: 0, size: 0.1 },
      },
      undefined,
      { playOnAwake: false },
    );
    running.entity.transform.localPosition.set(0, 12, 0);
    running.system.play();
    running.app.step(FRAME);
    expect(running.system.aliveCount).toBeGreaterThan(100);
    expectEveryRecordNear(running.system, 12);
  });

  it("moves a local-space effect with its entity and leaves a world-space one behind", async () => {
    const local = await scene({
      main: { simulationSpace: "local" },
      emission: { rateOverTime: 64 },
      start: { lifetime: 10, speed: 0 },
    });
    local.app.stepMany(16, FRAME);
    local.entity.transform.localPosition.set(100, 0, 0);
    local.app.step(FRAME);
    const state = createParticleState();
    local.system.evaluate(0, state);
    expect(state.position[0]).toBeGreaterThan(90);
  });

  it("counts nothing and stays silent when no definition is attached", async () => {
    const app = await createParticlesApp();
    harness = app;
    const system = app.world.createEntity("Empty").addComponent(ParticleSystem);
    app.stepMany(10, FRAME);
    expect(system.aliveCount).toBe(0);
    expect(system.capacity).toBe(0);
    expect(system.records).toBeNull();
    expect(system.time).toBe(0);
    expect(system.isPlaying).toBe(false);
    expect(system.isPaused).toBe(false);
    expect(app.errors).toEqual([]);
  });

  it("stops drawing and gives its budget back when the component is destroyed", async () => {
    const running = await scene({ main: { capacity: 100 }, emission: { rateOverTime: 64 } });
    running.app.stepMany(16, FRAME);
    const service = running.app.app.services.get(ParticlesService);
    expect(service.capacityInUse).toBe(100);
    expect(service.systems).toHaveLength(1);
    running.system.destroy();
    running.app.step(FRAME);
    expect(service.capacityInUse).toBe(0);
    expect(service.systems).toHaveLength(0);
  });

  it("warns once and stays inert when the extension is not registered", async () => {
    const app = await createParticlesApp({ withExtension: false });
    harness = app;
    app.world.createEntity("Effect").addComponent(ParticleSystem);
    app.stepMany(5, FRAME);
    const warnings = app.messages().filter((message) => message.includes("particles() extension is not registered"));
    expect(warnings).toHaveLength(1);
  });
});

describe("ParticleSystem misuse", () => {
  it("throws IGX-1705 when a playback method runs with no definition", async () => {
    const app = await createParticlesApp();
    harness = app;
    const system = app.world.createEntity("Empty").addComponent(ParticleSystem);
    for (const call of [
      (): void => {
        system.play();
      },
      (): void => {
        system.stop();
      },
      (): void => {
        system.pause();
      },
      (): void => {
        system.resume();
      },
      (): void => {
        system.emit(1);
      },
      (): void => {
        system.simulate(1);
      },
    ]) {
      expect(call).toThrowError(new RegExp(ParticlesErrorCode.noDefinition));
    }
  });

  it("throws IGX-1707 for a count or a duration it cannot use", async () => {
    const running = await scene({});
    running.app.step(FRAME);
    expect(() => {
      running.system.emit(-1);
    }).toThrowError(new RegExp(ParticlesErrorCode.invalidArgument));
    expect(() => {
      running.system.emit(Number.NaN);
    }).toThrowError(new RegExp(ParticlesErrorCode.invalidArgument));
    expect(() => {
      running.system.simulate(-1);
    }).toThrowError(new RegExp(ParticlesErrorCode.invalidArgument));
    expect(() => {
      running.system.simulate(Number.POSITIVE_INFINITY);
    }).toThrowError(new RegExp(ParticlesErrorCode.invalidArgument));
  });
});

describe("the GPU side of a ParticleSystem", () => {
  it("builds a renderer, a material and a storage buffer once the generated shader has loaded", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 10 } });
    await running.app.settle(() => running.system.renderer !== null);
    expect(running.system.storage?.state).toBe("loaded");
    expect(running.system.material?.state).toBe("loaded");
    expect(running.system.renderer).not.toBeNull();
    expect(running.system.renderer?.capacity).toBe(running.system.capacity);
    expect(running.app.errors).toEqual([]);
  });

  it("follows the live tail with the renderer's instance count", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 0.5 } });
    await running.app.settle(() => running.system.renderer !== null);
    running.app.stepMany(16, FRAME);
    expect(running.system.drawCount).toBeGreaterThan(0);
    expect(running.system.renderer?.count).toBe(running.system.drawCount);
    running.system.stop({ clear: true });
    running.app.step(FRAME);
    expect(running.system.renderer?.count).toBe(0);
  });

  it("uploads only the records written since the last frame", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 10 } });
    await running.app.settle(() => running.system.renderer !== null);
    running.app.step(FRAME);
    expect(running.system.uploadedBytes).toBe(48);
    running.app.step(0);
    expect(running.system.uploadedBytes).toBe(0);
  });

  it("uploads a wrapped ring in two runs", async () => {
    const running = await scene({ main: { capacity: 8 }, emission: { rateOverTime: 64 }, start: { lifetime: 10 } });
    await running.app.settle(() => running.system.renderer !== null);
    running.app.stepMany(6, FRAME);
    running.app.step(5 / 64);
    expect(running.system.uploadedBytes).toBeGreaterThanOrEqual(5 * 48);
  });

  it("shares one shader and one lookup texture between two systems playing one definition", async () => {
    const running = await scene({ emission: { rateOverTime: 64 } });
    const twin = running.app.world.createEntity("Twin").addComponent(ParticleSystem, { definition: running.handle });
    await running.app.settle(() => twin.renderer !== null && running.system.renderer !== null);
    expect(twin.material).not.toBe(running.system.material);
    expect(twin.storage).not.toBe(running.system.storage);
    expect(running.app.errors).toEqual([]);
  });

  it("publishes the particles counters every frame", async () => {
    const running = await scene({ emission: { rateOverTime: 64 }, start: { lifetime: 10 } });
    await running.app.settle(() => running.system.renderer !== null);
    running.app.stepMany(4, FRAME);
    const counters = running.app.app.particles.counters;
    expect(counters).not.toBeNull();
    expect(counters?.get(counters.index("systems"))).toBe(1);
    expect(counters?.get(counters.index("alive"))).toBe(running.system.aliveCount);
    expect(counters?.get(counters.index("uploadBytes"))).toBe(running.system.uploadedBytes);
  });
});

describe("a ParticleSystem playing a preset", () => {
  it("builds the GPU side of every shipped preset without an error report", async () => {
    const app = await createParticlesApp({ particles: { maxParticles: 100_000 } });
    harness = app;
    const systems = ["fire", "smoke", "sparks", "explosion", "dust", "sparkle", "rain", "snow", "leaves"] as const;
    for (const name of systems) {
      const handle = particleAssetFromDefinition(app.app, particleDefinition(name), name);
      app.world.createEntity(name).addComponent(ParticleSystem, { definition: handle });
    }
    await app.settle(() => app.app.particles.systems.every((system) => system.renderer !== null));
    for (const system of app.app.particles.systems) {
      expect(system.renderer, system.entity.name).not.toBeNull();
    }
    expect(app.errors).toEqual([]);
  });
});
