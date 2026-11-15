import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { Color } from "../math/color.js";
import { createPerformanceClock } from "../time/clock.js";
import { readLightProbeGrid } from "./light-probe-asset.js";
import { readGltfTriangles } from "./light-probe-bake-gltf.js";
import { primitiveTriangles } from "./light-probe-bake-primitives.js";
import { Light } from "./light.js";
import { MeshRenderer } from "./mesh-renderer.js";
import { Model } from "./model.js";
import type { LightProbeData, LightProbeGrid } from "./light-probe-asset.js";
import type { GltfBakeGeometry } from "./light-probe-bake-gltf.js";
import type { LightBakeMode } from "./light.js";
import type { MaterialAsset } from "./material-asset.js";
import type { MeshPrimitiveDefinition } from "./mesh-asset.js";
import type { ModelAsset } from "./model-asset.js";
import type { AssetHandle } from "../assets/types.js";
import type { Entity } from "../entity/entity.js";
import type { ColorLike, Vec3Like } from "../math/types.js";
import type { World } from "../world/world.js";

/**
 * The CPU light-probe bake (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B4): one bounce
 * of diffuse light, needing no device, so it runs headless, in a tool, or in a test.
 *
 * - **Geometry.** Triangles of every enabled `MeshRenderer` (a `MeshAsset.fromData` mesh's own
 *   arrays, or a primitive rebuilt on the CPU by `light-probe-bake-primitives.ts`) and every enabled
 *   `Model` whose glTF a headless app loaded (`light-probe-bake-gltf.ts`), moved to world space. What
 *   cannot be read is listed in {@link LightProbeBakeResult.skips}. Each mesh keeps a world bounding
 *   box, so a ray tests the triangles of the meshes it passes through only.
 * - **Per probe.** `rays` directions on a Fibonacci sphere. A hit returns the surface's albedo (the
 *   material's base or diffuse colour, decoded to linear) times the direct light there, with a
 *   shadow ray per directional, point or spot light and the hemispheric lights unshadowed: every
 *   light bounces. A miss returns the sky. The light a probe receives straight from a light is
 *   added only for a light whose rule says so ({@link lightBakeTerms}): a `"baked"` light always, a
 *   `"mixed"` light never, a `"realtime"` light only with `directLight: "include"` — a hemispheric
 *   light as part of what a miss sees, the others exactly, as clamped-cosine lobes. Spot cones are
 *   ignored.
 * - **Units.** Lite's: a white surface lit by the result shows `c0 + c1·n.y + c2·n.z + c3·n.x`, so a
 *   uniform sky of radiance `L` bakes to `c0 = L`, and an included directional light of intensity
 *   `I` to `c0 = I/4` and a first-order term of `I/2` along its direction.
 */

/** The basis factors: `Y00² · 4π` is 1 and `(2/3) · Y1m² · 4π` is 2, per sample. */
const BAND1_PER_SAMPLE = 2;

/** How far a shadow or bounce ray starts off the surface, in metres. */
const SURFACE_OFFSET = 1e-3;

/** The golden angle, `π·(3 − √5)` radians, for the Fibonacci sphere. */
const GOLDEN_ANGLE = 2.399963229728653;

/** The most rays one probe may trace. */
const MAX_RAYS = 4096;

/** How long the bake works before it yields to the host, in milliseconds (half a 60 Hz frame). */
const YIELD_BUDGET_MS = 8;

/** The checked options a bake runs with. */
interface BakeSettings {
  readonly grid: LightProbeGrid;
  readonly rays: number;
  readonly maxDistance: number;
  readonly sky: SkyRadiance;
  readonly includeDirect: boolean;
}

/** The radiance of a ray that hits nothing, before lights. */
type SkyRadiance = (dx: number, dy: number, dz: number, out: number[]) => void;

/**
 * Whether a light-probe bake adds the light a probe receives straight from directional, point and
 * spot lights. See {@link LightProbeBakeOptions.directLight}.
 *
 * @beta
 */
export type LightProbeBakeDirectLight = "include" | "exclude";

