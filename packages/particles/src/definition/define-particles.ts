import { ParticlesErrorCode, particlesError } from "../errors.js";
import {
  LOOKUP_SAMPLES,
  PARTICLE_BLEND_MODES,
  PARTICLE_EMIT_FROM,
  PARTICLE_MESHES,
  PARTICLE_RENDER_MODES,
  PARTICLE_SHAPE_KINDS,
  PARTICLE_SIMULATION_SPACES,
  PARTICLES_FORMAT,
  PARTICLES_FORMAT_VERSION,
} from "./types.js";
import { bakeCurve, bakeGradient, rowMax, rowMin, scalarMin } from "./values.js";
import type {
  ColorValue,
  GradientStop,
  LookupRow,
  ParticleBurst,
  ParticleDefinition,
  ParticleDefinitionInput,
  ParticleEmission,
  ParticleForces,
  ParticleLookup,
  ParticleMain,
  ParticleNoise,
  ParticleOrbit,
  ParticleOverLifetime,
  ParticleRenderer,
  ParticleShape,
  ParticleSheet,
  ParticleStart,
  ScalarValue,
} from "./types.js";
import type { ColorLike, CurveKey, CurveValue, IgnifxError, Vec2Like, Vec3Like } from "@ignifx/core";

// The one place a `.particles.json` is validated, defaulted and baked
// (`docs/plan/2026-09-terrain-particles-shaders.md` §4.2). The checks are hand-written so a failure
// names the exact path it broke; `src/file-schemas.ts` is the declarative copy, for documentation.

/** The largest capacity one definition may ask for; the budget in `app.particles` is what really limits it. */
const MAX_CAPACITY = 1_000_000;

/** The largest seed a `u32` holds. */
const MAX_SEED = 0xff_ff_ff_ff;

/** How many numbers one `"mesh"` triangle takes. */
const TRIANGLE_NUMBERS = 9;

/** Bytes per lookup texel. */
const TEXEL_BYTES = 4;

/** The keys a document may carry at the top level. */
const TOP_LEVEL_KEYS: readonly string[] = Object.freeze([
  "format",
  "formatVersion",
  "main",
  "emission",
  "shape",
  "start",
  "forces",
  "overLifetime",
  "renderer",
]);

/** The keys of the linear ramp a sheet's `frameOverTime` defaults to. */
const LINEAR_RAMP_KEYS: readonly CurveKey[] = Object.freeze([
  Object.freeze([0, 0, 1, 1] as const),
  Object.freeze([1, 1, 1, 1] as const),
]);

/** The linear ramp a sheet's `frameOverTime` defaults to. */
const LINEAR_RAMP: CurveValue = Object.freeze({ keys: LINEAR_RAMP_KEYS });

/** Opaque white, the start colour a document that names none gets. */
const WHITE: ColorLike = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/** What a number reader enforces. */
interface NumberRule {
  /** The smallest accepted value, inclusive. */
  readonly min?: number;
  /** The largest accepted value, inclusive. */
  readonly max?: number;
  /** Whether only integers are accepted. */
  readonly integer?: boolean;
}

/**
 * Fills in the defaults of a particle document, checks every rule the evaluators rely on, and bakes
 * its curves and gradients into the lookup rows both hosts sample.
 *
 * @param input - The document, as authored.
 * @param address - What to name in an error; defaults to `"<inline>"`.
 * @returns The complete, frozen definition.
 * @throws IgnifxError with code `IGX-1701`, naming the offending path, when the document is not
 * readable.
 *
 * @example
 * ```ts
 * const sparks = defineParticles({
 *   main: { capacity: 200, duration: 1, looping: false },
 *   emission: { rateOverTime: 0, bursts: [{ time: 0, count: 120 }] },
 *   start: { lifetime: { min: 0.4, max: 1 }, speed: { min: 3, max: 6 }, size: 0.04 },
 *   forces: { gravityMultiplier: 1, drag: 0.5 },
 *   renderer: { mode: "stretched", blend: "additive" },
 * });
 * ```
 *
 * @public
 */
export function defineParticles(input: ParticleDefinitionInput, address: string = "<inline>"): ParticleDefinition {
  const root = readObject(input, address, "document");
  assertKeys(root, TOP_LEVEL_KEYS, address, "");
  if (root["format"] !== undefined && root["format"] !== PARTICLES_FORMAT) {
    throw invalid(address, `format is ${show(root["format"])}, not ${PARTICLES_FORMAT}`);
  }
  const version = root["formatVersion"] ?? PARTICLES_FORMAT_VERSION;
  if (version !== PARTICLES_FORMAT_VERSION) {
    throw invalid(
      address,
      `formatVersion is ${show(version)}, and this build reads ${String(PARTICLES_FORMAT_VERSION)}`,
    );
  }
  const main = readMain(root["main"], address);
  const emission = readEmission(root["emission"], address);
  const shape = readShape(root["shape"], address);
  const start = readStart(root["start"], address);
  const forces = readForces(root["forces"], address);
  const overLifetime = readOverLifetime(root["overLifetime"], address);
  const renderer = readRenderer(root["renderer"], address);
  const lookup = bakeLookup(overLifetime, forces, renderer);
  return Object.freeze({
    format: PARTICLES_FORMAT,
    formatVersion: PARTICLES_FORMAT_VERSION,
    main,
    emission,
    shape,
    start,
    forces,
    overLifetime,
    renderer,
    lookup,
  });
}

