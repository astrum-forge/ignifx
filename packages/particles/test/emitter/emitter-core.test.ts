import { describe, expect, it } from "vitest";
import { defineParticles } from "../../src/definition/define-particles.js";
import { ParticleEmitterCore } from "../../src/emitter/emitter-core.js";
import { RECORD_FLOATS, RECORD_LIFETIME, RECORD_SEED, RECORD_SPAWN_TIME } from "../../src/emitter/record-ring.js";
import type { ParticleDefinition, ParticleDefinitionInput } from "../../src/definition/types.js";

/**
 * The frame length every scheduling test steps with. A sixty-fourth is exact in binary, so sixty-four
 * steps really do add up to one second and a count like `floor(rate x elapsed)` can be asserted.
 */
const FRAME = 1 / 64;

/**
 * Builds a core from an authored document.
 *
 * @param input - The document.
 * @param seed - The emission seed; `1` unless a test needs another.
 * @param capacity - The ring capacity; the definition's unless a test needs another.
 * @returns The core.
 */
function core(input: ParticleDefinitionInput, seed = 1, capacity?: number): ParticleEmitterCore {
  const definition: ParticleDefinition = defineParticles(input);
  return new ParticleEmitterCore({ definition, capacity: capacity ?? definition.main.capacity, seed });
}

/**
 * Plays a core and advances it for a number of frames.
 *
 * @param emitter - The core.
 * @param frames - How many frames.
 * @param dt - The frame length.
 */
function run(emitter: ParticleEmitterCore, frames: number, dt = FRAME): void {
  for (let index = 0; index < frames; index += 1) {
    emitter.advance(dt);
    emitter.reconcile();
  }
}

/**
 * A cheap hash of the first records, for the determinism test.
 *
 * @param emitter - The core whose ring is hashed.
 * @param count - How many records to read.
 * @returns The hash, as an unsigned 32-bit integer.
 */
function hashRecords(emitter: ParticleEmitterCore, count: number): number {
  const floats = emitter.ring.floats;
  const bytes = new Uint8Array(floats.buffer, 0, count * RECORD_FLOATS * 4);
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ (bytes[index] ?? 0), 0x01_00_01_93) >>> 0;
  }
  return hash;
}

describe("rate over time", () => {
  it("emits floor(rate x elapsed) particles over any run of frames", () => {
    const emitter = core({ emission: { rateOverTime: 100 }, start: { lifetime: 100 } });
    emitter.play();
    run(emitter, 64);
    expect(emitter.emittedTotal).toBe(100);
    run(emitter, 32);
    expect(emitter.emittedTotal).toBe(150);
  });

  it("emits the same total whatever the frame rate, which is what carrying the fraction buys", () => {
    const fast = core({ emission: { rateOverTime: 37 }, start: { lifetime: 100 } });
    const slow = core({ emission: { rateOverTime: 37 }, start: { lifetime: 100 } });
    fast.play();
    slow.play();
    run(fast, 128, 1 / 64);
    run(slow, 32, 1 / 16);
    expect(fast.emittedTotal).toBe(74);
    expect(slow.emittedTotal).toBe(74);
  });

  it("spaces the spawn times evenly inside the frame", () => {
    const emitter = core({ emission: { rateOverTime: 256 }, start: { lifetime: 100 } });
    emitter.play();
    emitter.advance(FRAME);
    expect(emitter.emittedTotal).toBe(4);
    const floats = emitter.ring.floats;
    const times = [0, 1, 2, 3].map((slot) => floats[slot * RECORD_FLOATS + RECORD_SPAWN_TIME] ?? 0);
    expect(times[0]).toBeCloseTo(1 / 256, 6);
    expect(times[3]).toBeCloseTo(4 / 256, 6);
    expect(times[1] ?? 0).toBeGreaterThan(times[0] ?? 0);
  });

  it("emits nothing at rate zero", () => {
    const emitter = core({ emission: { rateOverTime: 0 } });
    emitter.play();
    run(emitter, 120);
    expect(emitter.emittedTotal).toBe(0);
  });

  it("waits out the start delay", () => {
    const emitter = core({ main: { startDelay: 0.5 }, emission: { rateOverTime: 100 }, start: { lifetime: 100 } });
    emitter.play();
    run(emitter, 32);
    expect(emitter.emittedTotal).toBe(0);
    run(emitter, 32);
    expect(emitter.emittedTotal).toBe(50);
  });

  it("scales with the quality multiplier", () => {
    const emitter = core({ emission: { rateOverTime: 100 }, start: { lifetime: 100 } });
    emitter.qualityScale = 0.25;
    emitter.play();
    run(emitter, 64);
    expect(emitter.emittedTotal).toBe(25);
  });
});