/**
 * A sky gradient for {@link LightProbeBakeOptions.sky}: linear radiance straight up, at the horizon
 * and straight down, blended linearly by the ray's height.
 *
 * @beta
 */
export interface LightProbeBakeSkyGradient {
  /** Selects the gradient form. */
  readonly kind: "gradient";
  /** Linear radiance straight up. */
  readonly sky: ColorLike;
  /** Linear radiance at the horizon. */
  readonly horizon: ColorLike;
  /** Linear radiance straight down. */
  readonly ground: ColorLike;
}

/**
 * A sky as nine spherical-harmonic coefficients for {@link LightProbeBakeOptions.sky}.
 *
 * @remarks
 * `coefficients` holds 27 numbers: nine linear-RGB triples of **radiance** in the real SH basis,
 * in the usual graphics order: `Y00`, `Y1-1 (y)`, `Y10 (z)`, `Y11 (x)`, `Y2-2 (xy)`, `Y2-1 (yz)`,
 * `Y20 (3z²−1)`, `Y21 (xz)`, `Y22 (x²−y²)`, where `x`, `y` and `z` are the world axes (Y up). A ray
 * that hits nothing returns `Σ cᵢ·Yᵢ(d)`, clamped at 0.
 *
 * @beta
 */
export interface LightProbeBakeSkyHarmonics {
  /** Selects the harmonics form. */
  readonly kind: "sh9";
  /** 27 finite numbers. */
  readonly coefficients: readonly number[];
}

/**
 * What a ray that hits nothing returns: one linear colour, a gradient, or harmonics.
 *
 * @beta
 */
export type LightProbeBakeSky = ColorLike | LightProbeBakeSkyGradient | LightProbeBakeSkyHarmonics;

/**
 * Something the bake could not trace, and why.
 *
 * @beta
 */
export interface LightProbeBakeSkip {
  /** The entity's name. */
  readonly entity: string;
  /** The entity's uid. */
  readonly uid: string;
  /** The component's type id: `ignifx/MeshRenderer` or `ignifx/Model`. */
  readonly component: string;
  /** Why, in one line. */
  readonly reason: string;
}

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
  /** Rays per probe, a whole number from 1 to 4096. Defaults to `128`; more is smoother and slower. */
  readonly rays?: number;
  /** How far a ray looks for a surface, in metres; finite and positive. Defaults to `100`. */
  readonly maxDistance?: number;
  /**
   * What rays that hit nothing return, in linear radiance: a colour, a
   * {@link LightProbeBakeSkyGradient} or {@link LightProbeBakeSkyHarmonics}. Defaults to black.
   *
   * @remarks
   * Hemispheric lights are not part of the sky: they follow the light rules
   * ({@link LightProbeBakeOptions.directLight}). The scene's `Environment` is not read, because its
   * harmonics live in the `.env` file a headless app does not load; pass them here.
   */
  readonly sky?: LightProbeBakeSky;
  /**
   * Whether each probe also stores the light it receives straight from the `"realtime"` lights it
   * sees (`Light.bakeMode`). Defaults to `"exclude"`.
   *
   * @remarks
   * A real-time light keeps lighting the scene while a `LightProbeVolume` is on, so a probe that
   * also holds its direct light counts it twice. `"exclude"` bakes only its bounce: the light that
   * reached surfaces from it (shadowed) and came back. That holds for hemispheric lights too, whose
   * direct part is what a probe sees of their sky and ground. Use `"include"` to read a probe's
   * total light with `sampleLightProbes`. A `"baked"` light's direct light is always stored and a
   * `"mixed"` light's never, whatever this says.
   */
  readonly directLight?: LightProbeBakeDirectLight;
  /** Stops the bake between probes; the promise then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
  /**
   * Called after each probe.
   *
   * @param done - Probes baked so far.
   * @param total - Probes in the grid.
   */
  readonly onProgress?: (done: number, total: number) => void;
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
  /** How many enabled mesh renderers and models gave no triangles at all. */
  readonly skipped: number;
  /**
   * Every renderer or model left out, and every glTF primitive left out of a model that was traced
   * otherwise, with the reason.
   */
  readonly skips: readonly LightProbeBakeSkip[];
}

