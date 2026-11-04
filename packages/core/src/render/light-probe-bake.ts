import { Color } from "../math/color.js";
import { Light } from "./light.js";
import { MeshRenderer } from "./mesh-renderer.js";
import type { LightProbeData } from "./light-probe-asset.js";
import type { ColorLike, Vec3Like } from "../math/types.js";
import type { World } from "../world/world.js";

/**
 * The CPU light-probe bake (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B4): one bounce
 * of diffuse light, needing no device, so it runs headless, in a tool, or in a test.
 *
 * - **Geometry.** Triangles of every enabled `MeshRenderer` whose mesh was built with
 *   `MeshAsset.fromData`, moved to world space. Primitives and glTF models keep their triangles on
 *   the GPU side only and are skipped; {@link LightProbeBakeResult.skipped} counts them.
 * - **Per probe.** `rays` directions on a Fibonacci sphere. A hit returns the surface's albedo (the
 *   material's base or diffuse colour, decoded to linear) times the direct light there, with a
 *   shadow ray per directional, point or spot light and the hemispheric lights unshadowed. A miss
 *   returns `sky` plus the hemispheric lights. Directional, point and spot lights the probe sees are
 *   added exactly, as clamped-cosine lobes. Spot cones are ignored.
 * - **Units.** Lite's: a white surface lit by the result shows `c0 + c1·n.y + c2·n.z + c3·n.x`, so a
 *   uniform sky of radiance `L` bakes to `c0 = L`, and a directional light of intensity `I` to
 *   `c0 = I/4` and a first-order term of `I/2` along its direction.
 */

/** The basis factors: `Y00² · 4π` is 1 and `(2/3) · Y1m² · 4π` is 2, per sample. */
const BAND1_PER_SAMPLE = 2;

/** How far a shadow or bounce ray starts off the surface, in metres. */
const SURFACE_OFFSET = 1e-3;

/** The golden angle, `π·(3 − √5)` radians, for the Fibonacci sphere. */
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * What {@link bakeLightProbes} bakes.
 *
 * @beta
 */
export interface LightProbeBakeOptions {
  /** The world position of probe `(0, 0, 0)`. */
  readonly origin: Vec3Like;
  /** The distance between neighbouring probes along each axis, in metres. */
  readonly cellSize: Vec3Like;
  /** How many probes along X, Y and Z. */
  readonly counts: { readonly x: number; readonly y: number; readonly z: number };
  /** Rays per probe. Defaults to `128`; more is smoother and slower. */
  readonly rays?: number;
  /** How far a ray looks for a surface, in metres. Defaults to `100`. */
  readonly maxDistance?: number;
  /** The linear radiance of rays that hit nothing, before hemispheric lights. Defaults to black. */
  readonly sky?: ColorLike;
}

/**
 * The result of a bake.
 *
 * @beta
 */
export interface LightProbeBakeResult {
  /** The grid, ready for `createLightProbeAsset` or `writeLightProbeFile`. */
  readonly data: LightProbeData;
  /** How many triangles the rays were traced against. */
  readonly triangles: number;
  /** How many enabled mesh renderers were skipped because their triangles are not on the CPU. */
  readonly skipped: number;
}

/** World-space triangles with one albedo per triangle. */
interface TraceScene {
  /** Nine floats per triangle. */
  readonly vertices: Float64Array;
  /** Three floats per triangle, linear RGB. */
  readonly albedo: Float64Array;
  /** The triangle count. */
  readonly count: number;
}

/** A hit: the distance, the unit geometric normal facing the ray, and the triangle. */
interface Hit {
  distance: number;
  nx: number;
  ny: number;
  nz: number;
  triangle: number;
}

