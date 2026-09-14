import type { ColorLike, CurveValue, Vec2Like, Vec3Like } from "@ignifx/core";

// The `ignifx.particles` document (`docs/plan/2026-09-terrain-particles-shaders.md` §4.2) as
// `defineParticles` hands it back: every module present, every default filled in, every curve and
// gradient baked. It is pure data, and both evaluators read it.

/**
 * The `format` discriminator every `.particles.json` document carries.
 *
 * @public
 */
export const PARTICLES_FORMAT = "ignifx.particles";

/**
 * The document version this build reads and writes.
 *
 * @public
 */
export const PARTICLES_FORMAT_VERSION = 1;

/**
 * The asset type name the loader registers.
 *
 * @public
 */
export const PARTICLE_ASSET_TYPE = "particles";

/**
 * The address suffixes that select the particle loader.
 *
 * @public
 */
export const PARTICLE_FILE_EXTENSIONS: readonly string[] = Object.freeze([".particles.json"]);

/**
 * How many samples a baked curve or gradient row holds. Both evaluators read the same 64 samples
 * with the same linear rule, which is what makes the lookup the contract between them.
 *
 * @public
 */
export const LOOKUP_SAMPLES = 64;

/**
 * Where a particle's position is integrated: in the emitter's space and transformed by the emitter's
 * current world matrix at draw (`"local"`, so the effect follows its entity), or baked into world
 * space at spawn (`"world"`, so a trail stays where it was emitted).
 *
 * @public
 */
export const PARTICLE_SIMULATION_SPACES = ["local", "world"] as const;

/**
 * The union of {@link PARTICLE_SIMULATION_SPACES}.
 *
 * @public
 */
export type ParticleSimulationSpace = (typeof PARTICLE_SIMULATION_SPACES)[number];

/**
 * Every emitter shape. Directional shapes emit along the emitter's local `+Y`.
 *
 * @public
 */
export const PARTICLE_SHAPE_KINDS = ["point", "sphere", "hemisphere", "cone", "box", "circle", "edge", "mesh"] as const;

/**
 * The union of {@link PARTICLE_SHAPE_KINDS}.
 *
 * @public
 */
export type ParticleShapeKind = (typeof PARTICLE_SHAPE_KINDS)[number];

/**
 * Where inside a shape particles start: anywhere in it, on its surface, or — for a cone — on its
 * base disc.
 *
 * @public
 */
export const PARTICLE_EMIT_FROM = ["volume", "shell", "base"] as const;

/**
 * The union of {@link PARTICLE_EMIT_FROM}.
 *
 * @public
 */
export type ParticleEmitFrom = (typeof PARTICLE_EMIT_FROM)[number];

/**
 * How a particle is oriented when drawn.
 *
 * @public
 */
export const PARTICLE_RENDER_MODES = ["billboard", "stretched", "horizontal", "vertical", "mesh"] as const;

/**
 * The union of {@link PARTICLE_RENDER_MODES}.
 *
 * @public
 */
export type ParticleRenderMode = (typeof PARTICLE_RENDER_MODES)[number];

/**
 * How particles composite over what is behind them. `premultiplied` is the default: fire and smoke
 * share one draw and blend front-to-back correctly.
 *
 * @public
 */
export const PARTICLE_BLEND_MODES = ["premultiplied", "additive", "alpha"] as const;

/**
 * The union of {@link PARTICLE_BLEND_MODES}.
 *
 * @public
 */
export type ParticleBlendMode = (typeof PARTICLE_BLEND_MODES)[number];

/**
 * The core primitives a `"mesh"` renderer may draw, each built at unit size.
 *
 * @public
 */
export const PARTICLE_MESHES = ["box", "sphere", "plane", "cylinder", "capsule", "torus"] as const;

/**
 * The union of {@link PARTICLE_MESHES}.
 *
 * @public
 */
export type ParticleMeshName = (typeof PARTICLE_MESHES)[number];

/**
 * How a sprite sheet picks its frame: from a curve over the particle's life, at random per particle,
 * or advancing at a fixed rate.
 *
 * @public
 */
