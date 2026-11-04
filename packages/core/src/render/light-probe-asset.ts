import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { Vec3Like } from "../math/types.js";

/**
 * Light probes (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B2): a regular grid of baked
 * irradiance samples that a `LightProbeVolume` lights PBR materials with, in place of the scene
 * environment's diffuse light. Everything here is plain data and runs in Node.
 *
 * Each probe stores four RGB coefficients of first-order spherical harmonics, already convolved and
 * scaled the way Babylon Lite's environment harmonics are, so the diffuse light a white surface with
 * normal `n` receives is `c0 + c1·n.y + c2·n.z + c3·n.x` (Lite's `environmentIrradiance`, L1 part).
 */

/**
 * The asset type light-probe grids are registered under.
 *
 * @public
 */
export const LIGHT_PROBE_ASSET_TYPE = "lightprobes";

/**
 * The address extensions that select the light-probe loader.
 *
 * @public
 */
export const LIGHT_PROBE_FILE_EXTENSIONS: readonly string[] = Object.freeze([".probes.json"]);

/**
 * The `format` header every `.probes.json` carries.
 *
 * @public
 */
export const LIGHT_PROBE_FILE_FORMAT = "ignifx-probes";

/**
 * The `formatVersion` this engine reads and writes.
 *
 * @public
 */
export const LIGHT_PROBE_FORMAT_VERSION = 1;

/** Floats per probe: four RGB coefficients. */
const FLOATS_PER_PROBE = 12;

/** The largest grid side along X (the texture is four times as wide) and the largest Y·Z product. */
const MAX_X = 1024;
const MAX_YZ = 4096;

/** The bounds that keep the generated shader constants valid 32-bit floats. */
const MAX_COORDINATE = 1e20;
const MIN_CELL = 1e-30;

/**
 * A grid of light probes, as a `.probes.json` stores it.
 *
 * @remarks
 * Probe `(i, j, k)` sits at `origin + (i, j, k) · cellSize`. `coefficients` holds 12 floats per probe,
 * probes ordered X fastest, then Y, then Z (`index = i + countX·(j + countY·k)`); each probe's floats
 * are `c0.rgb, c1.rgb, c2.rgb, c3.rgb` in linear RGB (see the module remarks).
 *
 * @public
 */
export interface LightProbeData {
  /** The world position of probe `(0, 0, 0)`. */
  readonly origin: Vec3Like;
  /** The distance between neighbouring probes along each axis, in metres. */
  readonly cellSize: Vec3Like;
  /** How many probes along X, Y and Z; each at least 1. */
  readonly counts: { readonly x: number; readonly y: number; readonly z: number };
  /** 12 floats per probe, `countX · countY · countZ · 12` in all. */
  readonly coefficients: readonly number[];
}

/**
 * A loaded light-probe grid.
 *
 * @example
 * ```ts
 * const probes = await app.assets.loadAsync<LightProbeAsset>("lighting/hall.probes.json");
 * world.createEntity("Probes").addComponent(LightProbeVolume, { probes });
 * ```
 *
 * @beta
 */
export class LightProbeAsset {
  /** The type name the asset service registers light-probe grids under. */
  static assetType: string = LIGHT_PROBE_ASSET_TYPE;

  /** The grid. */
  readonly data: LightProbeData;

  /**
   * Wraps a checked grid. Use the loader or {@link createLightProbeAsset}.
   *
   * @param data - The grid, already checked by `readLightProbeData`.
   *
   * @internal
   */
  constructor(data: LightProbeData) {
    this.data = data;
  }
}

/**
 * Publishes a grid built in code, such as the result of a bake, as an asset.
 *
 * @param app - The app.
 * @param data - The grid.
 * @returns A handle a `LightProbeVolume` can take.
 * @throws IgnifxError with code `IGX-0709` when the grid is malformed.
 *
 * @beta
 */
export function createLightProbeAsset(app: App, data: LightProbeData): AssetHandle<LightProbeAsset> {
  return app.assets.register(new LightProbeAsset(readLightProbeData(data, "light probe data")), {
    type: LIGHT_PROBE_ASSET_TYPE,
  });
}

/**
 * Turns a grid into the JSON a `.probes.json` file holds.
 *
 * @param data - The grid.
 * @returns The file contents, with the format header.
 *
 * @beta
 */
export function writeLightProbeFile(data: LightProbeData): Record<string, unknown> {
  return {
    format: LIGHT_PROBE_FILE_FORMAT,
    formatVersion: LIGHT_PROBE_FORMAT_VERSION,
    origin: { x: data.origin.x, y: data.origin.y, z: data.origin.z },
    cellSize: { x: data.cellSize.x, y: data.cellSize.y, z: data.cellSize.z },
    counts: { x: data.counts.x, y: data.counts.y, z: data.counts.z },
    coefficients: [...data.coefficients],
  };
}

