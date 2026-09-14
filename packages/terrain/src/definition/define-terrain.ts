import { MAX_TERRAIN_LAYERS, TerrainErrorCode, terrainError } from "../errors.js";
import { resolveTerrainAddress } from "./relative.js";
import { TERRAIN_FORMAT, TERRAIN_FORMAT_VERSION } from "./types.js";
import type {
  TerrainChunksDefinition,
  TerrainDefinition,
  TerrainDefinitionInput,
  TerrainLayerDefinition,
  TerrainLayerInput,
  TerrainMaterialDefinition,
  TerrainNoiseDefinition,
  TerrainSize,
  TerrainSplatRule,
  TerrainSplatRuleInput,
} from "./types.js";
import type { ColorLike } from "@ignifx/core";

/**
 * `defineTerrain`: the one validator every `ignifx.terrain` document goes through
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.1).
 *
 * Addresses are resolved relative to the document, so a `.terrain.json` can sit beside its
 * heightmap and textures the way exporters lay them out.
 */

/** The default extent, in metres. */
const DEFAULT_SIZE: TerrainSize = Object.freeze({ width: 512, depth: 512, height: 80 });

/** The default sample resolution. */
const DEFAULT_RESOLUTION = 513;

/** The default chunking. */
const DEFAULT_CHUNKS: TerrainChunksDefinition = Object.freeze({
  size: 64,
  lodLevels: 4,
  lodDistance: 96,
  skirtDepth: 2,
});

/** The default noise, used when a document names neither a heightmap nor noise. */
const DEFAULT_NOISE: TerrainNoiseDefinition = Object.freeze({
  seed: 1,
  octaves: 6,
  frequency: 0.004,
  lacunarity: 2,
  persistence: 0.5,
  ridged: false,
  terraces: 0,
});

/** The default shared PBR factors. */
const DEFAULT_MATERIAL: TerrainMaterialDefinition = Object.freeze({ roughness: 0.9, metallic: 0 });

/** The default layer tiling, in metres per repeat. */
const DEFAULT_TILING = 8;

/** The most LOD levels a chunk may carry; `2^7` already skips 128 samples. */
const MAX_LOD_LEVELS = 8;

/** The most octaves noise sums; beyond it every octave is below sample resolution anyway. */
const MAX_OCTAVES = 16;

/** How many layers one RGBA control map carries. */
const LAYERS_PER_CONTROL_MAP = 4;

/** White, the tint of a layer that declares none. */
const WHITE: ColorLike = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/**
 * Validates a terrain document and fills in its defaults.
 *
 * @param input - The document, with every defaulted field optional.
 * @param address - The document's address, for messages and for resolving the addresses it names.
 * Defaults to `<inline>`, which resolves references against the asset root.
 * @returns The resolved definition.
 * @throws IgnifxError with code `IGX-1601` for a malformed document, `IGX-1602` for a resolution
 * that does not fit `2^n + 1` or the chunking, `IGX-1605` for a layer count outside 1–8, or
 * `IGX-1611` for a rule naming an unknown layer.
 *
 * @example
 * ```ts
 * const island = defineTerrain({
 *   size: { width: 256, depth: 256, height: 40 },
 *   resolution: 257,
 *   noise: { seed: 7, octaves: 5 },
 *   chunks: { size: 64, lodLevels: 3 },
 *   layers: [{ name: "grass" }, { name: "rock", triplanar: true }],
 *   splatRules: [{ layer: "grass" }, { layer: "rock", slope: [35, 90] }],
 * });
 * ```
 *
 * @public
 */
