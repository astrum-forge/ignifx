import { Vec3 } from "@ignifx/core";
import { TerrainErrorCode, terrainError } from "../errors.js";
import type { TerrainSize } from "../definition/types.js";
import type { MutableVec3, Ray } from "@ignifx/core";

/**
 * `HeightField`: the CPU height grid every terrain query reads
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.3).
 *
 * The field is stated in the terrain's **local** frame and centred on the entity's origin: X spans
 * `-width/2 .. +width/2`, Z spans `-depth/2 .. +depth/2`, heights run `0 .. height`. World-space
 * queries belong to the `Terrain` component, which owns the transform.
 */

/**
 * A rectangle of samples: the region a sculpt edits, a collider covers, or a chunk rebuild touches.
 *
 * @public
 */
export interface TerrainRegion {
  /** The first sample column. */
  readonly x: number;
  /** The first sample row. */
  readonly z: number;
  /** How many columns. */
  readonly width: number;
  /** How many rows. */
  readonly depth: number;
}

/**
 * What {@link HeightField.raycast} writes: the hit point, the surface normal there, and how far
 * along the ray it was. Build one with {@link createTerrainHit} and reuse it.
 *
 * @public
 */
export interface TerrainHit {
  /** The hit point, in the frame the ray was stated in. */
  readonly point: MutableVec3;
  /** The unit surface normal at the hit. */
  readonly normal: MutableVec3;
  /** The distance from the ray's origin to the hit, in metres. */
  distance: number;
}

/**
 * Creates a reusable {@link TerrainHit}.
 *
 * @returns A fresh hit record. **Allocates** — make one per call site, not per frame.
 *
 * @public
 */
export function createTerrainHit(): TerrainHit {
  return { point: new Vec3(), normal: new Vec3(0, 1, 0), distance: 0 };
}

/** The most steps a raycast takes before giving up, whatever the field's size. */
const MAX_RAYCAST_STEPS = 4096;

/** How many halvings refine a crossing once the march has bracketed it. */
const RAYCAST_REFINEMENTS = 8;

/** The largest sample value a `.r16` can hold. */
const MAX_SAMPLE_16 = 65_535;

/**
 * A regular grid of heights and the queries over it.
 *
 * @example
 * ```ts
 * const field = HeightField.fromNormalised(65, { width: 64, depth: 64, height: 10 }, values);
 * field.heightAt(3.5, -2); // metres, bilinear
 * ```
 *
 * @public
 */
export class HeightField {
  /** Samples per side. */
  readonly resolution: number;

  /** The extent along X, in metres. */
  readonly width: number;

  /** The extent along Z, in metres. */
  readonly depth: number;

  /** The height a full-scale sample reaches, in metres. */
  readonly height: number;

  /** Metres between neighbouring samples along X. */
  readonly spacingX: number;

  /** Metres between neighbouring samples along Z. */
  readonly spacingZ: number;

  /**
   * The heights, in metres, row-major: `heights[iz * resolution + ix]`. Mutating it directly is
   * allowed for bulk generation; go through {@link HeightField.setHeights} when something has to be
   * told, because a `Terrain` rebuilds only the chunks that method names.
   */
  readonly heights: Float32Array;

  readonly #scratch: MutableVec3 = new Vec3();

  /**
   * Wraps a height array.
   *
   * @param resolution - Samples per side.
   * @param size - The extent, in metres.
   * @param heights - `resolution * resolution` heights in metres, or omitted for a flat field.
   * @throws IgnifxError with code `IGX-1608` when `heights` has the wrong length.
   */
  constructor(resolution: number, size: TerrainSize, heights?: Float32Array) {
    const expected = resolution * resolution;
    if (heights !== undefined && heights.length !== expected) {
      throw terrainError(
        TerrainErrorCode.heightmapSizeMismatch,
        `A ${String(resolution)}x${String(resolution)} field needs ${String(expected)} heights, not ${String(heights.length)}.`,
        { context: { file: "<memory>", actual: heights.length, expected } },
      );
    }
    this.resolution = resolution;
    this.width = size.width;
    this.depth = size.depth;
    this.height = size.height;
    this.spacingX = size.width / (resolution - 1);
    this.spacingZ = size.depth / (resolution - 1);
    this.heights = heights ?? new Float32Array(expected);
  }