/**
 * Reads a parsed `.probes.json`.
 *
 * @param parsed - The parsed JSON.
 * @param address - The file's address, for the error.
 * @returns The grid.
 * @throws IgnifxError with code `IGX-0709` when the header, a field or the coefficient count is wrong.
 *
 * @internal
 */
export function readLightProbeFile(parsed: unknown, address: string): LightProbeData {
  const file = asRecord(parsed);
  if (
    file === null ||
    file["format"] !== LIGHT_PROBE_FILE_FORMAT ||
    file["formatVersion"] !== LIGHT_PROBE_FORMAT_VERSION
  ) {
    throw invalid(address, `it must start with { "format": "${LIGHT_PROBE_FILE_FORMAT}", "formatVersion": 1 }`);
  }
  return readLightProbeData(file, address);
}

/**
 * Checks a grid's fields.
 *
 * @param value - The candidate grid.
 * @param address - Where it came from, for the error.
 * @returns A grid with copied, checked fields.
 * @throws IgnifxError with code `IGX-0709` on a malformed field.
 *
 * @internal
 */
export function readLightProbeData(value: unknown, address: string): LightProbeData {
  const record = asRecord(value);
  if (record === null) {
    throw invalid(address, "it is not an object");
  }
  const grid = readLightProbeGrid(record);
  if (typeof grid === "string") {
    throw invalid(address, grid);
  }
  const { origin, cellSize, counts } = grid;
  const coefficients = record["coefficients"];
  const expected = counts.x * counts.y * counts.z * FLOATS_PER_PROBE;
  if (
    !Array.isArray(coefficients) ||
    coefficients.length !== expected ||
    !coefficients.every((n) => Number.isFinite(n))
  ) {
    throw invalid(address, `coefficients must be ${String(expected)} finite numbers (12 per probe)`);
  }
  return { origin, cellSize, counts, coefficients: coefficients.map(Number) };
}

/**
 * The grid part of a light-probe grid: where it is, how far apart the probes are, and how many.
 *
 * @internal
 */
export interface LightProbeGrid {
  readonly origin: { x: number; y: number; z: number };
  readonly cellSize: { x: number; y: number; z: number };
  readonly counts: { x: number; y: number; z: number };
}

/**
 * Checks the grid fields of a candidate grid, for a file and for a bake alike.
 *
 * @remarks
 * Besides the format's count limits, `origin` stays below 1e20 in size and `cellSize` between
 * 1e-30 and 1e20, so the constants the shader is generated with stay valid 32-bit floats.
 *
 * @param record - An object with `origin`, `cellSize` and `counts`.
 * @returns The checked copies, or what is wrong with them.
 *
 * @internal
 */
export function readLightProbeGrid(record: Readonly<Record<string, unknown>>): LightProbeGrid | string {
  const origin = readVec3(record["origin"], (n) => Number.isFinite(n) && Math.abs(n) < MAX_COORDINATE);
  const cellSize = readVec3(record["cellSize"], (n) => Number.isFinite(n) && n > MIN_CELL && n < MAX_COORDINATE);
  const counts = readVec3(record["counts"], (n) => Number.isSafeInteger(n) && n >= 1);
  if (origin === null || cellSize === null || counts === null) {
    return "origin (finite, below 1e20), cellSize (from 1e-30 to 1e20) and counts (whole, at least 1) must each be { x, y, z }";
  }
  if (counts.x > MAX_X || counts.y * counts.z > MAX_YZ) {
    return `counts.x must be at most ${String(MAX_X)} and counts.y × counts.z at most ${String(MAX_YZ)}`;
  }
  return { origin, cellSize, counts };
}

/**
 * The diffuse light a white surface receives at a point, read from the grid on the CPU the same way
 * the shader reads it: trilinear between the eight surrounding probes, clamped at the grid's edges.
 *
 * @param data - The grid.
 * @param x - World X.
 * @param y - World Y.
 * @param z - World Z.
 * @param normal - The surface normal, unit length.
 * @returns Linear RGB.
 *
 * @beta
 */