/** World-space triangles with one albedo per triangle, grouped by mesh. */
interface TraceScene {
  /** Nine floats per triangle. */
  readonly vertices: Float64Array;
  /** Three floats per triangle, linear RGB. */
  readonly albedo: Float64Array;
  /** The triangle count. */
  readonly count: number;
  /** Per mesh: its first triangle, its triangle count, then its world box's min and max. */
  readonly meshes: Float64Array;
  /** The mesh count. */
  readonly meshCount: number;
}

/** Floats per mesh in {@link TraceScene.meshes}. */
const MESH_STRIDE = 8;

/** A hit: the distance, the unit geometric normal facing the ray, and the triangle. */
interface Hit {
  distance: number;
  nx: number;
  ny: number;
  nz: number;
  triangle: number;
}

/** One light, reduced to what the bake needs; `direct` says whether a probe stores its direct light. */
type BakeLight =
  | {
      readonly kind: "directional";
      readonly to: readonly [number, number, number];
      readonly rgb: readonly number[];
      readonly direct: boolean;
    }
  | {
      readonly kind: "point";
      readonly at: readonly [number, number, number];
      readonly range: number;
      readonly rgb: readonly number[];
      readonly direct: boolean;
    }
  | {
      readonly kind: "hemispheric";
      readonly up: readonly [number, number, number];
      readonly sky: readonly number[];
      readonly ground: readonly number[];
      readonly direct: boolean;
    };

/**
 * What one light gives a light-probe bake, by its `bakeMode` and the bake's `directLight`.
 *
 * @remarks
 * Every light bounces: the light it puts on surfaces is traced back to the probes. Whether a probe
 * also stores the light it receives straight from it depends on who draws that light at run time:
 * a `"baked"` light is not drawn, so the probe holds it; a `"mixed"` light is drawn, so the probe
 * never does; a `"realtime"` light is drawn too, and `directLight: "include"` is how a bake asks
 * for its direct light anyway (to read a probe's total light).
 *
 * @param bakeMode - The light's `bakeMode`.
 * @param directLight - The bake's `directLight` option.
 * @returns Whether the probes store its direct light, and whether its bounce is baked.
 *
 * @beta
 */
export function lightBakeTerms(
  bakeMode: LightBakeMode,
  directLight: LightProbeBakeDirectLight,
): { readonly direct: boolean; readonly bounce: boolean } {
  if (bakeMode === "baked") {
    return { direct: true, bounce: true };
  }
  if (bakeMode === "mixed") {
    return { direct: false, bounce: true };
  }
  return { direct: directLight === "include", bounce: true };
}

/**
 * Bakes a light-probe grid from a world's mesh renderers and lights, on the CPU.
 *
 * @remarks
 * One bounce, first-order harmonics, deterministic. `MeshRenderer` meshes (built from data, or
 * primitives) and `Model` glTF files cast and bounce light; a model is read from the file a
 * headless app loaded, so under an app with a device models are skipped (see
 * {@link LightProbeBakeResult.skips}), as are Draco- and meshopt-compressed glTF primitives. By
 * default a probe holds every light's bounce but the direct light of `"baked"` lights only, since
 * the others keep lighting the scene in real time (see {@link LightProbeBakeOptions.directLight} and
 * `Light.bakeMode`). Cost grows with probes × rays × triangles (each mesh's bounding box culls its
 * triangles); it is meant for tools, not for every frame.
 *
 * The bake is asynchronous: it yields to the host after every ~8 ms of work, reports progress
 * through `onProgress` after each probe, and stops at the next probe once `signal` aborts.
 *
 * @param world - The world to bake. Its meshes and lights are read once, when the bake starts.
 * @param options - The grid, the quality, and the cancellation and progress hooks.
 * @returns The grid and what was traced.
 * @throws IgnifxError with code `IGX-0734`, before tracing anything, for a grid the `.probes.json`
 * format cannot hold (whole counts, `counts.x` ≤ 1024, `counts.y × counts.z` ≤ 4096, finite
 * `origin` and positive `cellSize`), `rays` outside 1–4096, a `maxDistance` that is not finite
 * and positive, a `directLight` other than `"include"` or `"exclude"`, or a `sky` that is not a
 * finite colour, gradient or 27 finite harmonics. The promise rejects with `signal.reason` when the
 * bake is aborted.
 *
 * @example
 * ```ts
 * const baked = await bakeLightProbes(world, {
 *   origin: { x: -4, y: 0.5, z: -4 },
 *   cellSize: { x: 2, y: 2, z: 2 },
 *   counts: { x: 5, y: 2, z: 5 },
 * });
 * world.createEntity("Probes").addComponent(LightProbeVolume, { probes: createLightProbeAsset(app, baked.data) });
 * ```
 *
 * @beta
 */
