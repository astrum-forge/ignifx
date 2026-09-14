import { array, bool, custom, enumOf, f32, i32, record, str, u32, vec2, vec3 } from "@ignifx/core";
import {
  PARTICLE_BLEND_MODES,
  PARTICLE_EMIT_FROM,
  PARTICLE_MESHES,
  PARTICLE_RENDER_MODES,
  PARTICLE_SHAPE_KINDS,
  PARTICLE_SIMULATION_SPACES,
  PARTICLES_FORMAT,
  PARTICLES_FORMAT_VERSION,
} from "./definition/types.js";
import type { FieldDefinition, JsonValue, Schema } from "@ignifx/core";

// The declarative schema for `.particles.json`, for documentation and tooling only: the loader
// validates with `defineParticles`, whose hand-written checks name the offending path. The "value"
// unions have no built-in field kind, so they are `custom()` fields carrying a JSON Schema fragment.

/** The JSON Schema fragment of a scalar value. */
const SCALAR_JSON_SCHEMA = {
  oneOf: [
    { type: "number" },
    {
      type: "object",
      properties: { min: { type: "number" }, max: { type: "number" } },
      required: ["min", "max"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        curve: {
          type: "object",
          properties: {
            keys: {
              type: "array",
              items: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
              minItems: 1,
            },
          },
          required: ["keys"],
        },
      },
      required: ["curve"],
      additionalProperties: false,
    },
  ],
};

/** The JSON Schema fragment of a colour. */
const COLOR_JSON_SCHEMA = {
  oneOf: [
    { type: "array", items: { type: "number" }, minItems: 3, maxItems: 4 },
    {
      type: "object",
      properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } },
      required: ["r", "g", "b"],
    },
  ],
};

/** The JSON Schema fragment of a colour value. */
const COLOR_VALUE_JSON_SCHEMA = {
  oneOf: [
    ...COLOR_JSON_SCHEMA.oneOf,
    {
      type: "object",
      properties: { min: COLOR_JSON_SCHEMA, max: COLOR_JSON_SCHEMA },
      required: ["min", "max"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        gradient: {
          type: "array",
          items: { type: "array", items: { type: "number" }, minItems: 5, maxItems: 5 },
          minItems: 1,
        },
      },
      required: ["gradient"],
      additionalProperties: false,
    },
  ],
};

/**
 * A scalar value field: a number, a range, or a curve.
 *
 * @param defaultValue - The document default.
 * @param tooltip - What the value means.
 * @returns The field definition.
 */
function scalarValue(defaultValue: JsonValue, tooltip: string): FieldDefinition<JsonValue> {
  return custom<JsonValue>(
    {
      createDefault: (): JsonValue => structuredClone(defaultValue),
      serialize: (value: JsonValue): JsonValue => value,
      deserialize: (json: JsonValue): JsonValue => json,
      jsonSchema: SCALAR_JSON_SCHEMA,
    },
    { tooltip },
  );
}

/**
 * A colour value field: a colour, a pair, or a gradient.
 *
 * @param defaultValue - The document default.
 * @param tooltip - What the value means.
 * @returns The field definition.
 */
function colorValue(defaultValue: JsonValue, tooltip: string): FieldDefinition<JsonValue> {
  return custom<JsonValue>(
    {
      createDefault: (): JsonValue => structuredClone(defaultValue),
      serialize: (value: JsonValue): JsonValue => value,
      deserialize: (json: JsonValue): JsonValue => json,
      jsonSchema: COLOR_VALUE_JSON_SCHEMA,
    },
    { tooltip },
  );
}