export function defineTerrain(input: TerrainDefinitionInput, address = "<inline>"): TerrainDefinition {
  const fail = (reason: string): never => {
    throw terrainError(
      TerrainErrorCode.invalidTerrainFile,
      `${address} is not a readable ${TERRAIN_FORMAT} document: ${reason}.`,
      { context: { file: address }, hint: "Check the format and formatVersion fields and the field types." },
    );
  };
  if (input.format !== undefined && input.format !== TERRAIN_FORMAT) {
    fail(`its format is ${input.format}, not ${TERRAIN_FORMAT}`);
  }
  if (input.formatVersion !== undefined && input.formatVersion !== TERRAIN_FORMAT_VERSION) {
    fail(`its formatVersion is ${String(input.formatVersion)}, and this build reads ${String(TERRAIN_FORMAT_VERSION)}`);
  }
  const size = readSize(input.size, fail);
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;
  const chunks = readChunks(input.chunks, fail);
  const chunksPerSide = checkResolution(resolution, chunks, address);
  const heightmap = readHeightmap(input.heightmap, address, fail);
  const noise = heightmap === null ? readNoise(input.noise, fail) : null;
  const layers = readLayers(input.layers, address, fail);
  const splat = readSplat(input.splat, layers.length, address, fail);
  const splatRules = readRules(input.splatRules, layers, address, fail);
  if (splat !== null && splatRules.length > 0) {
    fail("it declares both splat.control and splatRules; a terrain paints its weights or generates them, not both");
  }
  const material = readMaterial(input.material, fail);
  const name = input.name ?? basenameOf(address);
  return {
    format: TERRAIN_FORMAT,
    formatVersion: TERRAIN_FORMAT_VERSION,
    name,
    size,
    resolution,
    heightmap,
    noise,
    chunks,
    chunksPerSide,
    layers,
    splat,
    splatRules,
    material,
  };
}

/**
 * Whether a number is finite and positive.
 *
 * @param value - The candidate.
 * @returns `true` for a finite number above zero.
 */
function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Whether a number is a whole number, finite.
 *
 * @param value - The candidate.
 * @returns `true` for a finite integer.
 */
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Reads the size block.
 *
 * @param size - The declared size.
 * @param fail - Throws the document error.
 * @returns The complete size.
 */
function readSize(size: Partial<TerrainSize> | undefined, fail: (reason: string) => never): TerrainSize {
  const width = size?.width ?? DEFAULT_SIZE.width;
  const depth = size?.depth ?? DEFAULT_SIZE.depth;
  const height = size?.height ?? DEFAULT_SIZE.height;
  if (!isPositive(width) || !isPositive(depth) || !isPositive(height)) {
    fail(`its size ${String(width)}x${String(depth)}x${String(height)} is not positive on every axis`);
  }
  return { width, depth, height };
}

/**
 * Reads the chunks block.
 *
 * @param chunks - The declared chunking.
 * @param fail - Throws the document error.
 * @returns The complete chunking.
 */
function readChunks(
  chunks: Partial<TerrainChunksDefinition> | undefined,
  fail: (reason: string) => never,
): TerrainChunksDefinition {
  const size = chunks?.size ?? DEFAULT_CHUNKS.size;
  const lodLevels = chunks?.lodLevels ?? DEFAULT_CHUNKS.lodLevels;
  const lodDistance = chunks?.lodDistance ?? DEFAULT_CHUNKS.lodDistance;
  const skirtDepth = chunks?.skirtDepth ?? DEFAULT_CHUNKS.skirtDepth;
  if (!isInteger(size) || size < 1) {
    fail(`chunks.size is ${String(size)}, not a whole number of quads`);
  }
  if (!isInteger(lodLevels) || lodLevels < 1 || lodLevels > MAX_LOD_LEVELS) {
    fail(`chunks.lodLevels is ${String(lodLevels)}, not a whole number in 1..${String(MAX_LOD_LEVELS)}`);
  }
  if (!isPositive(lodDistance)) {
    fail(`chunks.lodDistance is ${String(lodDistance)}, not a positive distance`);
  }
  if (typeof skirtDepth !== "number" || !Number.isFinite(skirtDepth) || skirtDepth < 0) {
    fail(`chunks.skirtDepth is ${String(skirtDepth)}, not a non-negative depth`);
  }
  return { size, lodLevels, lodDistance, skirtDepth };
}