export async function bakeLightProbes(world: World, options: LightProbeBakeOptions): Promise<LightProbeBakeResult> {
  const settings = readBakeOptions(options);
  options.signal?.throwIfAborted();
  const { scene, skipped, skips } = collectTriangles(world, options.signal);
  const lights = collectLights(world, settings.includeDirect ? "include" : "exclude");
  const { origin, cellSize, counts } = settings.grid;
  const total = counts.x * counts.y * counts.z;
  const coefficients: number[] = [];
  const clock = createPerformanceClock();
  let sliceStart = clock.nowMs();
  for (let probe = 0; probe < total; probe += 1) {
    const i = probe % counts.x;
    const j = Math.floor(probe / counts.x) % counts.y;
    const k = Math.floor(probe / (counts.x * counts.y));
    coefficients.push(
      ...bakeProbe(
        scene,
        lights,
        origin.x + i * cellSize.x,
        origin.y + j * cellSize.y,
        origin.z + k * cellSize.z,
        settings,
      ),
    );
    options.onProgress?.(probe + 1, total);
    options.signal?.throwIfAborted();
    // Yield once a slice of work is spent, not after every probe: a `setTimeout(0)` per probe is
    // clamped to ~4 ms by browsers, which idled a 2,000-probe bake for ~8 s.
    if (clock.nowMs() - sliceStart >= YIELD_BUDGET_MS && probe + 1 < total) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the caller's thread keeps drawing between slices
      await yieldToHost();
      options.signal?.throwIfAborted();
      sliceStart = clock.nowMs();
    }
  }
  return {
    data: {
      origin,
      cellSize,
      counts,
      coefficients,
    },
    triangles: scene.count,
    skipped,
    skips,
  };
}

/**
 * Checks a bake's options before any work.
 *
 * @param options - The options.
 * @returns The checked settings.
 * @throws IgnifxError with code `IGX-0734` naming the first problem.
 */
function readBakeOptions(options: LightProbeBakeOptions): BakeSettings {
  const grid = readLightProbeGrid({ origin: options.origin, cellSize: options.cellSize, counts: options.counts });
  if (typeof grid === "string") {
    throw fail(grid);
  }
  const rays = options.rays ?? 128;
  if (!Number.isSafeInteger(rays) || rays < 1 || rays > MAX_RAYS) {
    throw fail(`rays must be a whole number from 1 to ${String(MAX_RAYS)}`);
  }
  const maxDistance = options.maxDistance ?? 100;
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    throw fail("maxDistance must be a finite number above 0");
  }
  // Widened: a JavaScript caller or a parsed file can pass anything.
  const directLight: string = options.directLight ?? "exclude";
  if (directLight !== "include" && directLight !== "exclude") {
    throw fail('directLight must be "include" or "exclude"');
  }
  return {
    grid,
    rays,
    maxDistance,
    sky: readSky(options.sky),
    includeDirect: directLight === "include",
  };
}

/** The real SH basis constants for bands 0–2. */
const SH_C0 = 0.282_094_791_773_878_1;
const SH_C1 = 0.488_602_511_902_919_9;
const SH_C2 = 1.092_548_430_592_079_2;
const SH_C3 = 0.315_391_565_252_520_05;
const SH_C4 = 0.546_274_215_296_039_6;

