import type { TerrainLayerDefinition, TerrainSplatRule } from "../definition/types.js";
import type { HeightField } from "../heightfield/height-field.js";

/**
 * Control maps: where each layer of the splat appears
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.1–5.2).
 *
 * A control map is an RGBA8 image with one texel per quad of the field, its channels the weights of
 * four layers; layers 5–8 live in a second map. Generated weights feather each height and slope
 * band by a tenth of its width so layers blend rather than step, and a texel no rule reaches falls
 * to the first layer, so a terrain is never unpainted.
 */

/**
 * How many layers one RGBA map carries.
 *
 * @public
 */
export const LAYERS_PER_CONTROL_MAP = 4;

/** Bytes per texel. */
const BYTES_PER_TEXEL = 4;

/** The smallest feather a height band gets, in metres. */
const MIN_HEIGHT_FEATHER = 0.5;

/** The smallest feather a slope band gets, in degrees. */
const MIN_SLOPE_FEATHER = 2;

/** The fraction of a band's width that becomes its feather. */
const FEATHER_FRACTION = 0.1;

/**
 * The control maps of a terrain, on the CPU.
 *
 * @public
 */
export interface ControlMaps {
  /** Texels per side: `resolution - 1`. */
  readonly size: number;
  /** One RGBA8 image per four layers, `size * size * 4` bytes each. */
  readonly maps: readonly Uint8Array[];
}

/**
 * How many control maps a layer count needs.
 *
 * @param layerCount - The terrain's layer count.
 * @returns One per four layers.
 *
 * @public
 */
export function controlMapCount(layerCount: number): number {
  return Math.max(1, Math.ceil(layerCount / LAYERS_PER_CONTROL_MAP));
}

/**
 * Control maps that paint the first layer everywhere: the fallback for a terrain with neither
 * painted maps nor rules.
 *
 * @param size - Texels per side.
 * @param layerCount - The terrain's layer count.
 * @returns The maps.
 *
 * @public
 */
export function solidControlMaps(size: number, layerCount: number): ControlMaps {
  const maps: Uint8Array[] = [];
  for (let index = 0; index < controlMapCount(layerCount); index += 1) {
    maps.push(new Uint8Array(size * size * BYTES_PER_TEXEL));
  }
  const first = maps[0];
  if (first !== undefined) {
    for (let texel = 0; texel < size * size; texel += 1) {
      first[texel * BYTES_PER_TEXEL] = 255;
    }
  }
  return { size, maps };
}

/**
 * Generates control maps from splat rules.
 *
 * @param field - The height field the rules read heights and slopes from.
 * @param layers - The terrain's layers, in channel order.
 * @param rules - The rules; each names a declared layer.
 * @returns The maps, `resolution - 1` texels per side.
 *
 * @example
 * ```ts
 * const maps = generateControlMaps(field, layers, [
 *   { layer: "grass", height: null, slope: null },
 *   { layer: "rock", height: null, slope: [35, 90] },
 * ]);
 * ```
 *
 * @public
 */
export function generateControlMaps(
  field: HeightField,
  layers: readonly TerrainLayerDefinition[],
  rules: readonly TerrainSplatRule[],
): ControlMaps {
  const size = field.resolution - 1;
  const maps = solidControlMaps(size, layers.length).maps.map((map) => {
    map.fill(0);
    return map;
  });
  const layerIndex = new Map<string, number>();
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer !== undefined) {
      layerIndex.set(layer.name, index);
    }
  }
  const weights = new Float32Array(layers.length);
  const bytes = new Uint8Array(layers.length);
  for (let cz = 0; cz < size; cz += 1) {
    const z = field.sampleToLocalZ(cz + 0.5);
    for (let cx = 0; cx < size; cx += 1) {
      const x = field.sampleToLocalX(cx + 0.5);
      const height = field.heightAt(x, z);
      const slope = field.slopeAt(x, z);
      weights.fill(0);
      for (let index = 0; index < rules.length; index += 1) {
        const rule = rules[index];
        const layer = rule === undefined ? undefined : layerIndex.get(rule.layer);
        if (rule === undefined || layer === undefined) {
          continue;
        }
        const weight =
          bandWeight(height, rule.height, MIN_HEIGHT_FEATHER) * bandWeight(slope, rule.slope, MIN_SLOPE_FEATHER);
        if (weight > (weights[layer] ?? 0)) {
          weights[layer] = weight;
        }
      }
      normaliseWeights(weights, bytes);
      const texel = cz * size + cx;
      for (let layer = 0; layer < layers.length; layer += 1) {
        const map = maps[Math.floor(layer / LAYERS_PER_CONTROL_MAP)];
        if (map !== undefined) {
          map[texel * BYTES_PER_TEXEL + (layer % LAYERS_PER_CONTROL_MAP)] = bytes[layer] ?? 0;
        }
      }
    }
  }
  return { size, maps };
}