/**
 * Checks the resolution against `2^n + 1` and the chunking, and derives the chunk count.
 *
 * @param resolution - The declared samples per side.
 * @param chunks - The chunking.
 * @param address - The document address, for the message.
 * @returns Chunks per side.
 * @throws IgnifxError with code `IGX-1602`.
 */
function checkResolution(resolution: number, chunks: TerrainChunksDefinition, address: string): number {
  const refuse = (reason: string): never => {
    throw terrainError(
      TerrainErrorCode.invalidResolution,
      `${address} declares resolution ${String(resolution)}, ${reason}.`,
      {
        context: { file: address, resolution },
        hint: "Use 2^n + 1 samples per side (65, 129, 257, 513, ...) and a chunks.size that divides resolution - 1.",
      },
    );
  };
  if (!isInteger(resolution) || resolution < 3) {
    refuse("which is not a whole number of at least 3");
  }
  const quads = resolution - 1;
  if ((quads & (quads - 1)) !== 0) {
    refuse("which is not 2^n + 1");
  }
  if (quads % chunks.size !== 0) {
    refuse(`whose ${String(quads)} quads per side are not a multiple of chunks.size ${String(chunks.size)}`);
  }
  const coarsestStride = 2 ** (chunks.lodLevels - 1);
  if (chunks.size % coarsestStride !== 0) {
    refuse(
      `whose chunks.size ${String(chunks.size)} is not a multiple of the coarsest LOD stride ${String(coarsestStride)}`,
    );
  }
  return quads / chunks.size;
}

/**
 * Reads the heightmap block.
 *
 * @param heightmap - The declared heightmap, or `null`/`undefined` for noise.
 * @param address - The document address the source is resolved against.
 * @param fail - Throws the document error.
 * @returns The heightmap, or `null`.
 */
function readHeightmap(
  heightmap: Partial<{ readonly source: string }> | null | undefined,
  address: string,
  fail: (reason: string) => never,
): { readonly source: string } | null {
  if (heightmap === null || heightmap === undefined) {
    return null;
  }
  const source = heightmap.source;
  if (typeof source !== "string" || source === "") {
    fail("heightmap.source is not an address");
  }
  return { source: resolveTerrainAddress(address, source) };
}

/**
 * Reads the noise block, defaulting every field.
 *
 * @param noise - The declared noise.
 * @param fail - Throws the document error.
 * @returns The complete noise.
 */
function readNoise(
  noise: Partial<TerrainNoiseDefinition> | null | undefined,
  fail: (reason: string) => never,
): TerrainNoiseDefinition {
  const seed = noise?.seed ?? DEFAULT_NOISE.seed;
  const octaves = noise?.octaves ?? DEFAULT_NOISE.octaves;
  const frequency = noise?.frequency ?? DEFAULT_NOISE.frequency;
  const lacunarity = noise?.lacunarity ?? DEFAULT_NOISE.lacunarity;
  const persistence = noise?.persistence ?? DEFAULT_NOISE.persistence;
  const ridged = noise?.ridged ?? DEFAULT_NOISE.ridged;
  const terraces = noise?.terraces ?? DEFAULT_NOISE.terraces;
  if (!isInteger(seed) || seed < 0) {
    fail(`noise.seed is ${String(seed)}, not a non-negative whole number`);
  }
  if (!isInteger(octaves) || octaves < 1 || octaves > MAX_OCTAVES) {
    fail(`noise.octaves is ${String(octaves)}, not a whole number in 1..${String(MAX_OCTAVES)}`);
  }
  if (!isPositive(frequency) || !isPositive(lacunarity) || !isPositive(persistence)) {
    fail("noise.frequency, noise.lacunarity and noise.persistence must all be positive");
  }
  if (typeof ridged !== "boolean") {
    fail("noise.ridged is not a boolean");
  }
  if (!isInteger(terraces) || terraces < 0) {
    fail(`noise.terraces is ${String(terraces)}, not a non-negative whole number`);
  }
  return { seed, octaves, frequency, lacunarity, persistence, ridged, terraces };
}