/**
 * Builds the failure an invalid document produces.
 *
 * @param address - What to name in the message.
 * @param reason - The specific problem, as a sentence fragment.
 * @returns The error to throw.
 */
function invalid(address: string, reason: string): IgnifxError {
  return particlesError(
    ParticlesErrorCode.invalidParticlesFile,
    `${address} is not a valid ignifx.particles document: ${reason}.`,
    {
      context: { file: address, reason },
      hint: "See skills/ignifx/references/formats/ignifx.particles.md for the document shape.",
    },
  );
}

/**
 * Renders a rejected value for an error message, without an object stringifying to `[object Object]`.
 *
 * @param value - The raw value.
 * @returns A short description.
 */
function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Whether a value is a plain object.
 *
 * @param value - The value read out of the document.
 * @returns `true` when the value can be read as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows a raw value to an object.
 *
 * @param value - The raw value.
 * @param address - The document address, for the error.
 * @param path - What the value is, for the error.
 * @returns The record.
 */
function readObject(value: unknown, address: string, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalid(address, `${path} must be an object`);
  }
  return value;
}

/**
 * Refuses keys a module does not declare.
 *
 * @param record - The module.
 * @param allowed - Its keys.
 * @param address - The document address, for the error.
 * @param path - The module path, for the error.
 */
function assertKeys(record: Record<string, unknown>, allowed: readonly string[], address: string, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      const where = path === "" ? key : `${path}.${key}`;
      throw invalid(address, `${where} is not a field; the fields are ${allowed.join(", ")}`);
    }
  }
}

/**
 * Reads an optional number.
 *
 * @param value - The raw value.
 * @param fallback - What an absent key means.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @param rule - The range and integrality to enforce.
 * @returns The number.
 */
function readNumber(value: unknown, fallback: number, address: string, path: string, rule: NumberRule = {}): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(address, `${path} must be a finite number`);
  }
  checkNumber(value, address, path, rule);
  return value;
}

/**
 * Checks a number against a rule.
 *
 * @param value - The number.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @param rule - The range and integrality to enforce.
 */
function checkNumber(value: number, address: string, path: string, rule: NumberRule): void {
  if (rule.integer === true && !Number.isInteger(value)) {
    throw invalid(address, `${path} must be an integer`);
  }
  if (rule.min !== undefined && value < rule.min) {
    throw invalid(address, `${path} must be at least ${String(rule.min)}, not ${String(value)}`);
  }
  if (rule.max !== undefined && value > rule.max) {
    throw invalid(address, `${path} must be at most ${String(rule.max)}, not ${String(value)}`);
  }
}

/**
 * Reads an optional boolean.
 *
 * @param value - The raw value.
 * @param fallback - What an absent key means.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @returns The boolean.
 */
function readBoolean(value: unknown, fallback: boolean, address: string, path: string): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw invalid(address, `${path} must be true or false`);
  }
  return value;
}

/**
 * Reads an optional string out of a fixed set.
 *
 * @typeParam T - The literal union.
 * @param value - The raw value.
 * @param allowed - The accepted values.
 * @param fallback - What an absent key means.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @returns The literal.
 */
function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  address: string,
  path: string,
): T {
  if (value === undefined) {
    return fallback;
  }
  for (let index = 0; index < allowed.length; index += 1) {
    const candidate = allowed[index];
    if (candidate !== undefined && candidate === value) {
      return candidate;
    }
  }
  throw invalid(address, `${path} must be one of ${allowed.join(", ")}, not ${JSON.stringify(value)}`);
}

/**
 * Reads an optional 3D vector.
 *
 * @param value - The raw value.
 * @param fallback - What an absent key means.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @returns A fresh, frozen vector.
 */
function readVec3(value: unknown, fallback: Vec3Like, address: string, path: string): Vec3Like {
  if (value === undefined) {
    return Object.freeze({ x: fallback.x, y: fallback.y, z: fallback.z });
  }
  const record = readObject(value, address, path);
  assertKeys(record, ["x", "y", "z"], address, path);
  return Object.freeze({
    x: readNumber(record["x"], 0, address, `${path}.x`),
    y: readNumber(record["y"], 0, address, `${path}.y`),
    z: readNumber(record["z"], 0, address, `${path}.z`),
  });
}

/**
 * Reads an optional 2D vector.
 *
 * @param value - The raw value.
 * @param fallback - What an absent key means.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @returns A fresh, frozen vector.
 */
function readVec2(value: unknown, fallback: Vec2Like, address: string, path: string): Vec2Like {
  if (value === undefined) {
    return Object.freeze({ x: fallback.x, y: fallback.y });
  }
  const record = readObject(value, address, path);
  assertKeys(record, ["x", "y"], address, path);
  return Object.freeze({
    x: readNumber(record["x"], 0, address, `${path}.x`),
    y: readNumber(record["y"], 0, address, `${path}.y`),
  });
}

