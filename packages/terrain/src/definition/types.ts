import type { ColorLike } from "@ignifx/core";

/**
 * The `ignifx.terrain` document and its resolved form
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.1,
 * `docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * `defineTerrain` turns the document, where every defaulted field is optional, into a
 * {@link TerrainDefinition} where every field is present; nothing downstream reads the raw document.
 */

/**
 * The `format` header every `.terrain.json` carries.
 *
 * @public
 */
export const TERRAIN_FORMAT = "ignifx.terrain";

/**
 * The only `formatVersion` this build reads.
 *
 * @public
 */
export const TERRAIN_FORMAT_VERSION = 1;

/**
 * The asset type terrains are registered under.
 *
 * @public
 */
export const TERRAIN_ASSET_TYPE = "terrain";

/**
 * The address suffixes that select the terrain loader.
 *
 * @public
 */
export const TERRAIN_FILE_EXTENSIONS: readonly string[] = Object.freeze([".terrain.json"]);

/**
 * The address suffix of the canonical raw heightmap: little-endian `uint16`, row-major,
 * `resolution * resolution` samples, `0..65535` mapped onto `0..size.height`.
 *
 * @public
 */
export const R16_FILE_EXTENSION = ".r16";

/**
 * The terrain's extent, in metres. `height` is the full range the heightmap's `0..65535` maps onto.
 *
 * @public
 */
export interface TerrainSize {
  /** Extent along X. */
  readonly width: number;
  /** Extent along Z. */
  readonly depth: number;
  /** The height a full-scale sample reaches; the field spans `0..height`. */
  readonly height: number;
}

/**
 * Where a terrain's heights come from when they come from a file.
 *
 * @public
 */
export interface TerrainHeightmapDefinition {
  /** The heightmap's address: a `.r16` (canonical) or a PNG, resolved relative to the document. */
  readonly source: string;
}

/**
 * The seeded fractal noise a terrain without a heightmap is built from.
 *
 * @public
 */
export interface TerrainNoiseDefinition {
  /** The seed; the same seed always produces the same field. */
  readonly seed: number;
  /** How many octaves are summed. */
  readonly octaves: number;
  /** The first octave's frequency, in cycles per metre. */
  readonly frequency: number;
  /** How much the frequency grows per octave. */
  readonly lacunarity: number;
  /** How much the amplitude shrinks per octave. */
  readonly persistence: number;
  /** Ridged multifractal (sharp crests) rather than plain fBm. */
  readonly ridged: boolean;
  /** How many flat steps the height is quantised into; `0` leaves it smooth. */
  readonly terraces: number;
}

/**
 * How the field is cut into chunks and how their levels of detail are chosen.
 *
 * @public
 */
export interface TerrainChunksDefinition {
  /** Quads per chunk side. `resolution - 1` must be a multiple of it. */
  readonly size: number;
  /** How many LOD meshes each chunk carries; level `n` skips `2^n` samples. */
  readonly lodLevels: number;
  /** The camera distance, in metres, at which level 1 takes over; each level doubles it. */
  readonly lodDistance: number;
  /** How far, in metres, every LOD mesh's edges hang down to hide cracks between levels. */
  readonly skirtDepth: number;
}

/**
 * One textured layer of the splat.
 *
 * @public
 */
export interface TerrainLayerDefinition {
  /** The layer's name; what a splat rule and a `TerrainScatter` refer to. */
  readonly name: string;
  /** The albedo texture's address, resolved relative to the document; empty for a flat colour. */
  readonly albedo: string;
  /** The tangent-space normal map's address, or `null` for none. */
  readonly normal: string | null;
  /** How many metres one repeat of the textures spans. */
  readonly tiling: number;
  /** Whether the layer projects along all three axes, which hides stretching on cliffs. */
  readonly triplanar: boolean;
  /** An sRGB tint multiplied with the albedo; the whole colour when there is no albedo texture. */
  readonly color: ColorLike;
}

/**
 * A painted control map set: one RGBA image per four layers, one channel per layer.
 *
 * @public
 */
export interface TerrainSplatDefinition {
  /** The control map addresses, resolved relative to the document; the second covers layers 5–8. */
  readonly control: readonly string[];
}

/**
 * One rule of a generated splat: where a layer appears, by height and slope band.
 *
 * @public
 */
export interface TerrainSplatRule {
  /** The layer the rule paints. */
  readonly layer: string;
  /** The height band, in metres, or `null` for every height. */
  readonly height: readonly [number, number] | null;
  /** The slope band, in degrees from horizontal, or `null` for every slope. */
  readonly slope: readonly [number, number] | null;
}

