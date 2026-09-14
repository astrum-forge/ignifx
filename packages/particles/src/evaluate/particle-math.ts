import { LOOKUP_SAMPLES } from "../definition/types.js";
import { srgbToLinear } from "../definition/values.js";
import { particleUnits } from "../emitter/pcg3d.js";
import {
  RECORD_FLOATS,
  RECORD_LIFETIME,
  RECORD_POSITION,
  RECORD_ROTATION,
  RECORD_SEED,
  RECORD_SIZE,
  RECORD_SPAWN_TIME,
  RECORD_VELOCITY,
} from "../emitter/record-ring.js";
import { noise3 } from "./noise.js";
import type { LookupRow, ParticleDefinition } from "../definition/types.js";

// The CPU evaluator: one spawn record and a clock in, the particle's whole state out
// (`docs/plan/2026-09-terrain-particles-shaders.md` §4.1). The WGSL in `src/gpu/wgsl.ts` computes
// exactly this from the same bytes; `test/gpu/conformance.browser.test.ts` holds the two together.

/** Degrees to radians. */
const DEG_TO_RAD = Math.PI / 180;

/** Bytes per lookup texel. */
const TEXEL_BYTES = 4;

/** The reciprocal of a byte's range. */
const BYTE_SCALE = 1 / 255;

/**
 * Everything a particle is at one instant.
 *
 * @beta
 */
export interface ParticleState {
  /** The world position. */
  readonly position: Float32Array;
  /** The world velocity. */
  readonly velocity: Float32Array;
  /** The size along each axis, in metres. */
  readonly size: Float32Array;
  /** Linear red, green, blue, and straight alpha. */
  readonly color: Float32Array;
  /** The rotation about the view axis (or the mesh's spin axis), in radians. */
  rotation: number;
  /** The sprite-sheet frame, or `0` without a sheet. */
  frame: number;
  /** Seconds since spawn. */
  age: number;
  /** `age / lifetime`, in `[0, 1]`. */
  life: number;
}

/**
 * Allocates an empty state.
 *
 * @returns A state with every field zeroed.
 *
 * @beta
 */
export function createParticleState(): ParticleState {
  return {
    position: new Float32Array(3),
    velocity: new Float32Array(3),
    size: new Float32Array(3),
    color: new Float32Array(4),
    rotation: 0,
    frame: 0,
    age: 0,
    life: 0,
  };
}

/**
 * The per-system inputs the evaluator needs beyond the definition.
 *
 * @beta
 */
export interface ParticleEvaluationInputs {
  /** The definition every record was written from. */
  readonly definition: ParticleDefinition;
  /** The effective gravity plus constant force, in the simulation space. */
  readonly gravity: Float32Array;
  /** The emitter's current world matrix, for a `"local"` definition; ignored for `"world"`. */
  readonly emitterWorld: Float32Array;
  /** The orbit centre in the simulation space: the origin for `"local"`, the emitter's position for `"world"`. */
  readonly orbitCenter: Float32Array;
}

/** Scratch space the evaluator reuses; created once per module use, never per call. */
interface EvaluatorScratch {
  readonly words: Uint32Array;
  readonly units: Float32Array;
  readonly rgba: Float32Array;
  readonly noise: Float32Array;
}

/** The scratch, allocated on first use. */
let scratch: EvaluatorScratch | null = null;

/**
 * The shared scratch space.
 *
 * @returns The scratch arrays.
 */
function scratchSpace(): EvaluatorScratch {
  scratch ??= {
    words: new Uint32Array(3),
    units: new Float32Array(3),
    rgba: new Float32Array(4),
    noise: new Float32Array(3),
  };
  return scratch;
}

/**
 * Evaluates one record at a clock.
 *
 * @param inputs - The definition and the per-system values.
 * @param floats - The ring's floats.
 * @param words - The ring's words.
 * @param slot - Which record.
 * @param clock - The system clock.
 * @param out - Receives the state.
 * @returns `true` when the particle is alive; `false` leaves `out` untouched.
 *
 * @beta
 */
