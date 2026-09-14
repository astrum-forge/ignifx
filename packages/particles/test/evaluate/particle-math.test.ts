import { describe, expect, it } from "vitest";
import { defineParticles } from "../../src/definition/define-particles.js";
import { bakeCurve, bakeGradient, sampleRow, srgbToLinear } from "../../src/definition/values.js";
import { SpawnRecordRing } from "../../src/emitter/record-ring.js";
import {
  createParticleState,
  evaluateParticle,
  readScalarRow,
  transformDirection,
  transformPoint,
} from "../../src/evaluate/particle-math.js";
import type { ParticleDefinition } from "../../src/definition/types.js";
import type { ParticleEvaluationInputs, ParticleState } from "../../src/evaluate/particle-math.js";

/** An identity column-major matrix. */
function identity(): Float32Array {
  return Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** One record in a ring of one, plus the inputs the evaluator needs. */
interface Fixture {
  readonly ring: SpawnRecordRing;
  readonly inputs: ParticleEvaluationInputs;
  readonly state: ParticleState;
  /** Evaluates the single record at a clock. */
  at(clock: number): boolean;
}

/** How a fixture's one record is written. */
interface RecordFields {
  readonly spawnTime?: number;
  readonly lifetime?: number;
  readonly seed?: number;
  readonly position?: readonly [number, number, number];
  readonly velocity?: readonly [number, number, number];
  readonly size?: number;
  readonly rotation?: number;
}

/**
 * Builds a one-record fixture.
 *
 * @param definition - The definition the record was written from.
 * @param record - The record's fields.
 * @param gravity - The effective gravity in simulation space.
 * @returns The fixture.
 */
function fixture(
  definition: ParticleDefinition,
  record: RecordFields = {},
  gravity: readonly [number, number, number] = [0, 0, 0],
): Fixture {
  const ring = new SpawnRecordRing(1);
  const position = record.position ?? [0, 0, 0];
  const velocity = record.velocity ?? [0, 0, 0];
  ring.write(
    record.spawnTime ?? 0,
    record.lifetime ?? 2,
    record.seed ?? 1,
    0,
    position[0],
    position[1],
    position[2],
    record.size ?? 1,
    velocity[0],
    velocity[1],
    velocity[2],
    record.rotation ?? 0,
  );
  const inputs: ParticleEvaluationInputs = {
    definition,
    gravity: Float32Array.from(gravity),
    emitterWorld: identity(),
    orbitCenter: Float32Array.from([0, 0, 0]),
  };
  const state = createParticleState();
  return { ring, inputs, state, at: (clock) => evaluateParticle(inputs, ring.floats, ring.words, 0, clock, state) };
}

/**
 * Reads one channel of a baked gradient with the linear rule both evaluators share.
 *
 * @param baked - The baked samples, four floats per texel.
 * @param life - The normalized time.
 * @param channel - Which of the four channels.
 * @returns The interpolated channel, in sRGB.
 */
function lerpBaked(baked: Float32Array, life: number, channel: number): number {
  const x = life * 63;
  const index = Math.floor(x);
  const next = Math.min(63, index + 1);
  const a = baked[index * 4 + channel] ?? 0;
  const b = baked[next * 4 + channel] ?? 0;
  return a + (b - a) * (x - index);
}

describe("a dead record", () => {
  it("is refused before its spawn, after its lifetime, and with no lifetime at all", () => {
    const plain = fixture(defineParticles({}), { spawnTime: 1, lifetime: 2 });
    expect(plain.at(0.5)).toBe(false);
    expect(plain.at(3.5)).toBe(false);
    expect(plain.at(1)).toBe(true);
    expect(plain.at(3)).toBe(true);
    const empty = fixture(defineParticles({}), { lifetime: 0 });
    expect(empty.at(0)).toBe(false);
  });
});

describe("the closed form with no drag", () => {
  it("is the parabola p0 + v0 t + half g t squared", () => {
    const f = fixture(
      defineParticles({ forces: { drag: 0 } }),
      { position: [1, 2, 3], velocity: [4, -1, 0.5], lifetime: 10 },
      [0, -9.81, 0],
    );
    for (const t of [0, 0.25, 1, 2.5, 7]) {
      expect(f.at(t)).toBe(true);
      expect(f.state.position[0]).toBeCloseTo(1 + 4 * t, 4);
      expect(f.state.position[1]).toBeCloseTo(2 - t - 0.5 * 9.81 * t * t, 3);
      expect(f.state.position[2]).toBeCloseTo(3 + 0.5 * t, 4);
      expect(f.state.velocity[1]).toBeCloseTo(-1 - 9.81 * t, 4);
    }
  });
});

describe("the closed form with drag", () => {
  it("matches the analytic solution of v' = g - k v", () => {
    const k = 1.5;
    const g = -9.81;
    const f = fixture(
      defineParticles({ forces: { drag: k } }),
      { position: [0, 0, 0], velocity: [0, 5, 0], lifetime: 10 },
      [0, g, 0],
    );
    for (const t of [0.1, 0.5, 2, 6]) {
      f.at(t);
      const terminal = g / k;
      const expected = (5 - terminal) * ((1 - Math.exp(-k * t)) / k) + terminal * t;
      expect(f.state.position[1]).toBeCloseTo(expected, 4);
      expect(f.state.velocity[1]).toBeCloseTo((5 - terminal) * Math.exp(-k * t) + terminal, 4);
    }
  });

  it("settles at the terminal velocity g over k", () => {
    const f = fixture(
      defineParticles({ forces: { drag: 2 }, start: { lifetime: 60 } }),
      { velocity: [0, 0, 0], lifetime: 60 },
      [0, -10, 0],
    );
    f.at(30);
    expect(f.state.velocity[1]).toBeCloseTo(-5, 6);
  });

  it("approaches the drag-free parabola as the drag approaches zero", () => {
    const t = 1.5;
    const free = fixture(
      defineParticles({ forces: { drag: 0 } }),
      { velocity: [1, 2, 0], lifetime: 10 },
      [0, -9.81, 0],
    );
    free.at(t);
    const tiny = fixture(
      defineParticles({ forces: { drag: 1e-5 } }),
      { velocity: [1, 2, 0], lifetime: 10 },
      [0, -9.81, 0],
    );
    tiny.at(t);
    expect(tiny.state.position[0]).toBeCloseTo(free.state.position[0] ?? 0, 4);
    expect(tiny.state.position[1]).toBeCloseTo(free.state.position[1] ?? 0, 3);
  });
});

describe("orbit", () => {
  it("is a rotation: it preserves the distance from the axis", () => {
    const definition = defineParticles({ forces: { orbit: { axis: { x: 0, y: 1, z: 0 }, speed: 90 } } });
    const f = fixture(definition, { position: [2, 1, 0], lifetime: 10 });
    for (const t of [0, 0.5, 1, 3.25]) {
      f.at(t);
      const x = f.state.position[0] ?? 0;
      const y = f.state.position[1] ?? 0;
      const z = f.state.position[2] ?? 0;
      expect(Math.hypot(x, z)).toBeCloseTo(2, 5);
      expect(y).toBeCloseTo(1, 5);
    }
  });

  it("turns by the declared degrees per second", () => {
    const definition = defineParticles({ forces: { orbit: { axis: { x: 0, y: 1, z: 0 }, speed: 90 } } });
    const f = fixture(definition, { position: [1, 0, 0], lifetime: 10 });
    f.at(1);
    expect(f.state.position[0]).toBeCloseTo(0, 5);
    expect(f.state.position[2]).toBeCloseTo(-1, 5);
  });

  it("rotates the velocity with the position", () => {
    const definition = defineParticles({ forces: { orbit: { axis: { x: 0, y: 1, z: 0 }, speed: 180 } } });
    const f = fixture(definition, { position: [1, 0, 0], velocity: [0, 0, 1], lifetime: 10 });
    f.at(1);
    expect(f.state.velocity[2]).toBeCloseTo(-1, 5);
  });
});

describe("noise", () => {
  it("offsets the position without changing it over time when the field does not scroll", () => {
    const still = defineParticles({ forces: { noise: { strength: 0, frequency: 1 } } });
    const shaken = defineParticles({ forces: { noise: { strength: 2, frequency: 1 } } });
    const a = fixture(still, { position: [0.3, 0.7, 1.1], lifetime: 10 });
    const b = fixture(shaken, { position: [0.3, 0.7, 1.1], lifetime: 10 });
    a.at(1);
    b.at(1);
    const distance = Math.hypot(
      (b.state.position[0] ?? 0) - (a.state.position[0] ?? 0),
      (b.state.position[1] ?? 0) - (a.state.position[1] ?? 0),
      (b.state.position[2] ?? 0) - (a.state.position[2] ?? 0),
    );
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThanOrEqual(2 * Math.sqrt(3) * 1.5);
  });

  it("fades with the influence curve, so a particle ends where the analytic form put it", () => {
    const definition = defineParticles({
      forces: {
        noise: {
          strength: 3,
          frequency: 2,
          influenceOverLife: {
            curve: {
              keys: [
                [0, 1, 0, 0],
                [1, 0, 0, 0],
              ],
            },
          },
        },
      },
    });
    const noisy = fixture(definition, { position: [0.3, 0.7, 1.1], lifetime: 2 });
    const plain = fixture(defineParticles({}), { position: [0.3, 0.7, 1.1], lifetime: 2 });
    noisy.at(2);
    plain.at(2);
    expect(noisy.state.position[0]).toBeCloseTo(plain.state.position[0] ?? 0, 2);
    noisy.at(0.01);
    const offset = Math.hypot(
      (noisy.state.position[0] ?? 0) - (plain.state.position[0] ?? 0),
      (noisy.state.position[1] ?? 0) - (plain.state.position[1] ?? 0),
      (noisy.state.position[2] ?? 0) - (plain.state.position[2] ?? 0),
    );
    expect(offset).toBeGreaterThan(0.05);
  });
});

describe("simulation space", () => {
  it("takes a local-space position through the emitter matrix", () => {
    const definition = defineParticles({ main: { simulationSpace: "local" } });
    const f = fixture(definition, { position: [1, 0, 0], velocity: [0, 1, 0], lifetime: 10 });
    f.inputs.emitterWorld[12] = 10;
    f.inputs.emitterWorld[13] = 5;
    f.at(0);
    expect([...f.state.position]).toEqual([11, 5, 0]);
    expect([...f.state.velocity]).toEqual([0, 1, 0]);
  });

  it("leaves a world-space position alone", () => {
    const definition = defineParticles({ main: { simulationSpace: "world" } });
    const f = fixture(definition, { position: [1, 0, 0], lifetime: 10 });
    f.inputs.emitterWorld[12] = 10;
    f.at(0);
    expect(f.state.position[0]).toBe(1);
  });
});

describe("the lookup rows", () => {
  it("decodes a scalar row to the baked curve, to within the byte quantization", () => {
    const curve = {
      keys: [
        [0, 0.2, 0, 0],
        [0.5, 1.6, 0, 0],
        [1, 0.4, 0, 0],
      ],
    } as const;
    const definition = defineParticles({ overLifetime: { size: { curve } } });
    const samples = bakeCurve(curve);
    const row = definition.lookup.size;
    for (const life of [0, 0.13, 0.37, 0.5, 0.82, 1]) {
      const decoded = readScalarRow(definition, row, life, 0, 0);
      expect(decoded).toBeCloseTo(sampleRow(samples, life), 1);
    }
  });

  it("returns the fallback when the definition has no such row", () => {
    expect(readScalarRow(defineParticles({}), null, 0.5, 0, 7)).toBe(7);
  });

  it("multiplies the start colour by the gradient row and decodes sRGB to linear", () => {
    const stops = [
      [0, 1, 1, 1, 1],
      [1, 0, 0, 0, 0],
    ] as const;
    const definition = defineParticles({
      start: { color: [1, 1, 1, 1] },
      overLifetime: { color: { gradient: stops } },
    });
    const baked = bakeGradient(stops);
    const f = fixture(definition, { lifetime: 4 });
    for (const life of [0, 0.25, 0.5, 1]) {
      f.at(life * 4);
      expect(f.state.color[0]).toBeCloseTo(srgbToLinear(lerpBaked(baked, life, 0)), 1);
      expect(f.state.color[3]).toBeCloseTo(lerpBaked(baked, life, 3), 1);
    }
  });

  it("scales the size per axis from the record and the size row", () => {
    const definition = defineParticles({
      start: { size3D: { x: 2, y: 1, z: 0.5 } },
      overLifetime: {
        size: {
          curve: {
            keys: [
              [0, 1, 0, 0],
              [1, 0, 0, 0],
            ],
          },
        },
      },
    });
    const f = fixture(definition, { size: 3, lifetime: 2 });
    f.at(0);
    expect(f.state.size[0]).toBeCloseTo(6, 1);
    expect(f.state.size[1]).toBeCloseTo(3, 1);
    expect(f.state.size[2]).toBeCloseTo(1.5, 1);
    f.at(2);
    expect(f.state.size[0]).toBeCloseTo(0, 2);
  });
});

describe("rotation over life", () => {
  it("adds a constant angular speed to the start rotation", () => {
    const definition = defineParticles({ overLifetime: { rotation: 90 } });
    const f = fixture(definition, { rotation: 0.5, lifetime: 10 });
    f.at(2);
    expect(f.state.rotation).toBeCloseTo(0.5 + Math.PI, 5);
  });

  it("picks one angular speed per particle from a range", () => {
    const definition = defineParticles({ overLifetime: { rotation: { min: -90, max: 90 } } });
    const slow = fixture(definition, { seed: 1, lifetime: 10 });
    const fast = fixture(definition, { seed: 2, lifetime: 10 });
    slow.at(1);
    fast.at(1);
    expect(slow.state.rotation).not.toBe(fast.state.rotation);
    expect(Math.abs(slow.state.rotation)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
  });

  it("reads an angular speed curve at the particle's own age", () => {
    const definition = defineParticles({
      overLifetime: {
        rotation: {
          curve: {
            keys: [
              [0, 0, 0, 0],
              [1, 360, 0, 0],
            ],
          },
        },
      },
    });
    const f = fixture(definition, { lifetime: 2 });
    f.at(0.02);
    expect(f.state.rotation).toBeCloseTo(0, 2);
    f.at(2);
    expect(f.state.rotation).toBeCloseTo(360 * (Math.PI / 180) * 2, 0);
  });
});

describe("the sprite sheet frame", () => {
  it("is zero without a sheet", () => {
    const f = fixture(defineParticles({}), { lifetime: 2 });
    f.at(1);
    expect(f.state.frame).toBe(0);
  });

  it("walks the sheet over the particle's life for a curve", () => {
    const definition = defineParticles({ renderer: { sheet: { tiles: { x: 4, y: 2 } } } });
    const f = fixture(definition, { lifetime: 8 });
    f.at(0);
    expect(f.state.frame).toBe(0);
    f.at(8);
    expect(f.state.frame).toBe(7);
  });

  it("picks one frame per particle at random and keeps it", () => {
    const definition = defineParticles({ renderer: { sheet: { tiles: { x: 4, y: 1 }, frameOverTime: "random" } } });
    const f = fixture(definition, { seed: 9, lifetime: 4 });
    f.at(0);
    const first = f.state.frame;
    f.at(3);
    expect(f.state.frame).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(3);
  });

  it("advances at the declared frame rate and wraps", () => {
    const definition = defineParticles({ renderer: { sheet: { tiles: { x: 4, y: 1 }, frameOverTime: { fps: 4 } } } });
    const f = fixture(definition, { seed: 3, lifetime: 10 });
    f.at(0);
    const start = f.state.frame;
    f.at(1);
    expect(f.state.frame).toBe(start);
    f.at(0.25);
    expect(f.state.frame).toBe((start + 1) % 4);
  });
});

describe("the matrix helpers", () => {
  it("translates a point but not a direction", () => {
    const m = identity();
    m[12] = 3;
    m[13] = -2;
    const point = Float32Array.from([1, 1, 1]);
    const direction = Float32Array.from([1, 1, 1]);
    transformPoint(m, point);
    transformDirection(m, direction);
    expect([...point]).toEqual([4, -1, 1]);
    expect([...direction]).toEqual([1, 1, 1]);
  });
});
