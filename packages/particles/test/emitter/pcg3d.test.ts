import { describe, expect, it } from "vitest";
import {
  EmitterRandom,
  hashToUnit,
  PARTICLE_SALT_Y,
  PARTICLE_SALT_Z,
  particleUnits,
  pcg3d,
  recordSeed,
} from "../../src/emitter/pcg3d.js";

/**
 * The reference vectors were computed from the Jarzynski & Olano algorithm with BigInt arithmetic
 * masked to 32 bits, which is an independent implementation of the same eight lines. If `pcg3d`
 * ever disagrees with these, the WGSL copy in `src/gpu/wgsl.ts` disagrees with the CPU evaluator.
 */
const KNOWN_ANSWERS: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[] = [
  [
    [0, 0, 0],
    [2_611_992_518, 2_833_812_075, 1_058_359_340],
  ],
  [
    [1, 2, 3],
    [4_204_755_366, 1_223_881_804, 1_500_469_937],
  ],
  [
    [0xff_ff_ff_ff, 0, 1],
    [626_526_752, 2_212_409_210, 3_931_418_885],
  ],
  [
    [123_456_789, 987_654_321, 42],
    [33_413_632, 634_159_986, 380_911_738],
  ],
  [
    [7, PARTICLE_SALT_Y, PARTICLE_SALT_Z],
    [3_142_553_512, 2_213_577_994, 3_191_216_838],
  ],
];

describe("pcg3d", () => {
  it("matches the paper's algorithm on pinned vectors", () => {
    const out = new Uint32Array(3);
    for (const [input, expected] of KNOWN_ANSWERS) {
      pcg3d(input[0], input[1], input[2], out);
      expect([...out], `pcg3d(${input.join(", ")})`).toEqual([...expected]);
    }
  });

  it("keeps every lane inside the unsigned 32-bit range", () => {
    const out = new Uint32Array(3);
    for (let index = 0; index < 512; index += 1) {
      pcg3d(index * 2_654_435_761, -index, index ^ 0x5f_5f_5f_5f, out);
      for (const word of out) {
        expect(Number.isInteger(word)).toBe(true);
        expect(word).toBeGreaterThanOrEqual(0);
        expect(word).toBeLessThanOrEqual(0xff_ff_ff_ff);
      }
    }
  });

  it("wraps a negative lane to its two's complement, as the shader's bitcast does", () => {
    const negative = new Uint32Array(3);
    const wrapped = new Uint32Array(3);
    pcg3d(-1, -2, -3, negative);
    pcg3d(0xff_ff_ff_ff, 0xff_ff_ff_fe, 0xff_ff_ff_fd, wrapped);
    expect([...negative]).toEqual([...wrapped]);
  });
});

describe("hashToUnit", () => {
  it("maps the whole word range into [0, 1)", () => {
    expect(hashToUnit(0)).toBe(0);
    expect(hashToUnit(0xff_ff_ff_ff)).toBeLessThan(1);
    expect(hashToUnit(0xff_ff_ff_ff)).toBeGreaterThan(0.999_999_999);
    expect(hashToUnit(0x80_00_00_00)).toBeCloseTo(0.5, 12);
  });
});

describe("particleUnits", () => {
  it("derives three independent unit floats from one record seed", () => {
    const out = new Float32Array(3);
    const scratch = new Uint32Array(3);
    particleUnits(7, out, scratch);
    const words = new Uint32Array(3);
    pcg3d(7, PARTICLE_SALT_Y, PARTICLE_SALT_Z, words);
    expect(out[0]).toBeCloseTo(hashToUnit(words[0] ?? 0), 6);
    expect(out[1]).toBeCloseTo(hashToUnit(words[1] ?? 0), 6);
    expect(out[2]).toBeCloseTo(hashToUnit(words[2] ?? 0), 6);
    expect(out[0]).not.toBe(out[1]);
  });
});

describe("recordSeed", () => {
  it("gives two records of one system different seeds", () => {
    const scratch = new Uint32Array(3);
    const first = recordSeed(11, 0, scratch);
    const second = recordSeed(11, 1, scratch);
    expect(first).not.toBe(second);
  });

  it("gives one record index different seeds under different system seeds", () => {
    const scratch = new Uint32Array(3);
    expect(recordSeed(11, 5, scratch)).not.toBe(recordSeed(12, 5, scratch));
  });

  it("repeats for the same system seed and index", () => {
    const scratch = new Uint32Array(3);
    expect(recordSeed(99, 4, scratch)).toBe(recordSeed(99, 4, scratch));
  });
});

describe("EmitterRandom", () => {
  it("draws the same stream twice from one seed", () => {
    const first = new EmitterRandom(5);
    const second = new EmitterRandom(5);
    for (let index = 0; index < 32; index += 1) {
      expect(second.next()).toBe(first.next());
    }
  });

  it("restarts the stream on reseed", () => {
    const stream = new EmitterRandom(5);
    const head = [stream.next(), stream.next(), stream.next(), stream.next()];
    stream.reseed(5);
    expect([stream.next(), stream.next(), stream.next(), stream.next()]).toEqual(head);
    expect(stream.seed).toBe(5);
  });

  it("stays inside [0, 1) over a long run and spreads across it", () => {
    const stream = new EmitterRandom(1234);
    const buckets = [0, 0, 0, 0];
    for (let index = 0; index < 4000; index += 1) {
      const value = stream.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const bucket = Math.min(3, Math.floor(value * 4));
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700);
    }
  });
});