export function evaluateParticle(
  inputs: ParticleEvaluationInputs,
  floats: Float32Array,
  words: Uint32Array,
  slot: number,
  clock: number,
  out: ParticleState,
): boolean {
  const base = slot * RECORD_FLOATS;
  const spawn = floats[base + RECORD_SPAWN_TIME] ?? 0;
  const lifetime = floats[base + RECORD_LIFETIME] ?? 0;
  // The shader's `clock` uniform is an `f32`, and so is the record; rounding here is what keeps the
  // two evaluators agreeing about which particles exist.
  const age = Math.fround(clock) - spawn;
  if (age < 0 || age > lifetime || lifetime <= 0) {
    return false;
  }
  const definition = inputs.definition;
  const life = age / lifetime;
  const t = age;
  const s = scratchSpace();
  const position = out.position;
  const velocity = out.velocity;

  const gx = inputs.gravity[0] ?? 0;
  const gy = inputs.gravity[1] ?? 0;
  const gz = inputs.gravity[2] ?? 0;
  const p0x = floats[base + RECORD_POSITION] ?? 0;
  const p0y = floats[base + RECORD_POSITION + 1] ?? 0;
  const p0z = floats[base + RECORD_POSITION + 2] ?? 0;
  const v0x = floats[base + RECORD_VELOCITY] ?? 0;
  const v0y = floats[base + RECORD_VELOCITY + 1] ?? 0;
  const v0z = floats[base + RECORD_VELOCITY + 2] ?? 0;
  const k = definition.forces.drag;
  if (k > 0) {
    const inverse = 1 / k;
    const e = Math.exp(-k * t);
    const ax = v0x - gx * inverse;
    const ay = v0y - gy * inverse;
    const az = v0z - gz * inverse;
    const settle = (1 - e) * inverse;
    position[0] = p0x + ax * settle + gx * inverse * t;
    position[1] = p0y + ay * settle + gy * inverse * t;
    position[2] = p0z + az * settle + gz * inverse * t;
    velocity[0] = ax * e + gx * inverse;
    velocity[1] = ay * e + gy * inverse;
    velocity[2] = az * e + gz * inverse;
  } else {
    const half = 0.5 * t * t;
    position[0] = p0x + v0x * t + gx * half;
    position[1] = p0y + v0y * t + gy * half;
    position[2] = p0z + v0z * t + gz * half;
    velocity[0] = v0x + gx * t;
    velocity[1] = v0y + gy * t;
    velocity[2] = v0z + gz * t;
  }

  const orbit = definition.forces.orbit;
  if (orbit !== null) {
    const angle = orbit.speed * DEG_TO_RAD * t;
    rotateAbout(position, inputs.orbitCenter, orbit.axis.x, orbit.axis.y, orbit.axis.z, angle);
    rotateAbout(velocity, null, orbit.axis.x, orbit.axis.y, orbit.axis.z, angle);
  }

  const noise = definition.forces.noise;
  if (noise !== null) {
    const fallback = noise.influenceOverLife.kind === "constant" ? noise.influenceOverLife.value : 1;
    const amount = noise.strength * readScalarRow(definition, definition.lookup.noise, life, 0, fallback);
    if (amount !== 0) {
      const frequency = noise.frequency;
      noise3(
        position[0] * frequency + noise.scroll.x * t,
        position[1] * frequency + noise.scroll.y * t,
        position[2] * frequency + noise.scroll.z * t,
        noise.octaves,
        s.words,
        s.noise,
      );
      position[0] += amount * (s.noise[0] ?? 0);
      position[1] += amount * (s.noise[1] ?? 0);
      position[2] += amount * (s.noise[2] ?? 0);
    }
  }

  if (definition.main.simulationSpace === "local") {
    transformPoint(inputs.emitterWorld, position);
    transformDirection(inputs.emitterWorld, velocity);
  }

  const seed = words[base + RECORD_SEED] ?? 0;
  particleUnits(seed, s.units, s.words);

  // Colour: the start colour (a constant or a pick between two) times the gradient row, both sRGB,
  // decoded to linear once multiplied.
  const start = definition.start.color;
  if (start.kind === "random") {
    const u = s.units[0] ?? 0;
    s.rgba[0] = start.min.r + (start.max.r - start.min.r) * u;
    s.rgba[1] = start.min.g + (start.max.g - start.min.g) * u;
    s.rgba[2] = start.min.b + (start.max.b - start.min.b) * u;
    s.rgba[3] = start.min.a + (start.max.a - start.min.a) * u;
  } else {
    const value = start.kind === "constant" ? start.value : { r: 1, g: 1, b: 1, a: 1 };
    s.rgba[0] = value.r;
    s.rgba[1] = value.g;
    s.rgba[2] = value.b;
    s.rgba[3] = value.a;
  }
  const colorRow = definition.lookup.color;
  if (colorRow !== null) {
    const texel = sampleTexel(life);
    const pixels = definition.lookup.pixels;
    const rowBase = colorRow.index * LOOKUP_SAMPLES * TEXEL_BYTES;
    s.rgba[0] *= lerpByte(pixels, rowBase, texel, 0);
    s.rgba[1] *= lerpByte(pixels, rowBase, texel, 1);
    s.rgba[2] *= lerpByte(pixels, rowBase, texel, 2);
    s.rgba[3] *= lerpByte(pixels, rowBase, texel, 3);
  }
  out.color[0] = srgbToLinear(s.rgba[0]);
  out.color[1] = srgbToLinear(s.rgba[1]);
  out.color[2] = srgbToLinear(s.rgba[2]);
  out.color[3] = s.rgba[3];

  // Size: the record's size, the per-axis multipliers, and the size row per axis.
  const size0 = floats[base + RECORD_SIZE] ?? 0;
  const size3D = definition.start.size3D;
  out.size[0] = size0 * (size3D?.x ?? 1);
  out.size[1] = size0 * (size3D?.y ?? 1);
  out.size[2] = size0 * (size3D?.z ?? 1);
  const sizeRow = definition.lookup.size;
  if (sizeRow !== null) {
    out.size[0] *= readScalarRow(definition, sizeRow, life, 0, 1);
    out.size[1] *= readScalarRow(definition, sizeRow, life, 1, 1);
    out.size[2] *= readScalarRow(definition, sizeRow, life, 2, 1);
  }

  // Rotation: the start rotation plus the angular speed, which is a constant, a pick between two, or
  // a row sampled at this instant.
  let angular = 0;
  const rotation = definition.overLifetime.rotation;
  if (rotation !== null) {
    if (rotation.kind === "constant") {
      angular = rotation.value;
    } else if (rotation.kind === "random") {
      angular = rotation.min + (rotation.max - rotation.min) * (s.units[1] ?? 0);
    } else {
      angular = readScalarRow(definition, definition.lookup.rotation, life, 0, 0);
    }
  }
  out.rotation = (floats[base + RECORD_ROTATION] ?? 0) + angular * DEG_TO_RAD * t;

  // Frame: the sheet rule.
  const sheet = definition.renderer.sheet;
  if (sheet === null) {
    out.frame = 0;
  } else {
    const count = sheet.tiles.x * sheet.tiles.y;
    if (sheet.mode === "random") {
      out.frame = Math.min(count - 1, Math.floor((s.units[2] ?? 0) * count));
    } else if (sheet.mode === "fps") {
      out.frame = Math.floor((s.units[2] ?? 0) * count + sheet.fps * t) % count;
    } else {
      const fraction = readScalarRow(definition, definition.lookup.frame, life, 0, 0);
      out.frame = Math.max(0, Math.min(count - 1, Math.floor(fraction * count)));
    }
  }
  out.age = age;
  out.life = life;
  return true;
}

