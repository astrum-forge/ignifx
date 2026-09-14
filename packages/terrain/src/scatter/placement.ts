import { sampleControlWeight } from "../material/splat-rules.js";
import type { HeightField } from "../heightfield/height-field.js";
import type { ControlMaps } from "../material/splat-rules.js";

/**
 * Seeded foliage placement (`docs/plan/2026-09-terrain-particles-shaders.md` §5.5).
 *
 * Candidates sit on a jittered grid, so the result is even rather than clumped, and every random
 * number comes from an integer hash of the cell and the seed — never a running generator — so a
 * placement is reproducible and a test can pin it. Everything here is pure and headless.
 */

/** Two pi, the full turn a random yaw is drawn from. */
const TAU = Math.PI * 2;

/** The divisor that turns a 32-bit hash into a fraction in `0..1`. */
const HASH_SCALE = 4_294_967_296;

/** Floats per position or normal. */
const VECTOR_STRIDE = 3;

/**
 * What decides where a `TerrainScatter` puts its instances.
 *
 * @public
 */
export interface ScatterRules {
  /** Instances per square metre of terrain. */
  readonly density: number;
  /** Control-channel indices a candidate may stand on; empty places everywhere. */
  readonly layers: readonly number[];
  /** The splat weight a named layer must reach, `0` to `1`. */
  readonly layerThreshold: number;
  /** The shallowest slope that accepts a candidate, in degrees. */
  readonly slopeMin: number;
  /** The steepest slope that accepts a candidate, in degrees. */
  readonly slopeMax: number;
  /** The lowest height that accepts a candidate, in metres. */
  readonly heightMin: number;
  /** The highest height that accepts a candidate, in metres. */
  readonly heightMax: number;
  /** The smallest random scale. */
  readonly scaleMin: number;
  /** The largest random scale. */
  readonly scaleMax: number;
  /** Whether each instance is turned by a random angle about Y. */
  readonly randomYaw: boolean;
  /** The seed; the same seed always places the same instances. */
  readonly seed: number;
  /** The most instances to place, whatever the density asks for. */
  readonly maxInstances: number;
}

/**
 * The per-instance arrays {@link generateScatter} fills, in the terrain's local frame.
 *
 * @public
 */
export interface ScatterPlacements {
  /** Three floats per instance. */
  readonly positions: Float32Array;
  /** Three floats per instance: the surface normal there. */
  readonly normals: Float32Array;
  /** One angle per instance, in radians about Y. */
  readonly yaw: Float32Array;
  /** One uniform scale per instance. */
  readonly scale: Float32Array;
}

/**
 * Allocates placement arrays for a capacity.
 *
 * @param capacity - The most instances they will hold.
 * @returns Fresh arrays. **Allocates** — build them once per capacity, not per frame.
 *
 * @public
 */
export function createScatterPlacements(capacity: number): ScatterPlacements {
  return {
    positions: new Float32Array(capacity * VECTOR_STRIDE),
    normals: new Float32Array(capacity * VECTOR_STRIDE),
    yaw: new Float32Array(capacity),
    scale: new Float32Array(capacity),
  };
}

/**
 * How many instances a density asks for over a field, before any rule rejects one.
 *
 * @param field - The height field, which fixes the area.
 * @param density - Instances per square metre.
 * @param maxInstances - The cap.
 * @returns The candidate count.
 *
 * @public
 */
export function scatterCapacity(field: HeightField, density: number, maxInstances: number): number {
  const wanted = Math.floor(field.width * field.depth * Math.max(0, density));
  return Math.max(0, Math.min(Math.floor(maxInstances), wanted));
}

/**
 * Places instances on a terrain and reports how many passed every rule.
 *
 * @param field - The height field, read in its local frame.
 * @param control - The splat weights, for the layer rule.
 * @param rules - What accepts a candidate and how it is turned and scaled.
 * @param out - Receives the placements; its length caps the result.
 * @returns How many instances were written.
 *
 * @example
 * ```ts
 * const placements = createScatterPlacements(scatterCapacity(field, 0.5, 50_000));
 * const count = generateScatter(field, control, rules, placements);
 * ```
 *
 * @public
 */