/** One light, reduced to what the bake needs. */
type BakeLight =
  | { readonly kind: "directional"; readonly to: readonly [number, number, number]; readonly rgb: readonly number[] }
  | {
      readonly kind: "point";
      readonly at: readonly [number, number, number];
      readonly range: number;
      readonly rgb: readonly number[];
    }
  | {
      readonly kind: "hemispheric";
      readonly up: readonly [number, number, number];
      readonly sky: readonly number[];
      readonly ground: readonly number[];
    };

/**
 * Bakes a light-probe grid from a world's mesh renderers and lights, on the CPU.
 *
 * @remarks
 * One bounce, first-order harmonics, deterministic. Only meshes built with `MeshAsset.fromData`
 * cast and bounce light (see {@link LightProbeBakeResult.skipped}). Cost grows with probes × rays ×
 * triangles; it is meant for small scenes and tools, not for every frame.
 *
 * @param world - The world to bake.
 * @param options - The grid and the quality.
 * @returns The grid and what was traced.
 *
 * @example
 * ```ts
 * const baked = bakeLightProbes(world, {
 *   origin: { x: -4, y: 0.5, z: -4 },
 *   cellSize: { x: 2, y: 2, z: 2 },
 *   counts: { x: 5, y: 2, z: 5 },
 * });
 * world.createEntity("Probes").addComponent(LightProbeVolume, { probes: createLightProbeAsset(app, baked.data) });
 * ```
 *
 * @beta
 */
export function bakeLightProbes(world: World, options: LightProbeBakeOptions): LightProbeBakeResult {
  const { scene, skipped } = collectTriangles(world);
  const lights = collectLights(world);
  const rays = Math.max(1, Math.floor(options.rays ?? 128));
  const maxDistance = options.maxDistance ?? 100;
  const sky = linearRgb(options.sky ?? { r: 0, g: 0, b: 0, a: 1 }, false);
  const { x: nx, y: ny, z: nz } = options.counts;
  const coefficients: number[] = [];
  const hit: Hit = { distance: 0, nx: 0, ny: 0, nz: 0, triangle: -1 };
  const radiance = [0, 0, 0];
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const px = options.origin.x + i * options.cellSize.x;
        const py = options.origin.y + j * options.cellSize.y;
        const pz = options.origin.z + k * options.cellSize.z;
        const sh: number[] = Array.from({ length: 12 }, () => 0);
        for (let ray = 0; ray < rays; ray += 1) {
          const [dx, dy, dz] = fibonacciDirection(ray, rays);
          if (trace(scene, px, py, pz, dx, dy, dz, maxDistance, hit)) {
            shadeHit(
              scene,
              lights,
              hit,
              px + dx * hit.distance,
              py + dy * hit.distance,
              pz + dz * hit.distance,
              radiance,
            );
          } else {
            missRadiance(lights, sky, dx, dy, dz, radiance);
          }
          for (let channel = 0; channel < 3; channel += 1) {
            const value = read(radiance, channel);
            sh[channel] = read(sh, channel) + value / rays;
            sh[3 + channel] = read(sh, 3 + channel) + (BAND1_PER_SAMPLE * value * dy) / rays;
            sh[6 + channel] = read(sh, 6 + channel) + (BAND1_PER_SAMPLE * value * dz) / rays;
            sh[9 + channel] = read(sh, 9 + channel) + (BAND1_PER_SAMPLE * value * dx) / rays;
          }
        }
        addDirectLobes(scene, lights, px, py, pz, sh);
        coefficients.push(...sh);
      }
    }
  }
  return {
    data: {
      origin: { x: options.origin.x, y: options.origin.y, z: options.origin.z },
      cellSize: { x: options.cellSize.x, y: options.cellSize.y, z: options.cellSize.z },
      counts: { x: nx, y: ny, z: nz },
      coefficients,
    },
    triangles: scene.count,
    skipped,
  };
}

/**
 * The `index`-th of `count` evenly spread unit directions.
 *
 * @param index - The direction's index.
 * @param count - How many there are.
 * @returns The direction.
 */