/**
 * Rotates a vector about an axis through a centre by an angle (Rodrigues' formula), in place.
 *
 * @param vector - The vector, or a point when `center` is given.
 * @param center - The centre of rotation, or `null` to rotate a direction.
 * @param ax - The unit axis.
 * @param ay - The unit axis.
 * @param az - The unit axis.
 * @param angle - The angle in radians.
 */
function rotateAbout(
  vector: Float32Array,
  center: Float32Array | null,
  ax: number,
  ay: number,
  az: number,
  angle: number,
): void {
  const cx = center?.[0] ?? 0;
  const cy = center?.[1] ?? 0;
  const cz = center?.[2] ?? 0;
  const ox = (vector[0] ?? 0) - cx;
  const oy = (vector[1] ?? 0) - cy;
  const oz = (vector[2] ?? 0) - cz;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = ax * ox + ay * oy + az * oz;
  const crossX = ay * oz - az * oy;
  const crossY = az * ox - ax * oz;
  const crossZ = ax * oy - ay * ox;
  const k = 1 - cos;
  vector[0] = cx + ox * cos + crossX * sin + ax * dot * k;
  vector[1] = cy + oy * cos + crossY * sin + ay * dot * k;
  vector[2] = cz + oz * cos + crossZ * sin + az * dot * k;
}