  /**
   * Builds a field from 16-bit samples, `0..65535` mapped onto `0..size.height`.
   *
   * @param resolution - Samples per side.
   * @param size - The extent, in metres.
   * @param samples - `resolution * resolution` samples, row-major.
   * @returns The field.
   * @throws IgnifxError with code `IGX-1608` when the sample count does not match.
   */
  static fromSamples16(resolution: number, size: TerrainSize, samples: Uint16Array): HeightField {
    const field = new HeightField(resolution, size);
    if (samples.length !== field.heights.length) {
      throw terrainError(
        TerrainErrorCode.heightmapSizeMismatch,
        `A ${String(resolution)}x${String(resolution)} field needs ${String(field.heights.length)} samples, not ${String(samples.length)}.`,
        { context: { file: "<memory>", actual: samples.length, expected: field.heights.length } },
      );
    }
    const scale = size.height / MAX_SAMPLE_16;
    const heights = field.heights;
    for (let index = 0; index < samples.length; index += 1) {
      heights[index] = (samples[index] ?? 0) * scale;
    }
    return field;
  }

  /**
   * Builds a field from normalised values, `0..1` mapped onto `0..size.height`.
   *
   * @param resolution - Samples per side.
   * @param size - The extent, in metres.
   * @param values - `resolution * resolution` values, row-major.
   * @returns The field.
   * @throws IgnifxError with code `IGX-1608` when the value count does not match.
   */
  static fromNormalised(resolution: number, size: TerrainSize, values: Float32Array): HeightField {
    const field = new HeightField(resolution, size);
    if (values.length !== field.heights.length) {
      throw terrainError(
        TerrainErrorCode.heightmapSizeMismatch,
        `A ${String(resolution)}x${String(resolution)} field needs ${String(field.heights.length)} values, not ${String(values.length)}.`,
        { context: { file: "<memory>", actual: values.length, expected: field.heights.length } },
      );
    }
    const heights = field.heights;
    for (let index = 0; index < values.length; index += 1) {
      heights[index] = (values[index] ?? 0) * size.height;
    }
    return field;
  }

  /**
   * One sample, with the indices clamped to the grid.
   *
   * @param ix - The column.
   * @param iz - The row.
   * @returns The height in metres.
   */
  sample(ix: number, iz: number): number {
    const last = this.resolution - 1;
    const cx = ix < 0 ? 0 : ix > last ? last : ix;
    const cz = iz < 0 ? 0 : iz > last ? last : iz;
    return this.heights[cz * this.resolution + cx] ?? 0;
  }

  /**
   * The local X of a sample column.
   *
   * @param ix - The column.
   * @returns Metres along X.
   */
  sampleToLocalX(ix: number): number {
    return -this.width / 2 + ix * this.spacingX;
  }

  /**
   * The local Z of a sample row.
   *
   * @param iz - The row.
   * @returns Metres along Z.
   */
  sampleToLocalZ(iz: number): number {
    return -this.depth / 2 + iz * this.spacingZ;
  }

  /**
   * The fractional sample column of a local X.
   *
   * @param x - Metres along X.
   * @returns The column, unclamped.
   */
  localToSampleX(x: number): number {
    return (x + this.width / 2) / this.spacingX;
  }

  /**
   * The fractional sample row of a local Z.
   *
   * @param z - Metres along Z.
   * @returns The row, unclamped.
   */
  localToSampleZ(z: number): number {
    return (z + this.depth / 2) / this.spacingZ;
  }

  /**
   * The height under a local point, bilinearly interpolated; points outside the field read the
   * nearest edge.
   *
   * @param x - Metres along X.
   * @param z - Metres along Z.
   * @returns The height in metres.
   */
  heightAt(x: number, z: number): number {
    const last = this.resolution - 1;
    let fx = this.localToSampleX(x);
    let fz = this.localToSampleZ(z);
    fx = fx < 0 ? 0 : fx > last ? last : fx;
    fz = fz < 0 ? 0 : fz > last ? last : fz;
    let ix = Math.floor(fx);
    let iz = Math.floor(fz);
    ix = ix > last - 1 ? last - 1 : ix;
    iz = iz > last - 1 ? last - 1 : iz;
    const tx = fx - ix;
    const tz = fz - iz;
    const row = iz * this.resolution;
    const h00 = this.heights[row + ix] ?? 0;
    const h10 = this.heights[row + ix + 1] ?? 0;
    const h01 = this.heights[row + this.resolution + ix] ?? 0;
    const h11 = this.heights[row + this.resolution + ix + 1] ?? 0;
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * tz;
  }