function fibonacciDirection(index: number, count: number): [number, number, number] {
  const y = 1 - (2 * (index + 0.5)) / count;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = GOLDEN_ANGLE * index;
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

/**
 * Gathers the world-space triangles of every enabled mesh renderer with CPU geometry.
 *
 * @param world - The world.
 * @returns The triangles and how many renderers had none.
 */
function collectTriangles(world: World): { scene: TraceScene; skipped: number } {
  const vertices: number[] = [];
  const albedo: number[] = [];
  let skipped = 0;
  for (const renderer of world.components(MeshRenderer)) {
    if (!renderer.isEnabledInHierarchy) {
      continue;
    }
    const handle = renderer.mesh;
    const geometry = handle !== null && handle.state === "loaded" ? handle.value.cpuGeometry : null;
    if (geometry === null) {
      skipped += 1;
      continue;
    }
    const rgb = surfaceAlbedo(renderer);
    const m = renderer.entity.transform.worldMatrix;
    const { positions, indices } = geometry;
    for (let index = 0; index < indices.length; index += 1) {
      const vertex = read(indices, index) * 3;
      const x = read(positions, vertex);
      const y = read(positions, vertex + 1);
      const z = read(positions, vertex + 2);
      vertices.push(
        read(m, 0) * x + read(m, 4) * y + read(m, 8) * z + read(m, 12),
        read(m, 1) * x + read(m, 5) * y + read(m, 9) * z + read(m, 13),
        read(m, 2) * x + read(m, 6) * y + read(m, 10) * z + read(m, 14),
      );
      if (index % 3 === 2) {
        albedo.push(...rgb);
      }
    }
  }
  return {
    scene: { vertices: Float64Array.from(vertices), albedo: Float64Array.from(albedo), count: albedo.length / 3 },
    skipped,
  };
}

/**
 * A renderer's diffuse colour: its first material's base (PBR) or diffuse (Standard) colour.
 *
 * @param renderer - The renderer.
 * @returns Linear RGB; mid grey when the material says nothing usable.
 */
function surfaceAlbedo(renderer: MeshRenderer): number[] {
  const handle = renderer.materials[0] ?? null;
  const definition = handle !== null && handle.state === "loaded" ? handle.value.definition : null;
  if (definition?.kind === "pbr") {
    return linearRgb(definition.baseColor, true).map((channel) => channel * (1 - definition.metallic));
  }
  if (definition?.kind === "standard") {
    return linearRgb(definition.diffuse, true);
  }
  return [0.5, 0.5, 0.5];
}

/**
 * Collects the enabled lights, in linear RGB times intensity.
 *
 * @param world - The world.
 * @returns The lights.
 */
function collectLights(world: World): BakeLight[] {
  const out: BakeLight[] = [];
  for (const light of world.components(Light)) {
    if (!light.isEnabledInHierarchy || light.intensity <= 0) {
      continue;
    }
    const rgb = linearRgb(light.color, true).map((channel) => channel * light.intensity);
    const transform = light.entity.transform;
    if (light.type === "directional") {
      const forward = transform.forward;
      out.push({ kind: "directional", to: [-forward.x, -forward.y, -forward.z], rgb });
    } else if (light.type === "hemispheric") {
      const up = transform.up;
      const ground = linearRgb(light.groundColor, true).map((channel) => channel * light.intensity);
      out.push({ kind: "hemispheric", up: [up.x, up.y, up.z], sky: rgb, ground });
    } else {
      const at = transform.position;
      out.push({ kind: "point", at: [at.x, at.y, at.z], range: light.range, rgb });
    }
  }
  return out;
}

/**
 * The radiance a surface hit sends back: albedo times the direct light there.
 *
 * @param scene - The triangles.
 * @param lights - The lights.
 * @param hit - The hit.
 * @param x - The hit's world X.
 * @param y - The hit's world Y.
 * @param z - The hit's world Z.
 * @param out - Receives linear RGB.
 */
function shadeHit(
  scene: TraceScene,
  lights: readonly BakeLight[],
  hit: Hit,
  x: number,
  y: number,
  z: number,
  out: number[],
): void {
  out.fill(0);
  const ox = x + hit.nx * SURFACE_OFFSET;
  const oy = y + hit.ny * SURFACE_OFFSET;
  const oz = z + hit.nz * SURFACE_OFFSET;
  const shadow: Hit = { distance: 0, nx: 0, ny: 0, nz: 0, triangle: -1 };
  for (const light of lights) {
    if (light.kind === "hemispheric") {
      const t = 0.5 + 0.5 * (hit.nx * light.up[0] + hit.ny * light.up[1] + hit.nz * light.up[2]);
      for (let channel = 0; channel < 3; channel += 1) {
        out[channel] = read(out, channel) + read(light.ground, channel) * (1 - t) + read(light.sky, channel) * t;
      }
      continue;
    }
    const toward = towardLight(light, ox, oy, oz);
    if (toward === null) {
      continue;
    }
    const [lx, ly, lz, distance, falloff] = toward;
    const cosine = hit.nx * lx + hit.ny * ly + hit.nz * lz;
    if (cosine <= 0 || trace(scene, ox, oy, oz, lx, ly, lz, distance, shadow)) {
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      out[channel] = read(out, channel) + read(light.rgb, channel) * cosine * falloff;
    }
  }
  const base = hit.triangle * 3;
  for (let channel = 0; channel < 3; channel += 1) {
    out[channel] = read(out, channel) * read(scene.albedo, base + channel);
  }
}

/**
 * The radiance of a ray that hit nothing: the sky and the hemispheric lights.
 *
 * @param lights - The lights.
 * @param sky - The sky's linear RGB.
 * @param dx - The ray's X.
 * @param dy - The ray's Y.
 * @param dz - The ray's Z.
 * @param out - Receives linear RGB.
 */
function missRadiance(
  lights: readonly BakeLight[],
  sky: readonly number[],
  dx: number,
  dy: number,
  dz: number,
  out: number[],
): void {
  for (let channel = 0; channel < 3; channel += 1) {
    out[channel] = read(sky, channel);
  }
  for (const light of lights) {
    if (light.kind === "hemispheric") {
      const above = dx * light.up[0] + dy * light.up[1] + dz * light.up[2] >= 0;
      for (let channel = 0; channel < 3; channel += 1) {
        out[channel] = read(out, channel) + read(above ? light.sky : light.ground, channel);
      }
    }
  }
}

/**
 * Adds the directional, point and spot lights a probe sees as clamped-cosine lobes.
 *
 * @param scene - The triangles.
 * @param lights - The lights.
 * @param x - The probe's X.
 * @param y - The probe's Y.
 * @param z - The probe's Z.
 * @param sh - The probe's 12 coefficients, added to.
 */
function addDirectLobes(
  scene: TraceScene,
  lights: readonly BakeLight[],
  x: number,
  y: number,
  z: number,
  sh: number[],
): void {
  const shadow: Hit = { distance: 0, nx: 0, ny: 0, nz: 0, triangle: -1 };
  for (const light of lights) {
    if (light.kind === "hemispheric") {
      continue;
    }
    const toward = towardLight(light, x, y, z);
    if (toward === null) {
      continue;
    }
    const [lx, ly, lz, distance, falloff] = toward;
    if (trace(scene, x, y, z, lx, ly, lz, distance, shadow)) {
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const energy = read(light.rgb, channel) * falloff;
      sh[channel] = read(sh, channel) + energy / 4;
      sh[3 + channel] = read(sh, 3 + channel) + (energy / 2) * ly;
      sh[6 + channel] = read(sh, 6 + channel) + (energy / 2) * lz;
      sh[9 + channel] = read(sh, 9 + channel) + (energy / 2) * lx;
    }
  }
}

/**
 * The unit direction to a light, how far it is, and its distance falloff.
 *
 * @param light - A directional or point light.
 * @param x - The point's X.
 * @param y - The point's Y.
 * @param z - The point's Z.
 * @returns `[dx, dy, dz, distance, falloff]`, or `null` beyond a point light's range or at its centre.
 */
function towardLight(
  light: Exclude<BakeLight, { kind: "hemispheric" }>,
  x: number,
  y: number,
  z: number,
): [number, number, number, number, number] | null {
  if (light.kind === "directional") {
    return [light.to[0], light.to[1], light.to[2], Number.POSITIVE_INFINITY, 1];
  }
  const dx = light.at[0] - x;
  const dy = light.at[1] - y;
  const dz = light.at[2] - z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6 || (light.range > 0 && distance > light.range)) {
    return null;
  }
  return [dx / distance, dy / distance, dz / distance, distance, 1 / (distance * distance)];
}