export const PARTICLE_FRAME_MODES = ["curve", "random", "fps"] as const;

/**
 * The union of {@link PARTICLE_FRAME_MODES}.
 *
 * @public
 */
export type ParticleFrameMode = (typeof PARTICLE_FRAME_MODES)[number];

/**
 * One stop of a colour gradient: normalized time, then sRGB red, green, blue, and alpha in `0`–`1`.
 *
 * @public
 */
export type GradientStop = readonly [t: number, r: number, g: number, b: number, a: number];

/**
 * A number a document may give as a constant, a range, or a curve. As authored:
 * `2`, `{ "min": 1, "max": 3 }`, or `{ "curve": { "keys": [[0, 1, 0, 0], [1, 0, 0, 0]] } }`.
 *
 * @public
 */
export type ScalarValueInput = number | { readonly min: number; readonly max: number } | { readonly curve: CurveValue };

/**
 * A colour as a document may write it: an `{ r, g, b, a }` object or an `[r, g, b, a]` array, both
 * sRGB in `0`–`1`.
 *
 * @public
 */
export type ColorInput = ColorLike | readonly [r: number, g: number, b: number, a: number];

/**
 * A colour a document may give as a constant, a random pick between two, or a gradient.
 *
 * @public
 */
export type ColorValueInput =
  | ColorInput
  | { readonly min: ColorInput; readonly max: ColorInput }
  | { readonly gradient: readonly GradientStop[] };

/**
 * A resolved scalar value. A `"curve"` carries its {@link LOOKUP_SAMPLES} baked samples so the CPU
 * side never re-evaluates the Hermite spline.
 *
 * @public
 */
export type ScalarValue =
  | { readonly kind: "constant"; readonly value: number }
  | { readonly kind: "random"; readonly min: number; readonly max: number }
  | { readonly kind: "curve"; readonly curve: CurveValue; readonly samples: Float32Array };

/**
 * A resolved colour value. A `"gradient"` carries its baked RGBA samples, sRGB, four floats per
 * sample.
 *
 * @public
 */
export type ColorValue =
  | { readonly kind: "constant"; readonly value: ColorLike }
  | { readonly kind: "random"; readonly min: ColorLike; readonly max: ColorLike }
  | { readonly kind: "gradient"; readonly stops: readonly GradientStop[]; readonly samples: Float32Array };

/**
 * The `main` module: capacity, timing, space, and playback.
 *
 * @public
 */
export interface ParticleMain {
  /** How many spawn records the ring holds. Older records are overwritten, alive or not. */
  readonly capacity: number;
  /** How long one emission cycle lasts, in seconds. */
  readonly duration: number;
  /** Whether the cycle repeats. A non-looping system stops when the cycle ends and the last particle dies. */
  readonly looping: boolean;
  /** Whether `play()` fast-forwards one full cycle first, so a looping effect starts steady. */
  readonly prewarm: boolean;
  /** Seconds after `play()` before emission starts. */
  readonly startDelay: number;
  /** Where positions live. */
  readonly simulationSpace: ParticleSimulationSpace;
  /** The emission seed; `0` picks one at random on `play()`. A component's `seed` field overrides it. */
  readonly seed: number;
  /** Whether a `ParticleSystem` starts playing the first frame it is enabled. */
  readonly playOnAwake: boolean;
  /** A multiplier on the system's own clock. */
  readonly timeScale: number;
  /** The renderer's sort key within the transparent phase; lower draws first. */
  readonly renderOrder: number;
}

/**
 * One burst: `count` particles at `time` into the cycle, repeated `cycles` times every `interval`
 * seconds with `probability`.
 *
 * @public
 */
export interface ParticleBurst {
  /** Seconds into the cycle. */
  readonly time: number;
  /** How many particles; a random count is rolled per firing. */
  readonly count: ScalarValue;
  /** How many times the burst fires per cycle; `0` means until the cycle ends. */
  readonly cycles: number;
  /** Seconds between firings. */
  readonly interval: number;
  /** The chance a firing happens, `0`–`1`. */
  readonly probability: number;
}