  /**
   * The unit surface normal under a local point, from central differences one sample apart.
   *
   * @param x - Metres along X.
   * @param z - Metres along Z.
   * @param out - Receives the normal.
   * @returns `out`, for chaining.
   */
  normalAt(x: number, z: number, out: MutableVec3): MutableVec3 {
    const dx = (this.heightAt(x + this.spacingX, z) - this.heightAt(x - this.spacingX, z)) / (2 * this.spacingX);
    const dz = (this.heightAt(x, z + this.spacingZ) - this.heightAt(x, z - this.spacingZ)) / (2 * this.spacingZ);
    return writeNormal(dx, dz, out);
  }

  /**
   * The unit surface normal at a sample, from central differences of its neighbours. What the chunk
   * builder reads at every LOD, so coarse and fine meshes shade the same.
   *
   * @param ix - The column.
   * @param iz - The row.
   * @param out - Receives the normal.
   * @returns `out`, for chaining.
   */
  sampleNormal(ix: number, iz: number, out: MutableVec3): MutableVec3 {
    const dx = (this.sample(ix + 1, iz) - this.sample(ix - 1, iz)) / (2 * this.spacingX);
    const dz = (this.sample(ix, iz + 1) - this.sample(ix, iz - 1)) / (2 * this.spacingZ);
    return writeNormal(dx, dz, out);
  }