/**
 * Finds the nearest triangle a ray hits (Möller–Trumbore, both faces).
 *
 * @param scene - The triangles.
 * @param ox - The ray origin's X.
 * @param oy - The ray origin's Y.
 * @param oz - The ray origin's Z.
 * @param dx - The unit direction's X.
 * @param dy - The unit direction's Y.
 * @param dz - The unit direction's Z.
 * @param maxDistance - How far to look.
 * @param out - Receives the hit, its normal turned to face the ray.
 * @returns Whether anything was hit.
 */
function trace(
  scene: TraceScene,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  out: Hit,
): boolean {
  const v = scene.vertices;
  let nearest = maxDistance;
  let found = -1;
  for (let triangle = 0; triangle < scene.count; triangle += 1) {
    const b = triangle * 9;
    const ax = read(v, b);
    const ay = read(v, b + 1);
    const az = read(v, b + 2);
    const e1x = read(v, b + 3) - ax;
    const e1y = read(v, b + 4) - ay;
    const e1z = read(v, b + 5) - az;
    const e2x = read(v, b + 6) - ax;
    const e2y = read(v, b + 7) - ay;
    const e2z = read(v, b + 8) - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) {
      continue;
    }
    const inv = 1 / det;
    const tx = ox - ax;
    const ty = oy - ay;
    const tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) {
      continue;
    }
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const w = (dx * qx + dy * qy + dz * qz) * inv;
    if (w < 0 || u + w > 1) {
      continue;
    }
    const distance = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (distance > 1e-6 && distance < nearest) {
      nearest = distance;
      found = triangle;
    }
  }
  if (found < 0) {
    return false;
  }
  const b = found * 9;
  const e1x = read(v, b + 3) - read(v, b);
  const e1y = read(v, b + 4) - read(v, b + 1);
  const e1z = read(v, b + 5) - read(v, b + 2);
  const e2x = read(v, b + 6) - read(v, b);
  const e2y = read(v, b + 7) - read(v, b + 1);
  const e2z = read(v, b + 8) - read(v, b + 2);
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const length = Math.hypot(nx, ny, nz) || 1;
  const facing = nx * dx + ny * dy + nz * dz > 0 ? -1 : 1;
  nx = (nx / length) * facing;
  ny = (ny / length) * facing;
  nz = (nz / length) * facing;
  out.distance = nearest;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  out.triangle = found;
  return true;
}

/**
 * A colour as three linear channels.
 *
 * @param colour - The colour.
 * @param isSrgb - Whether it is stored sRGB-encoded.
 * @returns Linear RGB.
 */
function linearRgb(colour: ColorLike, isSrgb: boolean): number[] {
  const decode = (channel: number): number => (isSrgb ? Color.srgbToLinear(channel) : channel);
  return [decode(colour.r), decode(colour.g), decode(colour.b)];
}

/**
 * Reads one number of an array, `0` past its end.
 *
 * @param values - The array.
 * @param index - The index.
 * @returns The number.
 */
function read(values: ArrayLike<number>, index: number): number {
  return values[index] ?? 0;
}