/**
 * Reads a curve: `{ keys: [[t, v, in, out], …] }` with at least one key, sorted by time.
 *
 * @param value - The raw value.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @returns The curve, frozen.
 */
function readCurve(value: unknown, address: string, path: string): CurveValue {
  const record = readObject(value, address, path);
  assertKeys(record, ["keys"], address, path);
  const raw = record["keys"];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw invalid(address, `${path}.keys must be a non-empty array of [time, value, inTangent, outTangent]`);
  }
  const keys: CurveKey[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < raw.length; index += 1) {
    const key: unknown = raw[index];
    if (!Array.isArray(key) || key.length !== 4) {
      throw invalid(address, `${path}.keys[${String(index)}] must be [time, value, inTangent, outTangent]`);
    }
    const numbers: number[] = [];
    for (let component = 0; component < 4; component += 1) {
      const element: unknown = key[component];
      if (typeof element !== "number" || !Number.isFinite(element)) {
        throw invalid(address, `${path}.keys[${String(index)}] must hold finite numbers`);
      }
      numbers.push(element);
    }
    const time = numbers[0] ?? 0;
    if (time < previous) {
      throw invalid(address, `${path}.keys must be sorted by time`);
    }
    previous = time;
    keys.push(Object.freeze([time, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 0]));
  }
  return Object.freeze({ keys: Object.freeze(keys) });
}

/**
 * Reads a scalar value: a number, `{ min, max }`, or `{ curve }`.
 *
 * @param value - The raw value.
 * @param fallback - What an absent key means.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @param rule - The range every produced value must stay inside.
 * @returns The resolved scalar.
 */
function readScalar(
  value: unknown,
  fallback: number,
  address: string,
  path: string,
  rule: NumberRule = {},
): ScalarValue {
  if (value === undefined) {
    return Object.freeze({ kind: "constant", value: fallback });
  }
  if (typeof value === "number") {
    return Object.freeze({ kind: "constant", value: readNumber(value, fallback, address, path, rule) });
  }
  const record = readObject(value, address, path);
  if ("curve" in record) {
    assertKeys(record, ["curve"], address, path);
    const curve = readCurve(record["curve"], address, `${path}.curve`);
    const samples = bakeCurve(curve);
    checkNumber(rowMin(samples), address, `${path}.curve`, { ...rule, integer: false });
    checkNumber(rowMax(samples), address, `${path}.curve`, { ...rule, integer: false });
    return Object.freeze({ kind: "curve", curve, samples });
  }
  assertKeys(record, ["min", "max"], address, path);
  if (record["min"] === undefined || record["max"] === undefined) {
    throw invalid(address, `${path} must be a number, { min, max }, or { curve }`);
  }
  return Object.freeze({
    kind: "random",
    min: readNumber(record["min"], 0, address, `${path}.min`, rule),
    max: readNumber(record["max"], 0, address, `${path}.max`, rule),
  });
}

/**
 * Reads one colour: `[r, g, b, a]` or `{ r, g, b, a }`, sRGB.
 *
 * @param value - The raw value.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @param max - The largest accepted channel, or `undefined` for HDR-friendly no bound.
 * @returns The colour, frozen.
 */
function readColor(value: unknown, address: string, path: string, max?: number): ColorLike {
  const channel = (raw: unknown, name: string, fallback: number, cap: number | undefined): number => {
    const rule: NumberRule = cap === undefined ? { min: 0 } : { min: 0, max: cap };
    return readNumber(raw, fallback, address, `${path}.${name}`, rule);
  };
  if (Array.isArray(value)) {
    if (value.length !== 4 && value.length !== 3) {
      throw invalid(address, `${path} must be [r, g, b, a]`);
    }
    return Object.freeze({
      r: channel(value[0], "r", 1, max),
      g: channel(value[1], "g", 1, max),
      b: channel(value[2], "b", 1, max),
      a: channel(value[3], "a", 1, 1),
    });
  }
  const record = readObject(value, address, path);
  assertKeys(record, ["r", "g", "b", "a"], address, path);
  return Object.freeze({
    r: channel(record["r"], "r", 1, max),
    g: channel(record["g"], "g", 1, max),
    b: channel(record["b"], "b", 1, max),
    a: channel(record["a"], "a", 1, 1),
  });
}

/**
 * Reads a gradient's stops.
 *
 * @param value - The raw value.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @returns The stops, frozen and sorted.
 */
function readGradient(value: unknown, address: string, path: string): readonly GradientStop[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid(address, `${path} must be a non-empty array of [t, r, g, b, a] stops`);
  }
  const stops: GradientStop[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < value.length; index += 1) {
    const stop: unknown = value[index];
    if (!Array.isArray(stop) || stop.length !== 5) {
      throw invalid(address, `${path}[${String(index)}] must be [t, r, g, b, a]`);
    }
    const numbers: number[] = [];
    for (let component = 0; component < 5; component += 1) {
      const element: unknown = stop[component];
      if (typeof element !== "number" || !Number.isFinite(element) || element < 0 || element > 1) {
        throw invalid(address, `${path}[${String(index)}] must hold numbers in 0..1`);
      }
      numbers.push(element);
    }
    const time = numbers[0] ?? 0;
    if (time < previous) {
      throw invalid(address, `${path} stops must be sorted by time`);
    }
    previous = time;
    stops.push(Object.freeze([time, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 0, numbers[4] ?? 1]));
  }
  return Object.freeze(stops);
}

