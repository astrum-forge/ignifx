import type { TerrainNoiseDefinition } from "../definition/types.js";

/**
 * Seeded fractal noise for procedural terrains (`docs/plan/2026-09-terrain-particles-shaders.md`
 * §5.1).
 *
 * The lattice values come from an integer hash and the interpolation uses only `+ - * /`, so one
 * seed produces a bit-identical field in Node and in the browser (`CONSTITUTION.md` §2.1).
 */

/**
 * A 32-bit integer hash of three integers.
 *
 * @param x - The first coordinate.
 * @param z - The second coordinate.
 * @param seed - The seed.
 * @returns An unsigned 32-bit hash.
 */
function hash3(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(z | 0, 0xd8163841) ^ Math.imul(seed | 0, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * A lattice value in `0..1`.
 *
 * @param x - The lattice column.
 * @param z - The lattice row.
 * @param seed - The seed.
 * @returns The value.
 */
function lattice(x: number, z: number, seed: number): number {
  return hash3(x, z, seed) / 4_294_967_296;
}

/**
 * Quintic smoothstep, so the noise has continuous second derivatives and no visible grid.
 *
 * @param t - A fraction in `0..1`.
 * @returns The eased fraction.
 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Smooth value noise at a point, in `0..1`.
 *
 * @param x - The sample position, in lattice units.
 * @param z - The sample position, in lattice units.
 * @param seed - The seed.
 * @returns The value.
 */
function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const a = lattice(x0, z0, seed);
  const b = lattice(x0 + 1, z0, seed);
  const c = lattice(x0, z0 + 1, seed);
  const d = lattice(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

/**
 * Fills a normalised height field from noise.
 *
 * @param resolution - Samples per side.
 * @param widthMetres - The field's extent along X, in metres, so `frequency` is in cycles per metre.
 * @param depthMetres - The field's extent along Z, in metres.
 * @param noise - The noise parameters.
 * @param out - `resolution * resolution` floats to fill, or omitted for a fresh array.
 * @returns The field, normalised to `0..1`.
 *
 * @example
 * ```ts
 * const values = generateNoiseField(129, 128, 128, { seed: 7, octaves: 5, frequency: 0.02, lacunarity: 2, persistence: 0.5, ridged: false, terraces: 0 });
 * ```
 *
 * @public
 */
export function generateNoiseField(
  resolution: number,
  widthMetres: number,
  depthMetres: number,
  noise: TerrainNoiseDefinition,
  out?: Float32Array,
): Float32Array {
  const count = resolution * resolution;
  const values = out ?? new Float32Array(count);
  const spacingX = widthMetres / (resolution - 1);
  const spacingZ = depthMetres / (resolution - 1);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let iz = 0; iz < resolution; iz += 1) {
    const z = iz * spacingZ;
    for (let ix = 0; ix < resolution; ix += 1) {
      const x = ix * spacingX;
      let amplitude = 1;
      let frequency = noise.frequency;
      let sum = 0;
      let total = 0;
      for (let octave = 0; octave < noise.octaves; octave += 1) {
        let n = valueNoise(x * frequency, z * frequency, noise.seed + octave * 7919);
        if (noise.ridged) {
          n = 1 - Math.abs(2 * n - 1);
          n *= n;
        }
        sum += n * amplitude;
        total += amplitude;
        amplitude *= noise.persistence;
        frequency *= noise.lacunarity;
      }
      const value = total > 0 ? sum / total : 0;
      values[iz * resolution + ix] = value;
      min = value < min ? value : min;
      max = value > max ? value : max;
    }
  }
  const range = max - min;
  const scale = range > 0 ? 1 / range : 0;
  const terraces = noise.terraces >= 2 ? noise.terraces : 0;
  for (let index = 0; index < count; index += 1) {
    let value = ((values[index] ?? 0) - min) * scale;
    if (terraces > 0) {
      value = Math.min(1, Math.floor(value * terraces) / (terraces - 1));
    }
    values[index] = value;
  }
  return values;
}

/**
 * A stable 32-bit hash of a float array, for determinism tests and replays.
 *
 * @remarks
 * Hashes the IEEE bit pattern of every element, so two arrays hash alike exactly when they are
 * bit-identical.
 *
 * @param values - The array.
 * @returns An unsigned 32-bit hash.
 *
 * @public
 */
export function hashFloats(values: Float32Array): number {
  const words = new Uint32Array(values.buffer, values.byteOffset, values.length);
  let h = 0x811c9dc5;
  for (let index = 0; index < words.length; index += 1) {
    h ^= words[index] ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