export function sampleLightProbes(
  data: LightProbeData,
  x: number,
  y: number,
  z: number,
  normal: Vec3Like,
): [number, number, number] {
  const { counts } = data;
  const gx = gridCoordinate(x, data.origin.x, data.cellSize.x, counts.x);
  const gy = gridCoordinate(y, data.origin.y, data.cellSize.y, counts.y);
  const gz = gridCoordinate(z, data.origin.z, data.cellSize.z, counts.z);
  const out: [number, number, number] = [0, 0, 0];
  for (let corner = 0; corner < 8; corner += 1) {
    const ix = corner & 1 ? gx.high : gx.low;
    const iy = corner & 2 ? gy.high : gy.low;
    const iz = corner & 4 ? gz.high : gz.low;
    const weight = (corner & 1 ? gx.t : 1 - gx.t) * (corner & 2 ? gy.t : 1 - gy.t) * (corner & 4 ? gz.t : 1 - gz.t);
    const base = (ix + counts.x * (iy + counts.y * iz)) * FLOATS_PER_PROBE;
    for (let channel = 0; channel < 3; channel += 1) {
      const c = (index: number): number => data.coefficients[base + index * 3 + channel] ?? 0;
      out[channel] = (out[channel] ?? 0) + weight * (c(0) + c(1) * normal.y + c(2) * normal.z + c(3) * normal.x);
    }
  }
  return out;
}

/**
 * Packs a grid into the half-float RGBA texels the shader reads: probe `(i, j, k)`'s coefficient `c`
 * at texel `(i + countX·c, j + countY·k)`.
 *
 * @param data - The grid.
 * @returns The width, height and texels (four half floats each, alpha 1).
 *
 * @internal
 */
export function packLightProbeTexels(data: LightProbeData): { width: number; height: number; texels: Uint16Array } {
  const { x: nx, y: ny, z: nz } = data.counts;
  const width = nx * 4;
  const height = ny * nz;
  const texels = new Uint16Array(width * height * 4);
  const one = toHalfFloat(1);
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const base = (i + nx * (j + ny * k)) * FLOATS_PER_PROBE;
        for (let c = 0; c < 4; c += 1) {
          const texel = (i + nx * c + width * (j + ny * k)) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            texels[texel + channel] = toHalfFloat(data.coefficients[base + c * 3 + channel] ?? 0);
          }
          texels[texel + 3] = one;
        }
      }
    }
  }
  return { width, height, texels };
}

/**
 * Converts a number to IEEE 754 half precision, rounding to nearest and saturating to ±65504.
 *
 * @param value - The number.
 * @returns The 16 bits.
 *
 * @internal
 */
export function toHalfFloat(value: number): number {
  if (Number.isNaN(value)) {
    return 0x7e00;
  }
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const magnitude = Math.min(Math.abs(value), 65504);
  if (magnitude < 2 ** -24) {
    return sign;
  }
  if (magnitude < 2 ** -14) {
    return sign | Math.round(magnitude / 2 ** -24);
  }
  const exponent = Math.floor(Math.log2(magnitude));
  const mantissa = Math.round((magnitude / 2 ** exponent - 1) * 1024);
  // A mantissa that rounds up to 1024 carries into the exponent.
  return sign | (((exponent + 15) << 10) + mantissa);
}

/** A grid axis lookup: the two probe indices around a point and the blend between them. */
interface AxisCell {
  readonly low: number;
  readonly high: number;
  readonly t: number;
}

/**
 * Finds the probes around a coordinate on one axis.
 *
 * @param value - The world coordinate.
 * @param origin - The grid origin on this axis.
 * @param cell - The cell size on this axis.
 * @param count - The probe count on this axis.
 * @returns The cell.
 */
function gridCoordinate(value: number, origin: number, cell: number, count: number): AxisCell {
  const g = Math.min(Math.max((value - origin) / cell, 0), count - 1);
  const low = Math.min(Math.floor(g), Math.max(count - 2, 0));
  const high = Math.min(low + 1, count - 1);
  return { low, high, t: g - low };
}

/**
 * Reads `{ x, y, z }` whose components all pass a check.
 *
 * @param value - The candidate.
 * @param check - The per-component test.
 * @returns A copy, or `null`.
 */
function readVec3(value: unknown, check: (n: number) => boolean): { x: number; y: number; z: number } | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const { x, y, z } = record;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number" || ![x, y, z].every(check)) {
    return null;
  }
  return { x, y, z };
}

/**
 * Narrows a value to a plain record.
 *
 * @param value - The candidate.
 * @returns The record, or `null` for anything else.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // Boundary narrowing of parsed JSON (coding standards §5.2).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Record<string, unknown>;
}

/**
 * The error for a malformed grid.
 *
 * @param address - Where it came from.
 * @param problem - What is wrong.
 * @returns The error.
 */
function invalid(address: string, problem: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidAssetFile, `${address} is not an ${LIGHT_PROBE_FILE_FORMAT} file.`, {
    context: { file: address, format: LIGHT_PROBE_FILE_FORMAT },
    hint: `Fix the file: ${problem}.`,
  });
}