  /**
   * The slope under a local point, in degrees from horizontal.
   *
   * @param x - Metres along X.
   * @param z - Metres along Z.
   * @returns The slope, `0` flat, `90` vertical.
   */
  slopeAt(x: number, z: number): number {
    const normal = this.normalAt(x, z, this.#scratch);
    const cosine = normal.y > 1 ? 1 : normal.y < -1 ? -1 : normal.y;
    return (Math.acos(cosine) * 180) / Math.PI;
  }

  /**
   * Overwrites a rectangle of samples.
   *
   * @param x - The first column.
   * @param z - The first row.
   * @param width - How many columns.
   * @param depth - How many rows.
   * @param heights - `width * depth` heights in metres, row-major.
   * @throws IgnifxError with code `IGX-1610` when the rectangle falls outside the field or `heights`
   * is too short.
   */
  setHeights(x: number, z: number, width: number, depth: number, heights: Float32Array): void {
    this.assertRegion(x, z, width, depth);
    if (heights.length < width * depth) {
      throw terrainError(
        TerrainErrorCode.regionOutOfRange,
        `setHeights was given ${String(heights.length)} heights for a ${String(width)}x${String(depth)} region.`,
        { context: { x, z, width, depth, resolution: this.resolution } },
      );
    }
    const target = this.heights;
    for (let row = 0; row < depth; row += 1) {
      const from = row * width;
      const to = (z + row) * this.resolution + x;
      for (let column = 0; column < width; column += 1) {
        target[to + column] = heights[from + column] ?? 0;
      }
    }
  }

  /**
   * The lowest and highest sample inside a rectangle.
   *
   * @param x - The first column.
   * @param z - The first row.
   * @param width - How many columns.
   * @param depth - How many rows.
   * @param out - Receives `[min, max]`.
   * @returns `out`, for chaining.
   */
  minMax(x: number, z: number, width: number, depth: number, out: Float32Array): Float32Array {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const last = this.resolution - 1;
    const x1 = Math.min(last, x + width - 1);
    const z1 = Math.min(last, z + depth - 1);
    for (let iz = Math.max(0, z); iz <= z1; iz += 1) {
      const row = iz * this.resolution;
      for (let ix = Math.max(0, x); ix <= x1; ix += 1) {
        const h = this.heights[row + ix] ?? 0;
        min = h < min ? h : min;
        max = h > max ? h : max;
      }
    }
    out[0] = min === Number.POSITIVE_INFINITY ? 0 : min;
    out[1] = max === Number.NEGATIVE_INFINITY ? 0 : max;
    return out;
  }

  /**
   * Marches a ray across the field and reports where it first crosses the surface.
   *
   * @remarks
   * The ray is clipped to the field's bounding box first, then stepped at half a sample spacing;
   * once a step finds the ray below the surface the crossing is bisected. The ray and the hit are in
   * the field's local frame.
   *
   * @param ray - The ray, in local metres.
   * @param out - Receives the hit.
   * @returns `true` when the ray hit the surface within `ray.length`.
   */
  raycast(ray: Ray, out: TerrainHit): boolean {
    const dir = ray.direction;
    const length = Math.hypot(dir.x, dir.y, dir.z);
    if (length === 0) {
      return false;
    }
    const dx = dir.x / length;
    const dy = dir.y / length;
    const dz = dir.z / length;
    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const range = this.minMax(0, 0, this.resolution, this.resolution, this.#range);
    // Clip to the box the field occupies, so the march starts where a hit is possible.
    let tMin = 0;
    let tMax = ray.length;
    const slabs = [
      [-this.width / 2, this.width / 2, ox, dx],
      [range[0] ?? 0, range[1] ?? 0, oy, dy],
      [-this.depth / 2, this.depth / 2, oz, dz],
    ] as const;
    for (let axis = 0; axis < slabs.length; axis += 1) {
      const slab = slabs[axis];
      if (slab === undefined) {
        continue;
      }
      const [low, high, origin, direction] = slab;
      if (Math.abs(direction) < 1e-12) {
        if (origin < low || origin > high) {
          return false;
        }
        continue;
      }
      let t0 = (low - origin) / direction;
      let t1 = (high - origin) / direction;
      if (t0 > t1) {
        const swap = t0;
        t0 = t1;
        t1 = swap;
      }
      tMin = t0 > tMin ? t0 : tMin;
      tMax = t1 < tMax ? t1 : tMax;
      if (tMin > tMax) {
        return false;
      }
    }
    const step = Math.min(this.spacingX, this.spacingZ) * 0.5;
    const steps = Math.min(MAX_RAYCAST_STEPS, Math.ceil((tMax - tMin) / step) + 1);
    let previousT = tMin;
    let previousAbove = oy + dy * tMin - this.heightAt(ox + dx * tMin, oz + dz * tMin);
    if (previousAbove <= 0) {
      // Starting below the surface counts as an immediate hit, as a physics query would.
      return this.#writeHit(ox, oy, oz, dx, dy, dz, tMin, out);
    }
    for (let index = 1; index <= steps; index += 1) {
      const t = index === steps ? tMax : tMin + index * step;
      const above = oy + dy * t - this.heightAt(ox + dx * t, oz + dz * t);
      if (above <= 0) {
        let low = previousT;
        let high = t;
        for (let refine = 0; refine < RAYCAST_REFINEMENTS; refine += 1) {
          const mid = (low + high) * 0.5;
          const midAbove = oy + dy * mid - this.heightAt(ox + dx * mid, oz + dz * mid);
          if (midAbove <= 0) {
            high = mid;
          } else {
            low = mid;
          }
        }
        return this.#writeHit(ox, oy, oz, dx, dy, dz, high, out);
      }
      previousT = t;
      previousAbove = above;
    }
    return previousAbove <= 0;
  }

  readonly #range = new Float32Array(2);

  /**
   * Refuses a rectangle that does not lie inside the field.
   *
   * @param x - The first column.
   * @param z - The first row.
   * @param width - How many columns.
   * @param depth - How many rows.
   * @throws IgnifxError with code `IGX-1610`.
   */
  assertRegion(x: number, z: number, width: number, depth: number): void {
    const inside =
      Number.isInteger(x) &&
      Number.isInteger(z) &&
      Number.isInteger(width) &&
      Number.isInteger(depth) &&
      x >= 0 &&
      z >= 0 &&
      width >= 1 &&
      depth >= 1 &&
      x + width <= this.resolution &&
      z + depth <= this.resolution;
    if (!inside) {
      throw terrainError(
        TerrainErrorCode.regionOutOfRange,
        `The region ${String(x)},${String(z)} ${String(width)}x${String(depth)} falls outside a ${String(this.resolution)}x${String(this.resolution)} field.`,
        {
          context: { x, z, width, depth, resolution: this.resolution },
          hint: "Regions are whole sample rectangles inside 0..resolution on both axes.",
        },
      );
    }
  }

  /**
   * Writes a hit at `t` along the ray.
   *
   * @param ox - The origin X.
   * @param oy - The origin Y.
   * @param oz - The origin Z.
   * @param dx - The unit direction X.
   * @param dy - The unit direction Y.
   * @param dz - The unit direction Z.
   * @param t - The distance along the ray.
   * @param out - The hit to fill.
   * @returns `true`.
   */
  #writeHit(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    t: number,
    out: TerrainHit,
  ): boolean {
    const x = ox + dx * t;
    const z = oz + dz * t;
    out.point.set(x, oy + dy * t, z);
    this.normalAt(x, z, out.normal);
    out.distance = t;
    return true;
  }
}

/**
 * Writes the unit normal of a surface whose slopes along X and Z are `dx` and `dz`.
 *
 * @param dx - The height's derivative along X.
 * @param dz - The height's derivative along Z.
 * @param out - Receives the normal.
 * @returns `out`.
 */
function writeNormal(dx: number, dz: number, out: MutableVec3): MutableVec3 {
  const inverse = 1 / Math.hypot(dx, 1, dz);
  out.x = -dx * inverse;
  out.y = inverse;
  out.z = -dz * inverse;
  return out;
}