/**
 * Checks the `sky` option and turns it into a radiance function.
 *
 * @param sky - The option.
 * @returns The function.
 * @throws IgnifxError with code `IGX-0734` for a non-finite colour or the wrong harmonics.
 */
function readSky(sky: LightProbeBakeSky | undefined): SkyRadiance {
  if (sky === undefined) {
    return (_dx, _dy, _dz, out) => {
      out.fill(0);
    };
  }
  // Widened: a JavaScript caller or a parsed file can pass anything, `null` included.
  const given: unknown = sky;
  if (typeof given !== "object" || given === null) {
    throw fail("sky must be a colour, a gradient or harmonics");
  }
  if (!("kind" in sky)) {
    const flat = checkedColor(sky, "sky");
    return (_dx, _dy, _dz, out) => {
      for (let channel = 0; channel < 3; channel += 1) {
        out[channel] = read(flat, channel);
      }
    };
  }
  // Widened: a JavaScript caller or a parsed file can pass any kind.
  const kind: string = sky.kind;
  if (kind === "gradient" && sky.kind === "gradient") {
    const up = checkedColor(sky.sky, "sky.sky");
    const horizon = checkedColor(sky.horizon, "sky.horizon");
    const down = checkedColor(sky.ground, "sky.ground");
    return (_dx, dy, _dz, out) => {
      const end = dy >= 0 ? up : down;
      const t = Math.min(1, Math.abs(dy));
      for (let channel = 0; channel < 3; channel += 1) {
        out[channel] = read(horizon, channel) * (1 - t) + read(end, channel) * t;
      }
    };
  }
  if (kind === "sh9" && sky.kind === "sh9") {
    const c = sky.coefficients;
    if (!Array.isArray(c) || c.length !== 27 || !c.every((value) => Number.isFinite(value))) {
      throw fail("sky.coefficients must be 27 finite numbers (nine RGB triples)");
    }
    return (x, y, z, out) => {
      const basis = [
        SH_C0,
        SH_C1 * y,
        SH_C1 * z,
        SH_C1 * x,
        SH_C2 * x * y,
        SH_C2 * y * z,
        SH_C3 * (3 * z * z - 1),
        SH_C2 * x * z,
        SH_C4 * (x * x - y * y),
      ];
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let term = 0; term < 9; term += 1) {
          sum += read(c, term * 3 + channel) * read(basis, term);
        }
        out[channel] = Math.max(0, sum);
      }
    };
  }
  throw fail('sky.kind must be "gradient" or "sh9"');
}

/**
 * A linear colour option's three channels, checked.
 *
 * @param colour - The colour.
 * @param name - The option's name, for the error.
 * @returns Linear RGB.
 * @throws IgnifxError with code `IGX-0734` when a channel is not finite.
 */
function checkedColor(colour: ColorLike, name: string): number[] {
  // Widened: a gradient from a parsed file can leave a stop out.
  const given: unknown = colour;
  if (typeof given !== "object" || given === null) {
    throw fail(`${name} must be a colour with finite channels`);
  }
  const rgb = linearRgb(colour, false);
  if (!rgb.every((channel) => Number.isFinite(channel))) {
    throw fail(`${name} must be a colour with finite channels`);
  }
  return rgb;
}

/**
 * The error for a bake option.
 *
 * @param problem - What is wrong.
 * @returns The error.
 */
function fail(problem: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidLightProbeBake, `bakeLightProbes(): ${problem}.`, {
    context: { problem },
  });
}

/**
 * Lets the host run before the next slice of probes.
 *
 * @returns A promise that settles on a later task.
 */
function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Bakes one probe.
 *
 * @param scene - The triangles.
 * @param lights - The lights.
 * @param px - The probe's world X.
 * @param py - The probe's world Y.
 * @param pz - The probe's world Z.
 * @param settings - The checked options.
 * @returns Its 12 coefficients.
 */