/**
 * Reads a colour value: a colour, `{ min, max }`, or `{ gradient }`.
 *
 * @param value - The raw value.
 * @param fallback - What an absent key means.
 * @param address - The document address, for the error.
 * @param path - The field path, for the error.
 * @param allowRandom - Whether `{ min, max }` is meaningful here.
 * @returns The resolved colour value.
 */
function readColorValue(
  value: unknown,
  fallback: ColorLike,
  address: string,
  path: string,
  allowRandom: boolean,
): ColorValue {
  if (value === undefined) {
    return Object.freeze({ kind: "constant", value: fallback });
  }
  if (isRecord(value) && "gradient" in value) {
    assertKeys(value, ["gradient"], address, path);
    const stops = readGradient(value["gradient"], address, `${path}.gradient`);
    return Object.freeze({ kind: "gradient", stops, samples: bakeGradient(stops) });
  }
  if (isRecord(value) && ("min" in value || "max" in value)) {
    if (!allowRandom) {
      throw invalid(address, `${path} must be a colour or a gradient; a random colour has no meaning over a lifetime`);
    }
    assertKeys(value, ["min", "max"], address, path);
    return Object.freeze({
      kind: "random",
      min: readColor(value["min"], address, `${path}.min`),
      max: readColor(value["max"], address, `${path}.max`),
    });
  }
  return Object.freeze({ kind: "constant", value: readColor(value, address, path, allowRandom ? undefined : 1) });
}

/**
 * Reads the `main` module.
 *
 * @param value - The raw module.
 * @param address - The document address, for errors.
 * @returns The module.
 */
function readMain(value: unknown, address: string): ParticleMain {
  const record = value === undefined ? {} : readObject(value, address, "main");
  assertKeys(
    record,
    [
      "capacity",
      "duration",
      "looping",
      "prewarm",
      "startDelay",
      "simulationSpace",
      "seed",
      "playOnAwake",
      "timeScale",
      "renderOrder",
    ],
    address,
    "main",
  );
  return Object.freeze({
    capacity: readNumber(record["capacity"], 1000, address, "main.capacity", {
      min: 1,
      max: MAX_CAPACITY,
      integer: true,
    }),
    duration: readNumber(record["duration"], 5, address, "main.duration", { min: 0.001 }),
    looping: readBoolean(record["looping"], true, address, "main.looping"),
    prewarm: readBoolean(record["prewarm"], false, address, "main.prewarm"),
    startDelay: readNumber(record["startDelay"], 0, address, "main.startDelay", { min: 0 }),
    simulationSpace: readEnum(
      record["simulationSpace"],
      PARTICLE_SIMULATION_SPACES,
      "local",
      address,
      "main.simulationSpace",
    ),
    seed: readNumber(record["seed"], 0, address, "main.seed", { min: 0, max: MAX_SEED, integer: true }),
    playOnAwake: readBoolean(record["playOnAwake"], true, address, "main.playOnAwake"),
    timeScale: readNumber(record["timeScale"], 1, address, "main.timeScale", { min: 0 }),
    renderOrder: readNumber(record["renderOrder"], 0, address, "main.renderOrder", { integer: true }),
  });
}

/**
 * Reads the `emission` module.
 *
 * @param value - The raw module.
 * @param address - The document address, for errors.
 * @returns The module.
 */
function readEmission(value: unknown, address: string): ParticleEmission {
  const record = value === undefined ? {} : readObject(value, address, "emission");
  assertKeys(record, ["rateOverTime", "rateOverDistance", "bursts"], address, "emission");
  const rawBursts = record["bursts"];
  const bursts: ParticleBurst[] = [];
  if (rawBursts !== undefined) {
    if (!Array.isArray(rawBursts)) {
      throw invalid(address, "emission.bursts must be an array");
    }
    for (let index = 0; index < rawBursts.length; index += 1) {
      const path = `emission.bursts[${String(index)}]`;
      const burst = readObject(rawBursts[index], address, path);
      assertKeys(burst, ["time", "count", "cycles", "interval", "probability"], address, path);
      bursts.push(
        Object.freeze({
          time: readNumber(burst["time"], 0, address, `${path}.time`, { min: 0 }),
          count: readScalar(burst["count"], 10, address, `${path}.count`, { min: 0 }),
          cycles: readNumber(burst["cycles"], 1, address, `${path}.cycles`, { min: 0, integer: true }),
          interval: readNumber(burst["interval"], 0.1, address, `${path}.interval`, { min: 0 }),
          probability: readNumber(burst["probability"], 1, address, `${path}.probability`, { min: 0, max: 1 }),
        }),
      );
    }
  }
  return Object.freeze({
    rateOverTime: readNumber(record["rateOverTime"], 10, address, "emission.rateOverTime", { min: 0 }),
    rateOverDistance: readNumber(record["rateOverDistance"], 0, address, "emission.rateOverDistance", { min: 0 }),
    bursts: Object.freeze(bursts),
  });
}