/**
 * The PBR factors the whole terrain shares. Per-layer roughness is not possible: Babylon Lite's PBR
 * template declares `roughness` as a `let`, so a material plugin cannot drive it.
 *
 * @public
 */
export interface TerrainMaterialDefinition {
  /** Roughness factor, 0 to 1. */
  readonly roughness: number;
  /** Metallic factor, 0 to 1. */
  readonly metallic: number;
}

/**
 * A fully resolved terrain: every field present, every address resolved, every rule checked.
 *
 * @public
 */
export interface TerrainDefinition {
  /** Always {@link TERRAIN_FORMAT}. */
  readonly format: typeof TERRAIN_FORMAT;
  /** Always {@link TERRAIN_FORMAT_VERSION}. */
  readonly formatVersion: typeof TERRAIN_FORMAT_VERSION;
  /** A human-readable name; the document's basename when the file names none. */
  readonly name: string;
  /** The extent, in metres. */
  readonly size: TerrainSize;
  /** Samples per side, `2^n + 1`. */
  readonly resolution: number;
  /** The heightmap, or `null` when the heights come from noise. */
  readonly heightmap: TerrainHeightmapDefinition | null;
  /** The noise, or `null` when the heights come from a heightmap. */
  readonly noise: TerrainNoiseDefinition | null;
  /** How the field is chunked. */
  readonly chunks: TerrainChunksDefinition;
  /** Chunks per side, derived: `(resolution - 1) / chunks.size`. */
  readonly chunksPerSide: number;
  /** The layers, 1 to 8, in control-channel order. */
  readonly layers: readonly TerrainLayerDefinition[];
  /** The painted control maps, or `null` when the weights come from rules. */
  readonly splat: TerrainSplatDefinition | null;
  /** The splat rules; empty when the weights come from painted maps. */
  readonly splatRules: readonly TerrainSplatRule[];
  /** The shared PBR factors. */
  readonly material: TerrainMaterialDefinition;
}

/**
 * What {@link TerrainLayerDefinition} accepts: every defaulted field optional.
 *
 * @public
 */
export interface TerrainLayerInput {
  /** The layer's name. Required. */
  readonly name: string;
  /** The albedo texture's address. */
  readonly albedo?: string;
  /** The normal map's address. */
  readonly normal?: string | null;
  /** Metres per texture repeat. Defaults to `8`. */
  readonly tiling?: number;
  /** Whether the layer is projected triplanar. Defaults to `false`. */
  readonly triplanar?: boolean;
  /** An sRGB tint, as `{ r, g, b, a }` or `[r, g, b]`. Defaults to white. */
  readonly color?: ColorLike | readonly number[];
}

/**
 * What a splat rule accepts.
 *
 * @public
 */
export interface TerrainSplatRuleInput {
  /** The layer the rule paints. Required. */
  readonly layer: string;
  /** The height band, in metres. */
  readonly height?: readonly number[];
  /** The slope band, in degrees. */
  readonly slope?: readonly number[];
}

/**
 * What `defineTerrain` accepts: the document with every defaulted field optional.
 *
 * @public
 */
export interface TerrainDefinitionInput {
  /** Must be {@link TERRAIN_FORMAT} when present. */
  readonly format?: string;
  /** Must be {@link TERRAIN_FORMAT_VERSION} when present. */
  readonly formatVersion?: number;
  /** A human-readable name. */
  readonly name?: string;
  /** The extent, in metres. Defaults to `512 x 512 x 80`. */
  readonly size?: Partial<TerrainSize>;
  /** Samples per side. Defaults to `513`. */
  readonly resolution?: number;
  /** The heightmap; omit it for noise. */
  readonly heightmap?: Partial<TerrainHeightmapDefinition> | null;
  /** The noise; used when there is no heightmap. */
  readonly noise?: Partial<TerrainNoiseDefinition> | null;
  /** How the field is chunked. Defaults to `64` quads, `4` levels, `96` metres, `2` metres of skirt. */
  readonly chunks?: Partial<TerrainChunksDefinition>;
  /** The layers. Defaults to one flat grey layer named `ground`. */
  readonly layers?: readonly TerrainLayerInput[];
  /** The painted control maps. */
  readonly splat?: { readonly control?: readonly string[] } | null;
  /** The splat rules. */
  readonly splatRules?: readonly TerrainSplatRuleInput[];
  /** The shared PBR factors. Defaults to roughness `0.9`, metallic `0`. */
  readonly material?: Partial<TerrainMaterialDefinition>;
}
