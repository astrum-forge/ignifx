// `pcg3d` (Jarzynski & Olano, JCGT 2020), the randomness both evaluators share
// (`docs/plan/2026-09-terrain-particles-shaders.md` §4.1). `Math.imul` and `>>> 0` keep every
// intermediate a `u32`, so this and the WGSL copy in `src/gpu/wgsl.ts` produce identical bits.

/** The LCG multiplier. */
const MULTIPLIER = 1664525;

/** The LCG increment. */
const INCREMENT = 1013904223;

/** `2^-32`, the factor that turns a `u32` into a unit float in `[0, 1)`. */
const UNIT_SCALE = 2.3283064365386963e-10;

/** The second lane every per-particle hash is salted with. */
export const PARTICLE_SALT_Y = 0x9e3779b9;

/** The third lane every per-particle hash is salted with. */
export const PARTICLE_SALT_Z = 0x85ebca6b;

/** The salt the per-record `seed` is derived from the system seed and record index with. */
export const RECORD_SEED_SALT = 0x1b873593;

/**
 * Hashes three 32-bit words into three others, bit-identically to the WGSL `pcg3d`.
 *
 * @param x - The first lane; any number, wrapped to `u32`.
 * @param y - The second lane.
 * @param z - The third lane.
 * @param out - Receives the three hashed words.
 * @returns `out`.
 *
 * @beta
 */
export function pcg3d(x: number, y: number, z: number, out: Uint32Array): Uint32Array {
  let vx = (Math.imul(x >>> 0, MULTIPLIER) + INCREMENT) >>> 0;
  let vy = (Math.imul(y >>> 0, MULTIPLIER) + INCREMENT) >>> 0;
  let vz = (Math.imul(z >>> 0, MULTIPLIER) + INCREMENT) >>> 0;
  vx = (vx + Math.imul(vy, vz)) >>> 0;
  vy = (vy + Math.imul(vz, vx)) >>> 0;
  vz = (vz + Math.imul(vx, vy)) >>> 0;
  vx = (vx ^ (vx >>> 16)) >>> 0;
  vy = (vy ^ (vy >>> 16)) >>> 0;
  vz = (vz ^ (vz >>> 16)) >>> 0;
  vx = (vx + Math.imul(vy, vz)) >>> 0;
  vy = (vy + Math.imul(vz, vx)) >>> 0;
  vz = (vz + Math.imul(vx, vy)) >>> 0;
  out[0] = vx;
  out[1] = vy;
  out[2] = vz;
  return out;
}

/**
 * Turns a hashed word into a unit float in `[0, 1)` — the same `f32(h) * 2^-32` the shader uses.
 *
 * @param word - A `u32`.
 * @returns The unit float.
 *
 * @beta
 */
export function hashToUnit(word: number): number {
  return (word >>> 0) * UNIT_SCALE;
}

/**
 * The three unit floats every per-particle derivation reads from a record's `seed`: the start
 * colour pick, the angular speed pick, and the sheet's random frame.
 *
 * @param seed - The record's `seed` word.
 * @param out - Receives three floats in `[0, 1)`.
 * @param scratch - Three words of scratch space.
 * @returns `out`.
 *
 * @beta
 */
export function particleUnits(seed: number, out: Float32Array, scratch: Uint32Array): Float32Array {
  pcg3d(seed, PARTICLE_SALT_Y, PARTICLE_SALT_Z, scratch);
  out[0] = hashToUnit(scratch[0] ?? 0);
  out[1] = hashToUnit(scratch[1] ?? 0);
  out[2] = hashToUnit(scratch[2] ?? 0);
  return out;
}

/**
 * The `seed` word a record gets from the system seed and its index.
 *
 * @param systemSeed - The system's seed.
 * @param index - The record's index since `play()`.
 * @param scratch - Three words of scratch space.
 * @returns The record seed.
 *
 * @beta
 */
export function recordSeed(systemSeed: number, index: number, scratch: Uint32Array): number {
  pcg3d(systemSeed, index, RECORD_SEED_SALT, scratch);
  return scratch[0] ?? 0;
}

/**
 * A deterministic stream of unit floats for the emission scheduler, drawn from `pcg3d` over a
 * counter so two systems with the same seed and the same frame deltas roll the same numbers.
 *
 * @beta
 */
export class EmitterRandom {
  readonly #words = new Uint32Array(3);

  #seed = 0;

  #counter = 0;

  #remaining = 0;

  /**
   * Creates a stream.
   *
   * @param seed - The seed to start from.
   */
  constructor(seed: number) {
    this.reseed(seed);
  }

  /**
   * The seed the stream runs on.
   *
   * @returns The seed.
   */
  get seed(): number {
    return this.#seed;
  }

  /**
   * Restarts the stream from a seed.
   *
   * @param seed - The new seed.
   */
  reseed(seed: number): void {
    this.#seed = seed >>> 0;
    this.#counter = 0;
    this.#remaining = 0;
  }

  /**
   * The next unit float in `[0, 1)`.
   *
   * @returns The number.
   */
  next(): number {
    if (this.#remaining === 0) {
      pcg3d(this.#seed, this.#counter, PARTICLE_SALT_Z, this.#words);
      this.#counter = (this.#counter + 1) >>> 0;
      this.#remaining = 3;
    }
    this.#remaining -= 1;
    return hashToUnit(this.#words[this.#remaining] ?? 0);
  }
}