describe("bursts", () => {
  it("fires once at its declared time", () => {
    const emitter = core({
      emission: { rateOverTime: 0, bursts: [{ time: 0.25, count: 12, cycles: 1 }] },
      start: { lifetime: 100 },
    });
    emitter.play();
    run(emitter, 15);
    expect(emitter.emittedTotal).toBe(0);
    run(emitter, 1);
    expect(emitter.emittedTotal).toBe(12);
    run(emitter, 128);
    expect(emitter.emittedTotal).toBe(12);
  });

  it("repeats for the declared number of cycles at the declared interval", () => {
    const emitter = core({
      main: { duration: 10 },
      emission: { rateOverTime: 0, bursts: [{ time: 0, count: 3, cycles: 4, interval: 0.5 }] },
      start: { lifetime: 100 },
    });
    emitter.play();
    run(emitter, 320);
    expect(emitter.emittedTotal).toBe(12);
  });

  it("repeats until the cycle ends when cycles is zero", () => {
    const emitter = core({
      main: { duration: 1, looping: false },
      emission: { rateOverTime: 0, bursts: [{ time: 0, count: 2, cycles: 0, interval: 0.25 }] },
      start: { lifetime: 100 },
    });
    emitter.play();
    run(emitter, 128);
    expect(emitter.emittedTotal).toBe(10);
  });

  it("fires once for a zero interval and unlimited cycles, instead of looping for ever", () => {
    const emitter = core({
      main: { duration: 1, looping: false },
      emission: { rateOverTime: 0, bursts: [{ time: 0, count: 5, cycles: 0, interval: 0 }] },
      start: { lifetime: 100 },
    });
    emitter.play();
    run(emitter, 128);
    expect(emitter.emittedTotal).toBe(5);
  });

  it("rolls a random count per firing", () => {
    const emitter = core({
      main: { duration: 1 },
      emission: { rateOverTime: 0, bursts: [{ time: 0, count: { min: 1, max: 20 }, cycles: 1 }] },
      start: { lifetime: 100 },
    });
    emitter.play();
    run(emitter, 640);
    expect(emitter.emittedTotal).toBeGreaterThan(10);
    expect(emitter.emittedTotal).toBeLessThan(10 * 20);
  });

  it("skips a firing that loses its probability roll", () => {
    const certain = core({
      main: { duration: 1 },
      emission: { rateOverTime: 0, bursts: [{ time: 0, count: 1, cycles: 1, probability: 1 }] },
      start: { lifetime: 100 },
    });
    const chancy = core({
      main: { duration: 1 },
      emission: { rateOverTime: 0, bursts: [{ time: 0, count: 1, cycles: 1, probability: 0.25 }] },
      start: { lifetime: 100 },
    });
    certain.play();
    chancy.play();
    run(certain, 3840);
    run(chancy, 3840);
    expect(certain.emittedTotal).toBe(60);
    expect(chancy.emittedTotal).toBeLessThan(certain.emittedTotal);
    expect(chancy.emittedTotal).toBeGreaterThan(0);
  });

  it("restarts its firings every cycle of a looping system", () => {
    const emitter = core({
      main: { duration: 1 },
      emission: { rateOverTime: 0, bursts: [{ time: 0, count: 4, cycles: 1 }] },
      start: { lifetime: 100 },
    });
    emitter.play();
    run(emitter, 170);
    expect(emitter.emittedTotal).toBe(12);
  });
});