/**
 * Reads the `shape` module.
 *
 * @param value - The raw module.
 * @param address - The document address, for errors.
 * @returns The module.
 */
function readShape(value: unknown, address: string): ParticleShape {
  const record = value === undefined ? {} : readObject(value, address, "shape");
  assertKeys(
    record,
    [
      "kind",
      "radius",
      "thickness",
      "arc",
      "angle",
      "length",
      "size",
      "emitFrom",
      "randomDirection",
      "spherizeDirection",
      "vertices",
    ],
    address,
    "shape",
  );
  const kind = readEnum(record["kind"], PARTICLE_SHAPE_KINDS, "cone", address, "shape.kind");
  const rawVertices = record["vertices"];
  let vertices = new Float32Array(0);
  if (rawVertices !== undefined) {
    if (!Array.isArray(rawVertices) || rawVertices.length % TRIANGLE_NUMBERS !== 0) {
      throw invalid(address, "shape.vertices must hold nine numbers per triangle");
    }
    vertices = new Float32Array(rawVertices.length);
    for (let index = 0; index < rawVertices.length; index += 1) {
      const element: unknown = rawVertices[index];
      if (typeof element !== "number" || !Number.isFinite(element)) {
        throw invalid(address, `shape.vertices[${String(index)}] must be a finite number`);
      }
      vertices[index] = element;
    }
  }
  if (kind === "mesh" && vertices.length === 0) {
    throw invalid(address, "a mesh shape needs shape.vertices with at least one triangle");
  }
  return Object.freeze({
    kind,
    radius: readNumber(record["radius"], 0.2, address, "shape.radius", { min: 0 }),
    thickness: readNumber(record["thickness"], 1, address, "shape.thickness", { min: 0, max: 1 }),
    arc: readNumber(record["arc"], 360, address, "shape.arc", { min: 0, max: 360 }),
    angle: readNumber(record["angle"], 25, address, "shape.angle", { min: 0, max: 90 }),
    length: readNumber(record["length"], 1, address, "shape.length", { min: 0 }),
    size: readVec3(record["size"], { x: 1, y: 1, z: 1 }, address, "shape.size"),
    emitFrom: readEnum(
      record["emitFrom"],
      PARTICLE_EMIT_FROM,
      kind === "cone" ? "base" : "volume",
      address,
      "shape.emitFrom",
    ),
    randomDirection: readNumber(record["randomDirection"], 0, address, "shape.randomDirection", { min: 0, max: 1 }),
    spherizeDirection: readNumber(record["spherizeDirection"], 0, address, "shape.spherizeDirection", {
      min: 0,
      max: 1,
    }),
    vertices,
  });
}

/**
 * Reads the `start` module.
 *
 * @param value - The raw module.
 * @param address - The document address, for errors.
 * @returns The module.
 */
function readStart(value: unknown, address: string): ParticleStart {
  const record = value === undefined ? {} : readObject(value, address, "start");
  assertKeys(record, ["lifetime", "speed", "size", "size3D", "rotation", "color"], address, "start");
  const lifetime = readScalar(record["lifetime"], 2, address, "start.lifetime", { min: 0 });
  if (scalarMin(lifetime) <= 0) {
    throw invalid(address, "start.lifetime must stay above zero");
  }
  const rawSize3D = record["size3D"];
  return Object.freeze({
    lifetime,
    speed: readScalar(record["speed"], 2, address, "start.speed"),
    size: readScalar(record["size"], 0.2, address, "start.size", { min: 0 }),
    size3D:
      rawSize3D === undefined || rawSize3D === null
        ? null
        : readVec3(rawSize3D, { x: 1, y: 1, z: 1 }, address, "start.size3D"),
    rotation: readScalar(record["rotation"], 0, address, "start.rotation"),
    color: readColorValue(record["color"], WHITE, address, "start.color", true),
  });
}

/**
 * Reads the `forces` module.
 *
 * @param value - The raw module.
 * @param address - The document address, for errors.
 * @returns The module.
 */
function readForces(value: unknown, address: string): ParticleForces {
  const record = value === undefined ? {} : readObject(value, address, "forces");
  assertKeys(record, ["gravity", "gravityMultiplier", "drag", "constantForce", "orbit", "noise"], address, "forces");
  const rawGravity = record["gravity"];
  const rawOrbit = record["orbit"];
  const rawNoise = record["noise"];
  return Object.freeze({
    gravity:
      rawGravity === undefined || rawGravity === null
        ? null
        : readVec3(rawGravity, { x: 0, y: 0, z: 0 }, address, "forces.gravity"),
    gravityMultiplier: readNumber(record["gravityMultiplier"], 0, address, "forces.gravityMultiplier"),
    drag: readNumber(record["drag"], 0, address, "forces.drag", { min: 0 }),
    constantForce: readVec3(record["constantForce"], { x: 0, y: 0, z: 0 }, address, "forces.constantForce"),
    orbit: rawOrbit === undefined || rawOrbit === null ? null : readOrbit(rawOrbit, address),
    noise: rawNoise === undefined || rawNoise === null ? null : readNoise(rawNoise, address),
  });
}