/**
 * The weight of a layer at a point, bilinearly filtered from its control map, in `0..1`.
 *
 * @param control - The control maps.
 * @param layer - The layer index.
 * @param u - The terrain-wide coordinate along X, `0..1`.
 * @param v - The terrain-wide coordinate along Z, `0..1`.
 * @returns The weight.
 *
 * @public
 */
export function sampleControlWeight(control: ControlMaps, layer: number, u: number, v: number): number {
  const map = control.maps[Math.floor(layer / LAYERS_PER_CONTROL_MAP)];
  if (map === undefined) {
    return 0;
  }
  const channel = layer % LAYERS_PER_CONTROL_MAP;
  const size = control.size;
  // Texel centres sit at (i + 0.5) / size, like the GPU's linear filter.
  const fx = clamp(u * size - 0.5, 0, size - 1);
  const fz = clamp(v * size - 0.5, 0, size - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(size - 1, x0 + 1);
  const z1 = Math.min(size - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const read = (x: number, z: number): number => (map[(z * size + x) * BYTES_PER_TEXEL + channel] ?? 0) / 255;
  const top = read(x0, z0) + (read(x1, z0) - read(x0, z0)) * tx;
  const bottom = read(x0, z1) + (read(x1, z1) - read(x0, z1)) * tx;
  return top + (bottom - top) * tz;
}

/**
 * The weight of a value inside a band with feathered edges; `1` everywhere for no band.
 *
 * @param value - The height or slope.
 * @param band - The `[min, max]` band, or `null`.
 * @param minFeather - The smallest feather width.
 * @returns A weight in `0..1`.
 */
function bandWeight(value: number, band: readonly [number, number] | null, minFeather: number): number {
  if (band === null) {
    return 1;
  }
  const [min, max] = band;
  const feather = Math.max(minFeather, (max - min) * FEATHER_FRACTION);
  const rise = smoothstep(min - feather, min + feather, value);
  const fall = 1 - smoothstep(max - feather, max + feather, value);
  return rise * fall;
}

/**
 * Hermite smoothstep.
 *
 * @param edge0 - Where the ramp starts.
 * @param edge1 - Where it ends.
 * @param value - The input.
 * @returns `0` below `edge0`, `1` above `edge1`, smooth between.
 */
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) {
    return value >= edge1 ? 1 : 0;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Normalises weights so their bytes sum to exactly 255, giving the remainder to the largest.
 *
 * @param weights - The raw weights; all zero falls back to the first layer.
 * @param out - Receives one byte per layer.
 */
function normaliseWeights(weights: Float32Array, out: Uint8Array): void {
  let total = 0;
  for (let index = 0; index < weights.length; index += 1) {
    total += weights[index] ?? 0;
  }
  if (total <= 0) {
    out.fill(0);
    out[0] = 255;
    return;
  }
  let sum = 0;
  let largest = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const byte = Math.floor(((weights[index] ?? 0) / total) * 255);
    out[index] = byte;
    sum += byte;
    if ((weights[index] ?? 0) > (weights[largest] ?? 0)) {
      largest = index;
    }
  }
  out[largest] = (out[largest] ?? 0) + (255 - sum);
}

/**
 * Clamps a number.
 *
 * @param value - The input.
 * @param min - The low end.
 * @param max - The high end.
 * @returns The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