describe("rate over distance", () => {
  it("emits a particle per metre the emitter moved", () => {
    const emitter = core({ emission: { rateOverTime: 0, rateOverDistance: 2 }, start: { lifetime: 100 } });
    emitter.play();
    emitter.advance(FRAME);
    expect(emitter.emittedTotal).toBe(0);
    for (let index = 1; index <= 10; index += 1) {
      emitter.emitterWorld[12] = index;
      emitter.advance(FRAME);
    }
    expect(emitter.emittedTotal).toBe(20);
  });

  it("emits nothing while the emitter stands still", () => {
    const emitter = core({ emission: { rateOverTime: 0, rateOverDistance: 5 }, start: { lifetime: 100 } });
    emitter.play();
    run(emitter, 128);
    expect(emitter.emittedTotal).toBe(0);
  });

  it("does not count the jump from the origin on the first frame after play", () => {
    const emitter = core({ emission: { rateOverTime: 0, rateOverDistance: 5 }, start: { lifetime: 100 } });
    emitter.emitterWorld[12] = 1000;
    emitter.play();
    emitter.advance(FRAME);
    expect(emitter.emittedTotal).toBe(0);
  });
});

describe("determinism", () => {
  it("writes byte-identical records for one seed", () => {
    const first = core({ emission: { rateOverTime: 64 }, shape: { kind: "sphere", radius: 1 } }, 2024);
    const second = core({ emission: { rateOverTime: 64 }, shape: { kind: "sphere", radius: 1 } }, 2024);
    first.play();
    second.play();
    run(first, 128);
    run(second, 128);
    expect(second.emittedTotal).toBe(first.emittedTotal);
    expect(hashRecords(second, 60)).toBe(hashRecords(first, 60));
  });

  it("writes different records for a different seed", () => {
    const first = core({ emission: { rateOverTime: 64 }, shape: { kind: "sphere", radius: 1 } }, 1);
    const second = core({ emission: { rateOverTime: 64 }, shape: { kind: "sphere", radius: 1 } }, 2);
    first.play();
    second.play();
    run(first, 128);
    run(second, 128);
    expect(hashRecords(second, 60)).not.toBe(hashRecords(first, 60));
  });

  it("picks a random seed when the definition declares zero", () => {
    const emitter = core({}, 0);
    emitter.play();
    expect(emitter.seed).not.toBe(0);
  });

  it("keeps the declared seed", () => {
    const emitter = core({}, 77);
    emitter.play();
    expect(emitter.seed).toBe(77);
  });

  it("gives every record its own seed word", () => {
    const emitter = core({ emission: { rateOverTime: 64 }, start: { lifetime: 100 } }, 5);
    emitter.play();
    run(emitter, 64);
    const words = emitter.ring.words;
    const seeds = new Set<number>();
    for (let index = 0; index < 60; index += 1) {
      seeds.add(words[index * RECORD_FLOATS + RECORD_SEED] ?? 0);
    }
    expect(seeds.size).toBe(60);
  });
});