/**
 * Reads the layers, defaulting to one flat layer.
 *
 * @param layers - The declared layers.
 * @param address - The document address the texture addresses are resolved against.
 * @param fail - Throws the document error.
 * @returns The complete layers.
 * @throws IgnifxError with code `IGX-1605` when there are none or too many.
 */
function readLayers(
  layers: readonly TerrainLayerInput[] | undefined,
  address: string,
  fail: (reason: string) => never,
): readonly TerrainLayerDefinition[] {
  const declared = layers ?? [{ name: "ground", color: { r: 0.45, g: 0.5, b: 0.4, a: 1 } }];
  if (declared.length < 1 || declared.length > MAX_TERRAIN_LAYERS) {
    throw terrainError(
      TerrainErrorCode.tooManyLayers,
      `${address} declares ${String(declared.length)} layers; a terrain takes 1 to ${String(MAX_TERRAIN_LAYERS)}.`,
      {
        context: { file: address, count: declared.length },
        hint: "One albedo texture array and two RGBA control maps carry at most eight layers.",
      },
    );
  }
  const names = new Set<string>();
  const out: TerrainLayerDefinition[] = [];
  for (let index = 0; index < declared.length; index += 1) {
    const layer = declared[index];
    if (layer === undefined || typeof layer.name !== "string" || layer.name === "") {
      fail(`layers[${String(index)}] has no name`);
    }
    if (names.has(layer.name)) {
      fail(`two layers are named ${layer.name}`);
    }
    names.add(layer.name);
    const tiling = layer.tiling ?? DEFAULT_TILING;
    if (!isPositive(tiling)) {
      fail(`layers[${String(index)}].tiling is ${String(tiling)}, not a positive distance`);
    }
    const albedo = layer.albedo ?? "";
    const normal = layer.normal ?? null;
    if (typeof albedo !== "string" || (normal !== null && typeof normal !== "string")) {
      fail(`layers[${String(index)}] names a texture that is not an address`);
    }
    out.push({
      name: layer.name,
      albedo: resolveTerrainAddress(address, albedo),
      normal: normal === null || normal === "" ? null : resolveTerrainAddress(address, normal),
      tiling,
      triplanar: layer.triplanar ?? false,
      color: readColor(layer.color, `layers[${String(index)}].color`, fail),
    });
  }
  return out;
}

/**
 * Reads a layer tint, given as `{ r, g, b, a }` or `[r, g, b, a?]`.
 *
 * @param color - The declared tint.
 * @param field - The field name, for the message.
 * @param fail - Throws the document error.
 * @returns The colour, white when none was declared.
 */
function readColor(
  color: ColorLike | readonly number[] | undefined,
  field: string,
  fail: (reason: string) => never,
): ColorLike {
  if (color === undefined) {
    return WHITE;
  }
  if (Array.isArray(color)) {
    // `Array.isArray` widens a readonly tuple to `any[]`; the declared parameter is what types it.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const [r, g, b, a] = color as readonly (number | undefined)[];
    if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
      fail(`${field} is not an [r, g, b] array`);
    }
    return { r, g, b, a: typeof a === "number" ? a : 1 };
  }
  // The array case was handled above, so what is left is the object form.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const object = color as ColorLike;
  if (typeof object.r !== "number" || typeof object.g !== "number" || typeof object.b !== "number") {
    fail(`${field} is not an { r, g, b } colour`);
  }
  return { r: object.r, g: object.g, b: object.b, a: typeof object.a === "number" ? object.a : 1 };
}

/**
 * Reads the painted control maps.
 *
 * @param splat - The declared block.
 * @param layerCount - How many layers there are, which fixes how many maps are needed.
 * @param address - The document address the map addresses are resolved against.
 * @param fail - Throws the document error.
 * @returns The maps, or `null` when none are declared.
 */