/**
 * The `emission` module.
 *
 * @public
 */
export interface ParticleEmission {
  /** Particles per second while the cycle runs. */
  readonly rateOverTime: number;
  /** Particles per metre the emitter moves. */
  readonly rateOverDistance: number;
  /** The bursts, in declaration order. */
  readonly bursts: readonly ParticleBurst[];
}

/**
 * The `shape` module. Every field is present; a shape reads the ones that apply to it.
 *
 * @public
 */
export interface ParticleShape {
  /** Which shape. */
  readonly kind: ParticleShapeKind;
  /** The radius of a sphere, hemisphere, circle, or cone base; half the length of an edge. */
  readonly radius: number;
  /** How much of a sphere, hemisphere, or circle's radius emits, `0` (surface only) to `1` (whole). */
  readonly thickness: number;
  /** The angular span of a sphere, hemisphere, circle, or cone, in degrees. */
  readonly arc: number;
  /** A cone's half-angle in degrees. */
  readonly angle: number;
  /** A cone's height, or an edge's length. */
  readonly length: number;
  /** A box's full extents. */
  readonly size: Vec3Like;
  /** Where inside the shape particles start. */
  readonly emitFrom: ParticleEmitFrom;
  /** How much of the start direction is random, `0`–`1`. */
  readonly randomDirection: number;
  /** How much of the start direction points away from the shape's centre, `0`–`1`. */
  readonly spherizeDirection: number;
  /** A `"mesh"` shape's triangle soup: three floats per vertex, three vertices per triangle. */
  readonly vertices: Float32Array;
}

/**
 * The `start` module: what a particle is born with.
 *
 * @public
 */
export interface ParticleStart {
  /** Seconds a particle lives. */
  readonly lifetime: ScalarValue;
  /** Metres per second along the start direction. */
  readonly speed: ScalarValue;
  /** The particle's size, in metres. */
  readonly size: ScalarValue;
  /** Optional per-axis multipliers on `size`, or `null` for a uniform size. */
  readonly size3D: Vec3Like | null;
  /** The start rotation, in degrees. */
  readonly rotation: ScalarValue;
  /** The start colour, sRGB. A random value picks between two colours per particle. */
  readonly color: ColorValue;
}

/**
 * A rotation about a fixed axis through the emitter.
 *
 * @public
 */
export interface ParticleOrbit {
  /** The axis, normalized at definition time. */
  readonly axis: Vec3Like;
  /** Degrees per second. */
  readonly speed: number;
}

/**
 * A positional noise offset sampled at the analytic position.
 *
 * @public
 */
export interface ParticleNoise {
  /** The largest offset, in metres. */
  readonly strength: number;
  /** How quickly the field varies with position. */
  readonly frequency: number;
  /** How the field drifts with time, in field units per second. */
  readonly scroll: Vec3Like;
  /** How many octaves are summed, `1` or `2`. */
  readonly octaves: number;
  /** A multiplier on `strength` over the particle's life. */
  readonly influenceOverLife: ScalarValue;
}

/**
 * The `forces` module.
 *
 * @public
 */
export interface ParticleForces {
  /** An explicit world gravity, or `null` to use `gravityMultiplier` times the app's gravity. */
  readonly gravity: Vec3Like | null;
  /** How much of the app's gravity applies when `gravity` is `null`. */
  readonly gravityMultiplier: number;
  /** Linear drag; `0` is none. */
  readonly drag: number;
  /** A constant acceleration, in metres per second squared, folded into gravity. */
  readonly constantForce: Vec3Like;
  /** A rotation about an axis, or `null`. */
  readonly orbit: ParticleOrbit | null;
  /** A noise offset, or `null`. */
  readonly noise: ParticleNoise | null;
}

/**
 * The `overLifetime` module.
 *
 * @public
 */