describe("playback", () => {
  it("does nothing before play", () => {
    const emitter = core({ emission: { rateOverTime: 100 } });
    run(emitter, 64);
    expect(emitter.emittedTotal).toBe(0);
    expect(emitter.isPlaying).toBe(false);
  });

  it("freezes the clock and the census while paused, and carries on after resume", () => {
    const emitter = core({ emission: { rateOverTime: 64 }, start: { lifetime: 2 } });
    emitter.play();
    run(emitter, 64);
    const alive = emitter.aliveCount;
    const clock = emitter.time;
    emitter.pause();
    expect(emitter.isPaused).toBe(true);
    run(emitter, 128);
    expect(emitter.time).toBe(clock);
    expect(emitter.aliveCount).toBe(alive);
    emitter.resume();
    run(emitter, 64);
    expect(emitter.time).toBeGreaterThan(clock);
    expect(emitter.emittedTotal).toBeGreaterThan(alive);
  });

  it("is idempotent: a second play only lifts a pause", () => {
    const emitter = core({ emission: { rateOverTime: 64 } });
    emitter.play();
    run(emitter, 32);
    const total = emitter.emittedTotal;
    emitter.pause();
    emitter.play();
    expect(emitter.isPaused).toBe(false);
    expect(emitter.emittedTotal).toBe(total);
  });

  it("lets live particles finish their lives after stop, then stays put", () => {
    const emitter = core({ emission: { rateOverTime: 64 }, start: { lifetime: 1 } });
    emitter.play();
    run(emitter, 64);
    expect(emitter.aliveCount).toBeGreaterThan(0);
    emitter.stop();
    expect(emitter.isPlaying).toBe(false);
    const emitted = emitter.emittedTotal;
    run(emitter, 96);
    expect(emitter.emittedTotal).toBe(emitted);
    expect(emitter.aliveCount).toBe(0);
    const clock = emitter.time;
    run(emitter, 60);
    expect(emitter.time).toBe(clock);
  });

  it("forgets every particle on stop with clear", () => {
    const emitter = core({ emission: { rateOverTime: 64 } });
    emitter.play();
    run(emitter, 64);
    emitter.stop({ clear: true });
    expect(emitter.aliveCount).toBe(0);
    expect(emitter.drawCount).toBe(0);
    expect(emitter.ring.written).toBe(0);
    expect(emitter.time).toBe(0);
  });

  it("restarts the clock and the seed stream when play follows a clearing stop", () => {
    const emitter = core({ emission: { rateOverTime: 60 }, start: { lifetime: 100 } }, 3);
    emitter.play();
    run(emitter, 64);
    const first = hashRecords(emitter, 30);
    emitter.stop({ clear: true });
    emitter.play();
    run(emitter, 64);
    expect(emitter.time).toBeCloseTo(1, 5);
    expect(hashRecords(emitter, 30)).toBe(first);
  });

  it("keeps the clock running when play follows a stop that kept the particles", () => {
    const emitter = core({ emission: { rateOverTime: 60 }, start: { lifetime: 100 } });
    emitter.play();
    run(emitter, 64);
    emitter.stop();
    emitter.play();
    run(emitter, 64);
    expect(emitter.time).toBeCloseTo(2, 5);
  });

  it("fires onStopped once when a non-looping system runs out of cycle and particles", () => {
    const emitter = core({
      main: { duration: 0.5, looping: false },
      emission: { rateOverTime: 20 },
      start: { lifetime: 0.5 },
    });
    let stopped = 0;
    emitter.onStopped = (): void => {
      stopped += 1;
    };
    emitter.play();
    run(emitter, 16);
    expect(stopped).toBe(0);
    run(emitter, 112);
    expect(stopped).toBe(1);
    expect(emitter.isPlaying).toBe(false);
    run(emitter, 128);
    expect(stopped).toBe(1);
  });

  it("never fires onStopped for a looping system", () => {
    const emitter = core({ main: { duration: 0.2 }, emission: { rateOverTime: 20 }, start: { lifetime: 0.2 } });
    let stopped = 0;
    emitter.onStopped = (): void => {
      stopped += 1;
    };
    emitter.play();
    run(emitter, 640);
    expect(stopped).toBe(0);
  });
});

describe("emit", () => {
  it("spawns the asked-for count at the current clock, playing or not", () => {
    const emitter = core({ emission: { rateOverTime: 0 }, start: { lifetime: 5 } });
    emitter.emit(7);
    expect(emitter.emittedTotal).toBe(7);
    emitter.reconcile();
    expect(emitter.aliveCount).toBe(7);
  });

  it("floors a fractional count and ignores a non-positive one", () => {
    const emitter = core({ emission: { rateOverTime: 0 } });
    emitter.emit(3.9);
    emitter.emit(0);
    emitter.emit(-4);
    expect(emitter.emittedTotal).toBe(3);
  });

  it("ignores the quality multiplier, because a script asked for an exact count", () => {
    const emitter = core({ emission: { rateOverTime: 0 } });
    emitter.qualityScale = 0.1;
    emitter.emit(10);
    expect(emitter.emittedTotal).toBe(10);
  });
});

describe("simulate", () => {
  it("reaches the same state as stepping the same number of sixtieths", () => {
    const stepped = core({ emission: { rateOverTime: 60 }, start: { lifetime: 100 } }, 8);
    const jumped = core({ emission: { rateOverTime: 60 }, start: { lifetime: 100 } }, 8);
    stepped.play();
    jumped.play();
    run(stepped, 120, 1 / 60);
    jumped.simulate(2);
    jumped.reconcile();
    expect(jumped.emittedTotal).toBe(stepped.emittedTotal);
    expect(jumped.time).toBeCloseTo(stepped.time, 6);
    expect(hashRecords(jumped, 60)).toBe(hashRecords(stepped, 60));
  });

  it("does nothing for a non-positive duration", () => {
    const emitter = core({ emission: { rateOverTime: 60 } });
    emitter.play();
    emitter.simulate(0);
    expect(emitter.time).toBe(0);
  });
});