function readSplat(
  splat: { readonly control?: readonly string[] } | null | undefined,
  layerCount: number,
  address: string,
  fail: (reason: string) => never,
): { readonly control: readonly string[] } | null {
  if (splat === null || splat === undefined) {
    return null;
  }
  const control = splat.control ?? [];
  const needed = Math.ceil(layerCount / LAYERS_PER_CONTROL_MAP);
  if (control.length !== needed) {
    fail(`splat.control names ${String(control.length)} maps, and ${String(layerCount)} layers need ${String(needed)}`);
  }
  const resolved: string[] = [];
  for (let index = 0; index < control.length; index += 1) {
    const map = control[index];
    if (typeof map !== "string" || map === "") {
      fail(`splat.control[${String(index)}] is not an address`);
    }
    resolved.push(resolveTerrainAddress(address, map));
  }
  return { control: resolved };
}

/**
 * Reads the splat rules and checks every layer they name.
 *
 * @param rules - The declared rules.
 * @param layers - The declared layers.
 * @param address - The document address, for messages.
 * @param fail - Throws the document error.
 * @returns The complete rules.
 * @throws IgnifxError with code `IGX-1611` when a rule names an unknown layer.
 */
function readRules(
  rules: readonly TerrainSplatRuleInput[] | undefined,
  layers: readonly TerrainLayerDefinition[],
  address: string,
  fail: (reason: string) => never,
): readonly TerrainSplatRule[] {
  const out: TerrainSplatRule[] = [];
  const declared = rules ?? [];
  for (let index = 0; index < declared.length; index += 1) {
    const rule = declared[index];
    if (rule === undefined || typeof rule.layer !== "string") {
      fail(`splatRules[${String(index)}] names no layer`);
    }
    if (!layers.some((layer) => layer.name === rule.layer)) {
      throw terrainError(
        TerrainErrorCode.unknownLayer,
        `${address} rule ${String(index)} names the layer ${rule.layer}, which the terrain does not declare.`,
        {
          context: { file: address, layer: rule.layer },
          hint: `The declared layers are ${layers.map((layer) => layer.name).join(", ")}.`,
        },
      );
    }
    out.push({
      layer: rule.layer,
      height: readBand(rule.height, `splatRules[${String(index)}].height`, fail),
      slope: readBand(rule.slope, `splatRules[${String(index)}].slope`, fail),
    });
  }
  return out;
}

/**
 * Reads a `[min, max]` band.
 *
 * @param band - The declared band.
 * @param field - The field name, for the message.
 * @param fail - Throws the document error.
 * @returns The band, or `null` when none was declared.
 */
function readBand(
  band: readonly number[] | undefined,
  field: string,
  fail: (reason: string) => never,
): readonly [number, number] | null {
  if (band === undefined) {
    return null;
  }
  const [min, max] = band;
  if (band.length !== 2 || typeof min !== "number" || typeof max !== "number" || !(min <= max)) {
    fail(`${field} is not a [min, max] pair with min <= max`);
  }
  return [min, max];
}

/**
 * Reads the shared material factors.
 *
 * @param material - The declared factors.
 * @param fail - Throws the document error.
 * @returns The complete factors.
 */
function readMaterial(
  material: Partial<TerrainMaterialDefinition> | undefined,
  fail: (reason: string) => never,
): TerrainMaterialDefinition {
  const roughness = material?.roughness ?? DEFAULT_MATERIAL.roughness;
  const metallic = material?.metallic ?? DEFAULT_MATERIAL.metallic;
  if (!isUnit(roughness) || !isUnit(metallic)) {
    fail("material.roughness and material.metallic must be numbers in 0..1");
  }
  return { roughness, metallic };
}

/**
 * Whether a value is a number in `0..1`.
 *
 * @param value - The candidate.
 * @returns `true` inside the unit interval.
 */
function isUnit(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

/**
 * The file name of an address, without its `.terrain.json` suffix.
 *
 * @param address - The document address.
 * @returns The basename.
 */
function basenameOf(address: string): string {
  const slash = address.lastIndexOf("/");
  const file = slash < 0 ? address : address.slice(slash + 1);
  return file.endsWith(".terrain.json") ? file.slice(0, -".terrain.json".length) : file;
}