export interface ParticleOverLifetime {
  /** A colour multiplied onto the start colour over the particle's life, or `null`. */
  readonly color: ColorValue | null;
  /** A multiplier on the start size (the X axis when `sizeY` or `sizeZ` is set), or `null`. */
  readonly size: ScalarValue | null;
  /** A separate multiplier for the Y axis, or `null` to follow `size`. */
  readonly sizeY: ScalarValue | null;
  /** A separate multiplier for the Z axis, or `null` to follow `size`. */
  readonly sizeZ: ScalarValue | null;
  /** The angular speed, in degrees per second, or `null` for none. */
  readonly rotation: ScalarValue | null;
}

/**
 * A sprite sheet laid out in a grid.
 *
 * @public
 */
export interface ParticleSheet {
  /** Columns and rows of the grid. */
  readonly tiles: Vec2Like;
  /** How the frame is chosen. */
  readonly mode: ParticleFrameMode;
  /** The frame over the particle's life as a fraction of the sheet, for `"curve"`. */
  readonly frameOverTime: ScalarValue;
  /** Frames per second, for `"fps"`. */
  readonly fps: number;
}

/**
 * The `renderer` module.
 *
 * @public
 */
export interface ParticleRenderer {
  /** How particles are oriented. */
  readonly mode: ParticleRenderMode;
  /** The primitive a `"mesh"` renderer draws. */
  readonly mesh: ParticleMeshName;
  /** The texture's asset address, or `null` for a procedural soft disc. */
  readonly texture: string | null;
  /** The sprite-sheet layout of `texture`, or `null` for a single image. */
  readonly sheet: ParticleSheet | null;
  /** How particles composite. */
  readonly blend: ParticleBlendMode;
  /** Whether particles are shaded with the main light and the ambient colour. */
  readonly lit: boolean;
  /** Where the particle's origin sits inside its quad, in size units; `(0, 0)` is the centre. */
  readonly pivot: Vec2Like;
  /** How much of the speed a `"stretched"` particle adds to its length. */
  readonly speedScale: number;
  /** A multiplier on a `"stretched"` particle's length. */
  readonly lengthScale: number;
}

/**
 * One row of the lookup texture: which row it is and how its bytes map back to values.
 *
 * @public
 */
export interface LookupRow {
  /** The row index in the texture. */
  readonly index: number;
  /** The value a byte of `0` decodes to. */
  readonly min: number;
  /** The value a byte of `255` decodes to. */
  readonly max: number;
}

/**
 * The baked lookup texture both evaluators sample: {@link LOOKUP_SAMPLES} texels wide, RGBA8, one
 * row per curve or gradient the definition uses, in the order colour, size, rotation, noise
 * influence, sheet frame. The GPU reads the bytes the CPU decodes, to the filter's precision.
 *
 * @public
 */
export interface ParticleLookup {
  /** How many rows the texture has; at least `1`. */
  readonly rows: number;
  /** The texels, `rows * LOOKUP_SAMPLES * 4` bytes, top row first. */
  readonly pixels: Uint8Array;
  /** The colour-over-life gradient row, or `null`. */
  readonly color: LookupRow | null;
  /** The size-over-life row, or `null`. Per-axis sizes use R, G, and B. */
  readonly size: LookupRow | null;
  /** The angular-speed-over-life row, or `null`. */
  readonly rotation: LookupRow | null;
  /** The noise-influence-over-life row, or `null`. */
  readonly noise: LookupRow | null;
  /** The frame-over-life row, or `null`. */
  readonly frame: LookupRow | null;
}

/**
 * The parsed and baked `.particles.json` document.
 *
 * @public
 */
export interface ParticleDefinition {
  /** Always `"ignifx.particles"`. */
  readonly format: typeof PARTICLES_FORMAT;
  /** Always `1` in this build. */
  readonly formatVersion: number;
  /** Capacity, timing, space, and playback. */
  readonly main: ParticleMain;
  /** Rates and bursts. */
  readonly emission: ParticleEmission;
  /** Where particles start and which way they go. */
  readonly shape: ParticleShape;
  /** What a particle is born with. */
  readonly start: ParticleStart;
  /** What acts on it. */
  readonly forces: ParticleForces;
  /** How it changes over its life. */
  readonly overLifetime: ParticleOverLifetime;
  /** How it is drawn. */
  readonly renderer: ParticleRenderer;
  /** The baked lookup texture. */
  readonly lookup: ParticleLookup;
}