describe("prewarm", () => {
  it("fast-forwards one cycle so a looping effect starts in full flow", () => {
    const warm = core({ main: { duration: 2, prewarm: true }, emission: { rateOverTime: 30 }, start: { lifetime: 1 } });
    const cold = core({
      main: { duration: 2, prewarm: false },
      emission: { rateOverTime: 30 },
      start: { lifetime: 1 },
    });
    warm.play();
    cold.play();
    warm.reconcile();
    cold.reconcile();
    expect(warm.time).toBeCloseTo(2, 5);
    expect(cold.time).toBe(0);
    expect(warm.aliveCount).toBeGreaterThan(20);
    expect(cold.aliveCount).toBe(0);
  });

  it("is ignored for a non-looping system, which would just play its whole life", () => {
    const emitter = core({
      main: { duration: 1, looping: false, prewarm: true },
      emission: { rateOverTime: 30 },
    });
    emitter.play();
    expect(emitter.time).toBe(0);
  });
});

describe("time scale", () => {
  it("advances the system clock faster than the frame", () => {
    const emitter = core({ main: { timeScale: 2 }, emission: { rateOverTime: 10 }, start: { lifetime: 100 } });
    emitter.play();
    run(emitter, 64);
    expect(emitter.time).toBeCloseTo(2, 5);
    expect(emitter.emittedTotal).toBe(20);
  });

  it("freezes the system at time scale zero", () => {
    const emitter = core({ main: { timeScale: 0 }, emission: { rateOverTime: 10 } });
    emitter.play();
    run(emitter, 64);
    expect(emitter.time).toBe(0);
    expect(emitter.emittedTotal).toBe(0);
  });
});

describe("the budget", () => {
  it("counts a spawn that displaced a particle that was still alive", () => {
    const emitter = core({ emission: { rateOverTime: 64 }, start: { lifetime: 10 } }, 1, 20);
    emitter.play();
    run(emitter, 64);
    expect(emitter.emittedTotal).toBe(64);
    expect(emitter.droppedTotal).toBe(44);
    expect(emitter.aliveCount).toBe(20);
  });

  it("counts nothing while the ring has room", () => {
    const emitter = core({ emission: { rateOverTime: 64 }, start: { lifetime: 0.2 } }, 1, 500);
    emitter.play();
    run(emitter, 64);
    expect(emitter.droppedTotal).toBe(0);
  });

  it("does not count a spawn that overwrote a record whose particle had already died", () => {
    const emitter = core({ emission: { rateOverTime: 64 }, start: { lifetime: 0.1 } }, 1, 12);
    emitter.play();
    run(emitter, 128);
    expect(emitter.droppedTotal).toBe(0);
  });
});

describe("the ring the core owns", () => {
  it("holds the clamped capacity, not the definition's", () => {
    const emitter = core({ main: { capacity: 5000 } }, 1, 64);
    expect(emitter.ring.capacity).toBe(64);
  });

  it("writes a lifetime inside the declared range for every record", () => {
    const emitter = core({ emission: { rateOverTime: 64 }, start: { lifetime: { min: 1, max: 3 } } });
    emitter.play();
    run(emitter, 64);
    const floats = emitter.ring.floats;
    for (let index = 0; index < emitter.emittedTotal; index += 1) {
      const lifetime = floats[index * RECORD_FLOATS + RECORD_LIFETIME] ?? 0;
      expect(lifetime).toBeGreaterThanOrEqual(1);
      expect(lifetime).toBeLessThanOrEqual(3);
    }
  });

  it("bakes the emitter matrix into a world-space record and leaves a local one alone", () => {
    const world = core({ main: { simulationSpace: "world" }, emission: { rateOverTime: 128 } });
    world.emitterWorld[12] = 100;
    world.play();
    world.advance(FRAME);
    expect(world.ring.floats[4]).toBeGreaterThan(90);

    const local = core({ main: { simulationSpace: "local" }, emission: { rateOverTime: 128 } });
    local.emitterWorld[12] = 100;
    local.play();
    local.advance(FRAME);
    expect(Math.abs(local.ring.floats[4] ?? 0)).toBeLessThan(1);
  });
});