/**
 * Reads `forces.orbit`.
 *
 * @param value - The raw record.
 * @param address - The document address, for errors.
 * @returns The orbit, with its axis normalized.
 */
function readOrbit(value: unknown, address: string): ParticleOrbit {
  const record = readObject(value, address, "forces.orbit");
  assertKeys(record, ["axis", "speed"], address, "forces.orbit");
  const axis = readVec3(record["axis"], { x: 0, y: 1, z: 0 }, address, "forces.orbit.axis");
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length === 0) {
    throw invalid(address, "forces.orbit.axis must not be the zero vector");
  }
  return Object.freeze({
    axis: Object.freeze({ x: axis.x / length, y: axis.y / length, z: axis.z / length }),
    speed: readNumber(record["speed"], 90, address, "forces.orbit.speed"),
  });
}

/**
 * Reads `forces.noise`.
 *
 * @param value - The raw record.
 * @param address - The document address, for errors.
 * @returns The noise settings.
 */
function readNoise(value: unknown, address: string): ParticleNoise {
  const record = readObject(value, address, "forces.noise");
  assertKeys(record, ["strength", "frequency", "scroll", "octaves", "influenceOverLife"], address, "forces.noise");
  const influence = readScalar(record["influenceOverLife"], 1, address, "forces.noise.influenceOverLife", { min: 0 });
  if (influence.kind === "random") {
    throw invalid(address, "forces.noise.influenceOverLife must be a number or a curve");
  }
  return Object.freeze({
    strength: readNumber(record["strength"], 0.5, address, "forces.noise.strength", { min: 0 }),
    frequency: readNumber(record["frequency"], 1, address, "forces.noise.frequency", { min: 0 }),
    scroll: readVec3(record["scroll"], { x: 0, y: 0, z: 0 }, address, "forces.noise.scroll"),
    octaves: readNumber(record["octaves"], 1, address, "forces.noise.octaves", { min: 1, max: 2, integer: true }),
    influenceOverLife: influence,
  });
}

/**
 * Reads the `overLifetime` module.
 *
 * @param value - The raw module.
 * @param address - The document address, for errors.
 * @returns The module.
 */
function readOverLifetime(value: unknown, address: string): ParticleOverLifetime {
  const record = value === undefined ? {} : readObject(value, address, "overLifetime");
  assertKeys(record, ["color", "size", "sizeY", "sizeZ", "rotation"], address, "overLifetime");
  // Size and colour are read at the particle's age, so a random pick there would mean nothing.
  // Angular speed is picked once at spawn, so `{ min, max }` is meaningful and allowed.
  const optionalScalar = (key: string, rule: NumberRule, allowRandom: boolean): ScalarValue | null => {
    const raw = record[key];
    if (raw === undefined || raw === null) {
      return null;
    }
    const scalar = readScalar(raw, 1, address, `overLifetime.${key}`, rule);
    if (!allowRandom && scalar.kind === "random") {
      throw invalid(address, `overLifetime.${key} must be a number or a curve; it is a function of the particle's age`);
    }
    return scalar;
  };
  const rawColor = record["color"];
  return Object.freeze({
    color:
      rawColor === undefined || rawColor === null
        ? null
        : readColorValue(rawColor, WHITE, address, "overLifetime.color", false),
    size: optionalScalar("size", { min: 0 }, false),
    sizeY: optionalScalar("sizeY", { min: 0 }, false),
    sizeZ: optionalScalar("sizeZ", { min: 0 }, false),
    rotation: optionalScalar("rotation", {}, true),
  });
}

/**
 * Reads the `renderer` module.
 *
 * @param value - The raw module.
 * @param address - The document address, for errors.
 * @returns The module.
 */
function readRenderer(value: unknown, address: string): ParticleRenderer {
  const record = value === undefined ? {} : readObject(value, address, "renderer");
  assertKeys(
    record,
    ["mode", "mesh", "texture", "sheet", "blend", "lit", "pivot", "speedScale", "lengthScale"],
    address,
    "renderer",
  );
  const rawTexture = record["texture"];
  if (rawTexture !== undefined && rawTexture !== null && (typeof rawTexture !== "string" || rawTexture.length === 0)) {
    throw invalid(address, "renderer.texture must be a non-empty asset address or null");
  }
  const rawSheet = record["sheet"];
  return Object.freeze({
    mode: readEnum(record["mode"], PARTICLE_RENDER_MODES, "billboard", address, "renderer.mode"),
    mesh: readEnum(record["mesh"], PARTICLE_MESHES, "box", address, "renderer.mesh"),
    texture: typeof rawTexture === "string" ? rawTexture : null,
    sheet: rawSheet === undefined || rawSheet === null ? null : readSheet(rawSheet, address),
    blend: readEnum(record["blend"], PARTICLE_BLEND_MODES, "premultiplied", address, "renderer.blend"),
    lit: readBoolean(record["lit"], false, address, "renderer.lit"),
    pivot: readVec2(record["pivot"], { x: 0, y: 0 }, address, "renderer.pivot"),
    speedScale: readNumber(record["speedScale"], 0, address, "renderer.speedScale", { min: 0 }),
    lengthScale: readNumber(record["lengthScale"], 1, address, "renderer.lengthScale", { min: 0 }),
  });
}