/**
 * What {@link defineParticles} accepts: the document as authored, every key optional. Unknown keys
 * are reported, because a misspelled module silently doing nothing is the worst outcome for an
 * effect file.
 *
 * @public
 */
export interface ParticleDefinitionInput {
  /** Always `"ignifx.particles"` when present. */
  readonly format?: string;
  /** The document version. */
  readonly formatVersion?: number;
  /** The `main` module. */
  readonly main?: ParticleMainInput;
  /** The `emission` module. */
  readonly emission?: ParticleEmissionInput;
  /** The `shape` module. */
  readonly shape?: ParticleShapeInput;
  /** The `start` module. */
  readonly start?: ParticleStartInput;
  /** The `forces` module. */
  readonly forces?: ParticleForcesInput;
  /** The `overLifetime` module. */
  readonly overLifetime?: ParticleOverLifetimeInput;
  /** The `renderer` module. */
  readonly renderer?: ParticleRendererInput;
}

/**
 * The `main` module as authored.
 *
 * @public
 */
export interface ParticleMainInput {
  /** See {@link ParticleMain.capacity}. Defaults to `1000`. */
  readonly capacity?: number;
  /** See {@link ParticleMain.duration}. Defaults to `5`. */
  readonly duration?: number;
  /** See {@link ParticleMain.looping}. Defaults to `true`. */
  readonly looping?: boolean;
  /** See {@link ParticleMain.prewarm}. Defaults to `false`. */
  readonly prewarm?: boolean;
  /** See {@link ParticleMain.startDelay}. Defaults to `0`. */
  readonly startDelay?: number;
  /** See {@link ParticleMain.simulationSpace}. Defaults to `"local"`. */
  readonly simulationSpace?: ParticleSimulationSpace;
  /** See {@link ParticleMain.seed}. Defaults to `0`. */
  readonly seed?: number;
  /** See {@link ParticleMain.playOnAwake}. Defaults to `true`. */
  readonly playOnAwake?: boolean;
  /** See {@link ParticleMain.timeScale}. Defaults to `1`. */
  readonly timeScale?: number;
  /** See {@link ParticleMain.renderOrder}. Defaults to `0`. */
  readonly renderOrder?: number;
}

/**
 * One burst as authored.
 *
 * @public
 */
export interface ParticleBurstInput {
  /** Seconds into the cycle. Defaults to `0`. */
  readonly time?: number;
  /** How many particles. Defaults to `10`. */
  readonly count?: ScalarValueInput;
  /** Firings per cycle; `0` means until the cycle ends. Defaults to `1`. */
  readonly cycles?: number;
  /** Seconds between firings. Defaults to `0.1`. */
  readonly interval?: number;
  /** The chance a firing happens. Defaults to `1`. */
  readonly probability?: number;
}

/**
 * The `emission` module as authored.
 *
 * @public
 */
export interface ParticleEmissionInput {
  /** Particles per second. Defaults to `10`. */
  readonly rateOverTime?: number;
  /** Particles per metre moved. Defaults to `0`. */
  readonly rateOverDistance?: number;
  /** The bursts. Defaults to none. */
  readonly bursts?: readonly ParticleBurstInput[];
}

/**
 * The `shape` module as authored.
 *
 * @public
 */