/**
 * The `ignifx.particles` document schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function particlesFileSchema(): Schema {
  // Not `defineSchema`: it refuses a field called `start` because a component schema becomes class
  // properties and `Script.start` already exists (`IGX-0607`). A file schema generates no class, and
  // `start` is the module name the format uses, so the check does not apply here.
  return {
    format: str(PARTICLES_FORMAT, { tooltip: "Always ignifx.particles." }),
    formatVersion: u32(PARTICLES_FORMAT_VERSION, { tooltip: "The document version this build reads." }),
    main: record(
      {
        capacity: u32(1000, {
          min: 1,
          tooltip: "How many spawn records the ring holds; older records are overwritten.",
        }),
        duration: f32(5, { min: 0.001, tooltip: "How long one emission cycle lasts, in seconds." }),
        looping: bool(true, { tooltip: "Whether the cycle repeats." }),
        prewarm: bool(false, { tooltip: "Whether play() fast-forwards one cycle first." }),
        startDelay: f32(0, { min: 0, tooltip: "Seconds after play() before emission starts." }),
        simulationSpace: enumOf(PARTICLE_SIMULATION_SPACES, "local", {
          tooltip: "local follows the entity; world stays put.",
        }),
        seed: u32(0, { tooltip: "The emission seed; 0 picks one at random." }),
        playOnAwake: bool(true, { tooltip: "Whether a ParticleSystem starts playing when enabled." }),
        timeScale: f32(1, { min: 0, tooltip: "A multiplier on the system's own clock." }),
        renderOrder: i32(0, { tooltip: "Sort key within the transparent phase; lower draws first." }),
      },
      { tooltip: "Capacity, timing, space, and playback." },
    ),
    emission: record(
      {
        rateOverTime: f32(10, { min: 0, tooltip: "Particles per second." }),
        rateOverDistance: f32(0, { min: 0, tooltip: "Particles per metre the emitter moves." }),
        bursts: array(
          record({
            time: f32(0, { min: 0, tooltip: "Seconds into the cycle." }),
            count: scalarValue(10, "How many particles; a range is rolled per firing."),
            cycles: u32(1, { tooltip: "Firings per cycle; 0 means until the cycle ends." }),
            interval: f32(0.1, { min: 0, tooltip: "Seconds between firings." }),
            probability: f32(1, { min: 0, max: 1, tooltip: "The chance a firing happens." }),
          }),
          [],
          { tooltip: "The bursts, in order." },
        ),
      },
      { tooltip: "Rates and bursts." },
    ),
    shape: record(
      {
        kind: enumOf(PARTICLE_SHAPE_KINDS, "cone", { tooltip: "Which shape; directional shapes emit along local +Y." }),
        radius: f32(0.2, { min: 0, tooltip: "Sphere, hemisphere, circle, or cone-base radius." }),
        thickness: f32(1, { min: 0, max: 1, tooltip: "How much of the radius emits: 0 is the surface, 1 the whole." }),
        arc: f32(360, { min: 0, max: 360, tooltip: "The angular span, in degrees." }),
        angle: f32(25, { min: 0, max: 90, tooltip: "A cone's half-angle, in degrees." }),
        length: f32(1, { min: 0, tooltip: "A cone's height, or an edge's length." }),
        size: vec3({ x: 1, y: 1, z: 1 }, { tooltip: "A box's full extents." }),
        emitFrom: enumOf(PARTICLE_EMIT_FROM, "volume", { tooltip: "volume, shell, or a cone's base." }),
        randomDirection: f32(0, { min: 0, max: 1, tooltip: "How much of the start direction is random." }),
        spherizeDirection: f32(0, {
          min: 0,
          max: 1,
          tooltip: "How much the start direction points away from the centre.",
        }),
        vertices: array(f32(), [], { tooltip: "A mesh shape's triangles, nine numbers per triangle." }),
      },
      { tooltip: "Where particles start and which way they go." },
    ),
    start: record(
      {
        lifetime: scalarValue(2, "Seconds a particle lives."),
        speed: scalarValue(2, "Metres per second along the start direction."),
        size: scalarValue(0.2, "The particle's size, in metres."),
        size3D: vec3({ x: 1, y: 1, z: 1 }, { tooltip: "Optional per-axis size multipliers." }),
        rotation: scalarValue(0, "The start rotation, in degrees."),
        color: colorValue([1, 1, 1, 1], "The start colour, sRGB; a range picks between two per particle."),
      },
      { tooltip: "What a particle is born with." },
    ),
    forces: record(
      {
        gravity: vec3({ x: 0, y: 0, z: 0 }, { tooltip: "An explicit world gravity; omit to scale the app's." }),
        gravityMultiplier: f32(0, { tooltip: "How much of the app's gravity applies." }),
        drag: f32(0, { min: 0, tooltip: "Linear drag; 0 is none." }),
        constantForce: vec3({ x: 0, y: 0, z: 0 }, { tooltip: "A constant acceleration in simulation space, m/s^2." }),
        orbit: record(
          {
            axis: vec3({ x: 0, y: 1, z: 0 }, { tooltip: "The orbit axis." }),
            speed: f32(90, { tooltip: "Degrees per second." }),
          },
          { tooltip: "A rotation about an axis through the emitter." },
        ),
        noise: record(
          {
            strength: f32(0.5, { min: 0, tooltip: "The largest offset, in metres." }),
            frequency: f32(1, { min: 0, tooltip: "How quickly the field varies with position." }),
            scroll: vec3({ x: 0, y: 0, z: 0 }, { tooltip: "How the field drifts with time." }),
            octaves: u32(1, { min: 1, max: 2, tooltip: "How many octaves are summed." }),
            influenceOverLife: scalarValue(1, "A multiplier on strength over the particle's life."),
          },
          { tooltip: "A positional noise offset." },
        ),
      },
      { tooltip: "What acts on a particle." },
    ),
    overLifetime: record(
      {
        color: colorValue([1, 1, 1, 1], "A gradient multiplied onto the start colour over life."),
        size: scalarValue(1, "A multiplier on the start size over life (X when sizeY or sizeZ is set)."),
        sizeY: scalarValue(1, "A separate Y multiplier over life."),
        sizeZ: scalarValue(1, "A separate Z multiplier over life."),
        rotation: scalarValue(0, "Angular speed in degrees per second."),
      },
      { tooltip: "How a particle changes over its life." },
    ),
    renderer: record(
      {
        mode: enumOf(PARTICLE_RENDER_MODES, "billboard", { tooltip: "How particles are oriented." }),
        mesh: enumOf(PARTICLE_MESHES, "box", { tooltip: "The primitive a mesh renderer draws." }),
        texture: str("", { tooltip: "The texture's asset address, or omitted for a procedural soft disc." }),
        sheet: record(
          {
            tiles: vec2({ x: 1, y: 1 }, { tooltip: "Columns and rows of the sprite sheet." }),
            frameOverTime: scalarValue(0, 'A curve over life, the string "random", or { fps }.'),
          },
          { tooltip: "The sprite-sheet layout of the texture." },
        ),
        blend: enumOf(PARTICLE_BLEND_MODES, "premultiplied", { tooltip: "How particles composite." }),
        lit: bool(false, { tooltip: "Shade with the main light and the ambient colour." }),
        pivot: vec2({ x: 0, y: 0 }, { tooltip: "Where the origin sits inside the quad, in size units." }),
        speedScale: f32(0, { min: 0, tooltip: "How much of the speed a stretched particle adds to its length." }),
        lengthScale: f32(1, { min: 0, tooltip: "A multiplier on a stretched particle's length." }),
      },
      { tooltip: "How a particle is drawn." },
    ),
  };
}