/**
 * Reads `renderer.sheet`.
 *
 * @param value - The raw record.
 * @param address - The document address, for errors.
 * @returns The sheet.
 */
function readSheet(value: unknown, address: string): ParticleSheet {
  const record = readObject(value, address, "renderer.sheet");
  assertKeys(record, ["tiles", "frameOverTime"], address, "renderer.sheet");
  const tiles = readVec2(record["tiles"], { x: 1, y: 1 }, address, "renderer.sheet.tiles");
  checkNumber(tiles.x, address, "renderer.sheet.tiles.x", { min: 1, integer: true });
  checkNumber(tiles.y, address, "renderer.sheet.tiles.y", { min: 1, integer: true });
  const raw = record["frameOverTime"];
  if (raw === "random") {
    return Object.freeze({ tiles, mode: "random", frameOverTime: linearRamp(), fps: 0 });
  }
  if (isRecord(raw) && "fps" in raw) {
    assertKeys(raw, ["fps"], address, "renderer.sheet.frameOverTime");
    return Object.freeze({
      tiles,
      mode: "fps",
      frameOverTime: linearRamp(),
      fps: readNumber(raw["fps"], 12, address, "renderer.sheet.frameOverTime.fps", { min: 0 }),
    });
  }
  const frame =
    raw === undefined ? linearRamp() : readScalar(raw, 0, address, "renderer.sheet.frameOverTime", { min: 0, max: 1 });
  if (frame.kind === "random") {
    throw invalid(address, 'renderer.sheet.frameOverTime must be a curve, a number, "random", or { fps }');
  }
  return Object.freeze({ tiles, mode: "curve", frameOverTime: frame, fps: 0 });
}

/**
 * The default sheet ramp, as a baked scalar.
 *
 * @returns A fresh curve scalar running linearly from `0` to `1`.
 */
function linearRamp(): ScalarValue {
  return Object.freeze({ kind: "curve", curve: LINEAR_RAMP, samples: bakeCurve(LINEAR_RAMP) });
}

/** A row waiting to be written into the lookup texture. */
interface PendingRow {
  /** The bytes of the row, `LOOKUP_SAMPLES * 4`. */
  readonly bytes: Uint8Array;
  /** The decode range. */
  readonly min: number;
  /** The decode range. */
  readonly max: number;
}

/**
 * Bakes the lookup texture: one row per curve or gradient the definition uses, in the fixed order
 * colour, size, rotation, noise influence, sheet frame.
 *
 * @param overLifetime - The over-lifetime module.
 * @param forces - The forces module, for the noise influence.
 * @param renderer - The renderer module, for the sheet frame.
 * @returns The lookup.
 */
function bakeLookup(
  overLifetime: ParticleOverLifetime,
  forces: ParticleForces,
  renderer: ParticleRenderer,
): ParticleLookup {
  const pending: PendingRow[] = [];
  const color = overLifetime.color === null ? null : pushRow(pending, colorRow(overLifetime.color));
  const size =
    overLifetime.size === null && overLifetime.sizeY === null && overLifetime.sizeZ === null
      ? null
      : pushRow(pending, sizeRow(overLifetime.size, overLifetime.sizeY, overLifetime.sizeZ));
  const rotation =
    overLifetime.rotation === null || overLifetime.rotation.kind !== "curve"
      ? null
      : pushRow(pending, scalarRow(overLifetime.rotation.samples));
  const noise =
    forces.noise === null || forces.noise.influenceOverLife.kind !== "curve"
      ? null
      : pushRow(pending, scalarRow(forces.noise.influenceOverLife.samples));
  const sheet = renderer.sheet;
  const frame =
    sheet === null || sheet.mode !== "curve"
      ? null
      : pushRow(
          pending,
          scalarRow(
            sheet.frameOverTime.kind === "curve" ? sheet.frameOverTime.samples : constantSamples(sheet.frameOverTime),
          ),
        );
  if (pending.length === 0) {
    const white = new Uint8Array(LOOKUP_SAMPLES * TEXEL_BYTES);
    white.fill(255);
    pending.push({ bytes: white, min: 0, max: 1 });
  }
  const pixels = new Uint8Array(pending.length * LOOKUP_SAMPLES * TEXEL_BYTES);
  for (let index = 0; index < pending.length; index += 1) {
    const row = pending[index];
    if (row !== undefined) {
      pixels.set(row.bytes, index * LOOKUP_SAMPLES * TEXEL_BYTES);
    }
  }
  return Object.freeze({ rows: pending.length, pixels, color, size, rotation, noise, frame });
}

/**
 * Appends a row and returns its descriptor.
 *
 * @param pending - The rows so far.
 * @param row - The row to add.
 * @returns The descriptor naming the row's index and decode range.
 */
function pushRow(pending: PendingRow[], row: PendingRow): LookupRow {
  const index = pending.length;
  pending.push(row);
  return Object.freeze({ index, min: row.min, max: row.max });
}