export interface ParticleShapeInput {
  /** Which shape. Defaults to `"cone"`. */
  readonly kind?: ParticleShapeKind;
  /** See {@link ParticleShape.radius}. Defaults to `0.2`. */
  readonly radius?: number;
  /** See {@link ParticleShape.thickness}. Defaults to `1`. */
  readonly thickness?: number;
  /** See {@link ParticleShape.arc}. Defaults to `360`. */
  readonly arc?: number;
  /** See {@link ParticleShape.angle}. Defaults to `25`. */
  readonly angle?: number;
  /** See {@link ParticleShape.length}. Defaults to `1`. */
  readonly length?: number;
  /** See {@link ParticleShape.size}. Defaults to `(1, 1, 1)`. */
  readonly size?: Vec3Like;
  /** See {@link ParticleShape.emitFrom}. Defaults to `"base"` for a cone and `"volume"` otherwise. */
  readonly emitFrom?: ParticleEmitFrom;
  /** See {@link ParticleShape.randomDirection}. Defaults to `0`. */
  readonly randomDirection?: number;
  /** See {@link ParticleShape.spherizeDirection}. Defaults to `0`. */
  readonly spherizeDirection?: number;
  /** A `"mesh"` shape's triangles, nine numbers per triangle. */
  readonly vertices?: readonly number[];
}

/**
 * The `start` module as authored.
 *
 * @public
 */
export interface ParticleStartInput {
  /** Defaults to `2`. */
  readonly lifetime?: ScalarValueInput;
  /** Defaults to `2`. */
  readonly speed?: ScalarValueInput;
  /** Defaults to `0.2`. */
  readonly size?: ScalarValueInput;
  /** Defaults to `null`. */
  readonly size3D?: Vec3Like | null;
  /** Defaults to `0`. */
  readonly rotation?: ScalarValueInput;
  /** Defaults to opaque white. */
  readonly color?: ColorValueInput;
}

/**
 * The `forces` module as authored.
 *
 * @public
 */
export interface ParticleForcesInput {
  /** An explicit gravity, or `null`/omitted to scale the app's. */
  readonly gravity?: Vec3Like | null;
  /** Defaults to `0`. */
  readonly gravityMultiplier?: number;
  /** Defaults to `0`. */
  readonly drag?: number;
  /** Defaults to `(0, 0, 0)`. */
  readonly constantForce?: Vec3Like;
  /** Defaults to none. */
  readonly orbit?: { readonly axis?: Vec3Like; readonly speed?: number } | null;
  /** Defaults to none. */
  readonly noise?: {
    readonly strength?: number;
    readonly frequency?: number;
    readonly scroll?: Vec3Like;
    readonly octaves?: number;
    readonly influenceOverLife?: ScalarValueInput;
  } | null;
}

/**
 * The `overLifetime` module as authored.
 *
 * @public
 */
export interface ParticleOverLifetimeInput {
  /** A gradient, or a constant tint. */
  readonly color?: ColorValueInput | null;
  /** A curve or constant multiplier. */
  readonly size?: ScalarValueInput | null;
  /** A separate Y multiplier. */
  readonly sizeY?: ScalarValueInput | null;
  /** A separate Z multiplier. */
  readonly sizeZ?: ScalarValueInput | null;
  /** Angular speed in degrees per second. */
  readonly rotation?: ScalarValueInput | null;
}

/**
 * A sprite sheet as authored.
 *
 * @public
 */
export interface ParticleSheetInput {
  /** Columns and rows. Defaults to `(1, 1)`. */
  readonly tiles?: Vec2Like;
  /** A curve over life, `"random"`, or `{ fps }`. Defaults to a linear curve over the whole sheet. */
  readonly frameOverTime?: ScalarValueInput | "random" | { readonly fps: number };
}

/**
 * The `renderer` module as authored.
 *
 * @public
 */
export interface ParticleRendererInput {
  /** Defaults to `"billboard"`. */
  readonly mode?: ParticleRenderMode;
  /** Defaults to `"box"`. */
  readonly mesh?: ParticleMeshName;
  /** Defaults to `null`. */
  readonly texture?: string | null;
  /** Defaults to `null`. */
  readonly sheet?: ParticleSheetInput | null;
  /** Defaults to `"premultiplied"`. */
  readonly blend?: ParticleBlendMode;
  /** Defaults to `false`. */
  readonly lit?: boolean;
  /** Defaults to `(0, 0)`. */
  readonly pivot?: Vec2Like;
  /** Defaults to `0`. */
  readonly speedScale?: number;
  /** Defaults to `1`. */
  readonly lengthScale?: number;
}