export function generateScatter(
  field: HeightField,
  control: ControlMaps,
  rules: ScatterRules,
  out: ScatterPlacements,
): number {
  const capacity = Math.min(out.yaw.length, Math.floor(rules.maxInstances));
  if (capacity <= 0) {
    return 0;
  }
  const wanted = scatterCapacity(field, rules.density, capacity);
  if (wanted <= 0) {
    return 0;
  }
  const side = Math.max(1, Math.ceil(Math.sqrt(wanted)));
  const cellX = field.width / side;
  const cellZ = field.depth / side;
  const originX = -field.width / 2;
  const originZ = -field.depth / 2;
  const seed = rules.seed | 0;
  let count = 0;
  for (let cellRow = 0; cellRow < side && count < capacity; cellRow += 1) {
    for (let cellColumn = 0; cellColumn < side && count < capacity; cellColumn += 1) {
      const base = hash3(cellColumn, cellRow, seed);
      const x = originX + (cellColumn + fractionOf(base, 0)) * cellX;
      const z = originZ + (cellRow + fractionOf(base, 1)) * cellZ;
      if (!accepts(field, control, rules, x, z)) {
        continue;
      }
      const at = count * VECTOR_STRIDE;
      out.positions[at] = x;
      out.positions[at + 1] = field.heightAt(x, z);
      out.positions[at + 2] = z;
      writeNormal(field, x, z, out.normals, at);
      out.yaw[count] = rules.randomYaw ? fractionOf(base, 2) * TAU : 0;
      out.scale[count] = rules.scaleMin + (rules.scaleMax - rules.scaleMin) * fractionOf(base, 3);
      count += 1;
    }
  }
  return count;
}

/**
 * Whether a candidate passes the slope, height, and layer rules.
 *
 * @param field - The height field.
 * @param control - The splat weights.
 * @param rules - The rules.
 * @param x - The candidate's local X.
 * @param z - The candidate's local Z.
 * @returns `true` when the candidate stands.
 */
function accepts(field: HeightField, control: ControlMaps, rules: ScatterRules, x: number, z: number): boolean {
  const height = field.heightAt(x, z);
  if (height < rules.heightMin || height > rules.heightMax) {
    return false;
  }
  const slope = field.slopeAt(x, z);
  if (slope < rules.slopeMin || slope > rules.slopeMax) {
    return false;
  }
  if (rules.layers.length === 0) {
    return true;
  }
  const u = (x - -field.width / 2) / field.width;
  const v = (z - -field.depth / 2) / field.depth;
  for (let index = 0; index < rules.layers.length; index += 1) {
    const layer = rules.layers[index];
    if (layer !== undefined && sampleControlWeight(control, layer, u, v) >= rules.layerThreshold) {
      return true;
    }
  }
  return false;
}

/**
 * Writes the surface normal at a point into a packed array.
 *
 * @param field - The height field.
 * @param x - The local X.
 * @param z - The local Z.
 * @param out - The packed normals.
 * @param at - Where to write.
 */
function writeNormal(field: HeightField, x: number, z: number, out: Float32Array, at: number): void {
  const dx = (field.heightAt(x + field.spacingX, z) - field.heightAt(x - field.spacingX, z)) / (2 * field.spacingX);
  const dz = (field.heightAt(x, z + field.spacingZ) - field.heightAt(x, z - field.spacingZ)) / (2 * field.spacingZ);
  const inverse = 1 / Math.hypot(dx, 1, dz);
  out[at] = -dx * inverse;
  out[at + 1] = inverse;
  out[at + 2] = -dz * inverse;
}

/**
 * A 32-bit integer hash of three integers; the same arithmetic the terrain's noise uses, so a
 * placement is bit-identical in Node and in the browser.
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
 * One of four independent fractions drawn from a single hash.
 *
 * @param hash - The cell's hash.
 * @param stream - Which fraction, `0` to `3`.
 * @returns A fraction in `0..1`.
 */
function fractionOf(hash: number, stream: number): number {
  return hash3(hash, stream, 0x9e3779b9) / HASH_SCALE;
}