/**
 * The samples a constant or curve scalar produces over `[0, 1]`.
 *
 * @param value - The scalar; a `"random"` value never reaches here.
 * @returns The samples.
 */
function constantSamples(value: ScalarValue): Float32Array {
  const samples = new Float32Array(LOOKUP_SAMPLES);
  const constant = value.kind === "constant" ? value.value : value.kind === "random" ? value.min : 0;
  samples.fill(constant);
  return samples;
}

/**
 * Builds a colour row: sRGB bytes and straight alpha, one gradient sample per texel.
 *
 * @param value - The colour value.
 * @returns The row.
 */
function colorRow(value: ColorValue): PendingRow {
  const bytes = new Uint8Array(LOOKUP_SAMPLES * TEXEL_BYTES);
  for (let index = 0; index < LOOKUP_SAMPLES; index += 1) {
    const base = index * TEXEL_BYTES;
    if (value.kind === "gradient") {
      bytes[base] = toByte(value.samples[base] ?? 0);
      bytes[base + 1] = toByte(value.samples[base + 1] ?? 0);
      bytes[base + 2] = toByte(value.samples[base + 2] ?? 0);
      bytes[base + 3] = toByte(value.samples[base + 3] ?? 1);
    } else {
      const color = value.kind === "constant" ? value.value : value.min;
      bytes[base] = toByte(color.r);
      bytes[base + 1] = toByte(color.g);
      bytes[base + 2] = toByte(color.b);
      bytes[base + 3] = toByte(color.a);
    }
  }
  return { bytes, min: 0, max: 1 };
}

/**
 * Builds the size row: X in red, Y in green, Z in blue, all quantized between the shared range.
 *
 * @param size - The X (or uniform) multiplier, or `null` for one.
 * @param sizeY - The Y multiplier, or `null` to follow X.
 * @param sizeZ - The Z multiplier, or `null` to follow X.
 * @returns The row.
 */
function sizeRow(size: ScalarValue | null, sizeY: ScalarValue | null, sizeZ: ScalarValue | null): PendingRow {
  const x = size === null ? filled(1) : samplesOf(size);
  const y = sizeY === null ? x : samplesOf(sizeY);
  const z = sizeZ === null ? x : samplesOf(sizeZ);
  const min = Math.min(rowMin(x), rowMin(y), rowMin(z));
  const max = Math.max(rowMax(x), rowMax(y), rowMax(z));
  const range = decodeRange(min, max);
  const bytes = new Uint8Array(LOOKUP_SAMPLES * TEXEL_BYTES);
  for (let index = 0; index < LOOKUP_SAMPLES; index += 1) {
    const base = index * TEXEL_BYTES;
    bytes[base] = quantize(x[index] ?? 0, range.min, range.max);
    bytes[base + 1] = quantize(y[index] ?? 0, range.min, range.max);
    bytes[base + 2] = quantize(z[index] ?? 0, range.min, range.max);
    bytes[base + 3] = 255;
  }
  return { bytes, min: range.min, max: range.max };
}

/**
 * Builds a scalar row: the value quantized between its own minimum and maximum in every channel.
 *
 * @param samples - The baked samples.
 * @returns The row.
 */
function scalarRow(samples: Float32Array): PendingRow {
  const range = decodeRange(rowMin(samples), rowMax(samples));
  const bytes = new Uint8Array(LOOKUP_SAMPLES * TEXEL_BYTES);
  for (let index = 0; index < LOOKUP_SAMPLES; index += 1) {
    const byte = quantize(samples[index] ?? 0, range.min, range.max);
    const base = index * TEXEL_BYTES;
    bytes[base] = byte;
    bytes[base + 1] = byte;
    bytes[base + 2] = byte;
    bytes[base + 3] = 255;
  }
  return { bytes, min: range.min, max: range.max };
}

/**
 * The samples of a constant or curve scalar.
 *
 * @param value - The scalar.
 * @returns Its samples.
 */
function samplesOf(value: ScalarValue): Float32Array {
  return value.kind === "curve" ? value.samples : constantSamples(value);
}

/**
 * A row filled with one value.
 *
 * @param value - The value.
 * @returns The samples.
 */
function filled(value: number): Float32Array {
  const samples = new Float32Array(LOOKUP_SAMPLES);
  samples.fill(value);
  return samples;
}

/**
 * A decode range that never divides by zero: a flat row decodes to its constant.
 *
 * @param min - The row's minimum.
 * @param max - The row's maximum.
 * @returns The range.
 */
function decodeRange(min: number, max: number): { readonly min: number; readonly max: number } {
  return max > min ? { min, max } : { min, max: min + 1 };
}

/**
 * Quantizes a value into a byte between a range.
 *
 * @param value - The value.
 * @param min - What `0` means.
 * @param max - What `255` means.
 * @returns The byte.
 */
function quantize(value: number, min: number, max: number): number {
  return toByte((value - min) / (max - min));
}

/**
 * Rounds a `0`–`1` fraction to a byte.
 *
 * @param fraction - The fraction.
 * @returns The byte, clamped.
 */
function toByte(fraction: number): number {
  const scaled = Math.round(fraction * 255);
  return scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
}