function bakeProbe(
  scene: TraceScene,
  lights: readonly BakeLight[],
  px: number,
  py: number,
  pz: number,
  settings: BakeSettings,
): number[] {
  const { rays, maxDistance, sky } = settings;
  const hit: Hit = { distance: 0, nx: 0, ny: 0, nz: 0, triangle: -1 };
  const radiance = [0, 0, 0];
  const sh: number[] = Array.from({ length: 12 }, () => 0);
  for (let ray = 0; ray < rays; ray += 1) {
    const [dx, dy, dz] = fibonacciDirection(ray, rays);
    if (trace(scene, px, py, pz, dx, dy, dz, maxDistance, hit)) {
      shadeHit(scene, lights, hit, px + dx * hit.distance, py + dy * hit.distance, pz + dz * hit.distance, radiance);
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
  return sh;
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

/** Collects world-space meshes into a {@link TraceScene}. */
class SceneBuilder {
  readonly vertices: number[] = [];
  readonly albedo: number[] = [];
  readonly meshes: number[] = [];

  /**
   * Adds one mesh.
   *
   * @param positions - Three floats per vertex, in the space `matrix` maps from.
   * @param indices - Three indices per triangle.
   * @param matrix - A column-major world matrix.
   * @param rgb - The mesh's linear albedo.
   * @returns How many triangles it added.
   */
  add(
    positions: ArrayLike<number>,
    indices: ArrayLike<number>,
    matrix: ArrayLike<number>,
    rgb: readonly number[],
  ): number {
    const first = this.albedo.length / 3;
    const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const m = matrix;
    const triangles = Math.floor(indices.length / 3);
    for (let index = 0; index < triangles * 3; index += 1) {
      const vertex = read(indices, index) * 3;
      const x = read(positions, vertex);
      const y = read(positions, vertex + 1);
      const z = read(positions, vertex + 2);
      const world = [
        read(m, 0) * x + read(m, 4) * y + read(m, 8) * z + read(m, 12),
        read(m, 1) * x + read(m, 5) * y + read(m, 9) * z + read(m, 13),
        read(m, 2) * x + read(m, 6) * y + read(m, 10) * z + read(m, 14),
      ];
      for (let axis = 0; axis < 3; axis += 1) {
        const value = read(world, axis);
        this.vertices.push(value);
        min[axis] = Math.min(read(min, axis), value);
        max[axis] = Math.max(read(max, axis), value);
      }
      if (index % 3 === 2) {
        this.albedo.push(...rgb);
      }
    }
    if (triangles > 0) {
      this.meshes.push(first, triangles, ...min, ...max);
    }
    return triangles;
  }

  /**
   * The finished scene.
   *
   * @returns It.
   */
  build(): TraceScene {
    return {
      vertices: Float64Array.from(this.vertices),
      albedo: Float64Array.from(this.albedo),
      count: this.albedo.length / 3,
      meshes: Float64Array.from(this.meshes),
      meshCount: this.meshes.length / MESH_STRIDE,
    };
  }
}

/**
 * Gathers the world-space triangles of every enabled mesh renderer and model the bake can read.
 *
 * @param world - The world.
 * @param signal - Stops the collection between meshes, models and glTF primitives.
 * @returns The triangles, how many components gave none, and why each part was left out.
 */
function collectTriangles(
  world: World,
  signal: AbortSignal | undefined,
): { scene: TraceScene; skipped: number; skips: LightProbeBakeSkip[] } {
  const builder = new SceneBuilder();
  const skips: LightProbeBakeSkip[] = [];
  let skipped = 0;
  // One read per model asset per bake, however many `Model`s share it.
  const gltfCache = new Map<ModelAsset, GltfBakeGeometry | string>();
  const skip = (entity: Entity, component: string, reason: string): void => {
    skips.push({ entity: entity.name, uid: entity.uid, component, reason });
  };
  for (const renderer of world.components(MeshRenderer)) {
    signal?.throwIfAborted();
    if (!renderer.isEnabledInHierarchy) {
      continue;
    }
    const handle = renderer.mesh;
    const mesh = handle !== null && handle.state === "loaded" ? handle.value : null;
    const geometry = mesh === null ? null : (mesh.cpuGeometry ?? primitiveOrNull(mesh.primitive));
    if (geometry === null) {
      skipped += 1;
      skip(
        renderer.entity,
        MeshRenderer.typeId,
        mesh === null ? "its mesh is not loaded" : "its mesh has no CPU triangles",
      );
      continue;
    }
    builder.add(
      geometry.positions,
      geometry.indices,
      renderer.entity.transform.worldMatrix,
      materialAlbedo(renderer.materials[0] ?? null),
    );
  }
  for (const model of world.components(Model)) {
    signal?.throwIfAborted();
    if (!model.isEnabledInHierarchy) {
      continue;
    }
    const gltf = readModel(model.model, gltfCache);
    if (typeof gltf === "string") {
      skipped += 1;
      skip(model.entity, Model.typeId, gltf);
      continue;
    }
    let traced = 0;
    for (const primitive of gltf.primitives) {
      signal?.throwIfAborted();
      const override = primitive.materialName === null ? undefined : model.materialOverrides[primitive.materialName];
      const rgb = override === undefined || override === null ? primitive.albedo : materialAlbedo(override);
      traced += builder.add(primitive.positions, primitive.indices, model.entity.transform.worldMatrix, rgb);
    }
    for (const reason of gltf.skipped) {
      skip(model.entity, Model.typeId, reason);
    }
    if (traced === 0) {
      skipped += 1;
      if (gltf.skipped.length === 0) {
        skip(model.entity, Model.typeId, "the model's default scene draws no triangles");
      }
    }
  }
  return { scene: builder.build(), skipped, skips };
}

/**
 * A primitive's CPU triangles.
 *
 * @param definition - The primitive, or `null`.
 * @returns The triangles, or `null`.
 */
function primitiveOrNull(
  definition: MeshPrimitiveDefinition | null,
): { readonly positions: Float32Array; readonly indices: Uint32Array } | null {
  return definition === null ? null : primitiveTriangles(definition);
}

/**
 * A model's glTF triangles, read once per asset.
 *
 * @param handle - The `Model.model` field.
 * @param gltfCache - What this bake already read, by asset.
 * @returns The geometry, or why there is none.
 */
function readModel(
  handle: AssetHandle<ModelAsset> | null,
  gltfCache: Map<ModelAsset, GltfBakeGeometry | string>,
): GltfBakeGeometry | string {
  if (handle === null || handle.state !== "loaded") {
    return "its model is not loaded";
  }
  const asset = handle.value;
  const cached = gltfCache.get(asset);
  if (cached !== undefined) {
    return cached;
  }
  const bytes = asset.sourceBytes;
  let result: GltfBakeGeometry | string;
  if (bytes === null) {
    result = "its glTF is read only when a headless app loaded it (createApp({ headless: true }))";
  } else {
    try {
      result = readGltfTriangles(bytes);
    } catch (error) {
      result = `its glTF could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  gltfCache.set(asset, result);
  return result;
}

/**
 * A material's diffuse colour: its base (PBR, times `1 − metallic`) or diffuse (Standard) colour.
 *
 * @param handle - The material, or `null`.
 * @returns Linear RGB; mid grey when the material says nothing usable.
 */
function materialAlbedo(handle: AssetHandle<MaterialAsset> | null): number[] {
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
 * Collects the enabled lights, in linear RGB times intensity, with what each gives the bake.
 *
 * @param world - The world.
 * @param directLight - The bake's `directLight` option.
 * @returns The lights.
 */
function collectLights(world: World, directLight: LightProbeBakeDirectLight): BakeLight[] {
  const out: BakeLight[] = [];
  for (const light of world.components(Light)) {
    if (!light.isEnabledInHierarchy || light.intensity <= 0) {
      continue;
    }
    const { direct } = lightBakeTerms(light.bakeMode, directLight);
    const rgb = linearRgb(light.color, true).map((channel) => channel * light.intensity);
    const transform = light.entity.transform;
    if (light.type === "directional") {
      const forward = transform.forward;
      out.push({ kind: "directional", to: [-forward.x, -forward.y, -forward.z], rgb, direct });
    } else if (light.type === "hemispheric") {
      const up = transform.up;
      const ground = linearRgb(light.groundColor, true).map((channel) => channel * light.intensity);
      out.push({ kind: "hemispheric", up: [up.x, up.y, up.z], sky: rgb, ground, direct });
    } else {
      const at = transform.position;
      out.push({ kind: "point", at: [at.x, at.y, at.z], range: light.range, rgb, direct });
    }
  }
  return out;
}

/**
 * The radiance a surface hit sends back: albedo times the direct light there, from every light.
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
 * The radiance of a ray that hit nothing: the sky, plus the hemispheric lights whose direct light
 * the probes store.
 *
 * @param lights - The lights.
 * @param sky - The sky.
 * @param dx - The ray's X.
 * @param dy - The ray's Y.
 * @param dz - The ray's Z.
 * @param out - Receives linear RGB.
 */
function missRadiance(
  lights: readonly BakeLight[],
  sky: SkyRadiance,
  dx: number,
  dy: number,
  dz: number,
  out: number[],
): void {
  sky(dx, dy, dz, out);
  for (const light of lights) {
    if (light.kind === "hemispheric" && light.direct) {
      const above = dx * light.up[0] + dy * light.up[1] + dz * light.up[2] >= 0;
      for (let channel = 0; channel < 3; channel += 1) {
        out[channel] = read(out, channel) + read(above ? light.sky : light.ground, channel);
      }
    }
  }
}

/**
 * Adds the directional, point and spot lights whose direct light the probes store, as
 * clamped-cosine lobes.
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
    if (light.kind === "hemispheric" || !light.direct) {
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
 * The distance at which a ray enters an axis-aligned box (slab test).
 *
 * @param meshes - The scene's mesh table.
 * @param base - The mesh's first float in it.
 * @param ox - The ray origin's X.
 * @param oy - The ray origin's Y.
 * @param oz - The ray origin's Z.
 * @param ix - `1 / dx`.
 * @param iy - `1 / dy`.
 * @param iz - `1 / dz`.
 * @param nearest - How far the nearest hit so far is.
 * @returns Whether the ray meets the box before `nearest`.
 */
function meetsBox(
  meshes: Float64Array,
  base: number,
  ox: number,
  oy: number,
  oz: number,
  ix: number,
  iy: number,
  iz: number,
  nearest: number,
): boolean {
  let near = 0;
  let far = nearest;
  const origin = [ox, oy, oz];
  const inverse = [ix, iy, iz];
  for (let axis = 0; axis < 3; axis += 1) {
    const o = read(origin, axis);
    const inv = read(inverse, axis);
    // A small pad keeps a triangle lying in the box's face from being culled by rounding.
    const lo = read(meshes, base + 2 + axis) - 1e-6;
    const hi = read(meshes, base + 5 + axis) + 1e-6;
    let t0 = (lo - o) * inv;
    let t1 = (hi - o) * inv;
    if (Number.isNaN(t0) || Number.isNaN(t1)) {
      // A ray parallel to this slab, starting on its plane: inside it.
      if (o < lo || o > hi) {
        return false;
      }
      continue;
    }
    if (t0 > t1) {
      [t0, t1] = [t1, t0];
    }
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) {
      return false;
    }
  }
  return true;
}

/**
 * Finds the nearest triangle a ray hits (Möller–Trumbore, both faces), testing only the meshes
 * whose world box it passes through.
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
  const meshes = scene.meshes;
  const ix = 1 / dx;
  const iy = 1 / dy;
  const iz = 1 / dz;
  let nearest = maxDistance;
  let found = -1;
  for (let mesh = 0; mesh < scene.meshCount; mesh += 1) {
    const base = mesh * MESH_STRIDE;
    if (!meetsBox(meshes, base, ox, oy, oz, ix, iy, iz, nearest)) {
      continue;
    }
    const first = read(meshes, base);
    const end = first + read(meshes, base + 1);
    for (let triangle = first; triangle < end; triangle += 1) {
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