/**
 * Transforms a point by a column-major matrix, in place.
 *
 * @param m - Sixteen floats.
 * @param p - The point.
 */
export function transformPoint(m: Float32Array, p: Float32Array): void {
  const x = p[0] ?? 0;
  const y = p[1] ?? 0;
  const z = p[2] ?? 0;
  p[0] = (m[0] ?? 1) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
  p[1] = (m[1] ?? 0) * x + (m[5] ?? 1) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
  p[2] = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 1) * z + (m[14] ?? 0);
}

/**
 * Transforms a direction by the upper-left 3x3 of a column-major matrix, in place.
 *
 * @param m - Sixteen floats.
 * @param d - The direction.
 */
export function transformDirection(m: Float32Array, d: Float32Array): void {
  const x = d[0] ?? 0;
  const y = d[1] ?? 0;
  const z = d[2] ?? 0;
  d[0] = (m[0] ?? 1) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z;
  d[1] = (m[1] ?? 0) * x + (m[5] ?? 1) * y + (m[9] ?? 0) * z;
  d[2] = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 1) * z;
}

/** The two texels and the weight a lookup sample blends, reused across calls. */
const texelScratch = { index: 0, next: 0, weight: 0 };

/**
 * Where along a row a normalized time lands: the same `x = t * 63` rule the shader's texture
 * coordinate `(t * 63 + 0.5) / 64` produces under linear filtering with clamp addressing.
 *
 * @param life - The normalized time.
 * @returns The scratch descriptor.
 */
function sampleTexel(life: number): typeof texelScratch {
  const clamped = life <= 0 ? 0 : life >= 1 ? 1 : life;
  const x = clamped * (LOOKUP_SAMPLES - 1);
  const index = Math.floor(x);
  texelScratch.index = index;
  texelScratch.next = index + 1 >= LOOKUP_SAMPLES ? index : index + 1;
  texelScratch.weight = x - index;
  return texelScratch;
}

/**
 * Linearly interpolates one channel between two texels of a row, as a `0`–`1` fraction.
 *
 * @param pixels - The lookup bytes.
 * @param rowBase - The row's first byte.
 * @param texel - The sample descriptor.
 * @param channel - `0`–`3`.
 * @returns The blended channel.
 */
function lerpByte(pixels: Uint8Array, rowBase: number, texel: typeof texelScratch, channel: number): number {
  const a = (pixels[rowBase + texel.index * TEXEL_BYTES + channel] ?? 0) * BYTE_SCALE;
  const b = (pixels[rowBase + texel.next * TEXEL_BYTES + channel] ?? 0) * BYTE_SCALE;
  return a + (b - a) * texel.weight;
}

/**
 * Reads a scalar row's decoded value at a normalized time.
 *
 * @param definition - The definition.
 * @param row - The row, or `null` to return `fallback`.
 * @param life - The normalized time.
 * @param channel - Which channel holds the value.
 * @param fallback - What to return when the row is absent.
 * @returns The decoded value.
 *
 * @beta
 */
export function readScalarRow(
  definition: ParticleDefinition,
  row: LookupRow | null,
  life: number,
  channel: number,
  fallback: number,
): number {
  if (row === null) {
    return fallback;
  }
  const texel = sampleTexel(life);
  const fraction = lerpByte(definition.lookup.pixels, row.index * LOOKUP_SAMPLES * TEXEL_BYTES, texel, channel);
  return row.min + fraction * (row.max - row.min);
}
