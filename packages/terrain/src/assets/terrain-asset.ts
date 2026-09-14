import { TextureAsset } from "@ignifx/core";
import { defineTerrain } from "../definition/define-terrain.js";
import { TERRAIN_ASSET_TYPE } from "../definition/types.js";
import { TerrainErrorCode, terrainError } from "../errors.js";
import { HeightField } from "../heightfield/height-field.js";
import { generateNoiseField } from "../heightfield/noise.js";
import { loadGeneratedShader } from "../material/shader-source.js";
import { generateControlMaps, solidControlMaps } from "../material/splat-rules.js";
import { terrainSplatShaderSource } from "../material/terrain-splat.surface.wgsl.js";
import { createLayerTextures } from "./layer-textures.js";
import type { TerrainLayerImages, TerrainLayerTextures } from "./layer-textures.js";
import type { TerrainDefinition, TerrainDefinitionInput } from "../definition/types.js";
import type { ControlMaps } from "../material/splat-rules.js";
import type { TerrainSplatShaderSpec } from "../material/terrain-splat.surface.wgsl.js";
import type { App, AssetHandle, ShaderAsset } from "@ignifx/core";

/**
 * `TerrainAsset`: one loaded terrain — its definition, its height field, its splat weights, and the
 * GPU resources every `Terrain` drawing it shares (`docs/plan/2026-09-terrain-particles-shaders.md`
 * §5.1).
 *
 * The material is **not** here: the splat shader reads world positions, so its origin uniform
 * belongs to the entity, and each `Terrain` builds its own PBR material from the shader and
 * textures this asset publishes.
 */

/** What {@link TerrainAsset}'s constructor takes. */
interface TerrainAssetInit {
  /** The address the asset is registered under. */
  readonly address: string;
  /** The resolved document. */
  readonly definition: TerrainDefinition;
  /** The heights, in the terrain's local frame. */
  readonly field: HeightField;
  /** The splat weights on the CPU. */
  readonly control: ControlMaps;
  /** One texture per control map, in the same order. */
  readonly controlTextures: readonly AssetHandle<TextureAsset>[];
  /** The layer texture arrays. */
  readonly layers: TerrainLayerTextures;
  /** The generated `terrainSplat` surface shader. */
  readonly shader: AssetHandle<ShaderAsset>;
  /** The shape that shader was generated for. */
  readonly splat: TerrainSplatShaderSpec;
}

/**
 * A loaded `.terrain.json`, or a terrain built in code.
 *
 * @example
 * ```ts
 * const handle = await app.assets.loadAsync<TerrainAsset>("terrain/island.terrain.json");
 * handle.value.field.heightAt(0, 0);
 * ```
 *
 * @public
 */
export class TerrainAsset {
  /** The asset type this class registers under. */
  static assetType: string = TERRAIN_ASSET_TYPE;

  /** The address the asset was loaded or registered under. */
  readonly address: string;

  /** The resolved document, every default filled in. */
  readonly definition: TerrainDefinition;

  /** The heights, in metres, in the terrain's local frame. */
  readonly field: HeightField;

  /** The splat weights on the CPU; what a `TerrainScatter` reads. */
  readonly control: ControlMaps;

  /** One RGBA texture per control map, in control-map order. */
  readonly controlTextures: readonly AssetHandle<TextureAsset>[];

  /** The albedo and normal texture arrays, or `null` handles for a textureless terrain. */
  readonly layers: TerrainLayerTextures;

  /** The generated `terrainSplat` surface shader, shared by every terrain of the same shape. */
  readonly shader: AssetHandle<ShaderAsset>;

  /** The layer shape the shader was generated for. */
  readonly splat: TerrainSplatShaderSpec;

  #isDisposed = false;

  /**
   * Wraps already-built resources.
   *
   * @param init - The definition, the field, the weights, and the published handles.
   *
   * @internal
   */
  constructor(init: TerrainAssetInit) {
    this.address = init.address;
    this.definition = init.definition;
    this.field = init.field;
    this.control = init.control;
    this.controlTextures = init.controlTextures;
    this.layers = init.layers;
    this.shader = init.shader;
    this.splat = init.splat;
  }

  /**
   * Whether {@link TerrainAsset.dispose} has run.
   *
   * @returns `true` once the asset has released its handles.
   */
  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /**
   * The control-channel index of a named layer.
   *
   * @param name - The layer's name.
   * @returns The index, or `-1` when the terrain declares no such layer.
   */
  layerIndex(name: string): number {
    const layers = this.definition.layers;
    for (let index = 0; index < layers.length; index += 1) {
      if (layers[index]?.name === name) {
        return index;
      }
    }
    return -1;
  }

  /** Releases the textures and the shader. The asset service calls this when the asset unloads. */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    for (let index = 0; index < this.controlTextures.length; index += 1) {
      this.controlTextures[index]?.release();
    }
    this.layers.albedo?.release();
    this.layers.normals?.release();
    this.shader.release();
  }
}

/**
 * What {@link buildTerrainAsset} needs beyond the definition.
 *
 * @internal
 */
export interface TerrainAssetSources {
  /** The decoded heights in metres, or `null` to generate them from the definition's noise. */
  readonly heights: Float32Array | null;
  /** The decoded layer images, or `null` for a terrain that blends its layer tints alone. */
  readonly layerImages: TerrainLayerImages | null;
  /** The decoded control maps, or `null` to take the splat from rules or to paint layer 0 everywhere. */
  readonly controlImages: readonly { readonly size: number; readonly data: Uint8Array }[] | null;
}

/**
 * Builds a terrain asset from a resolved definition and whatever the loader decoded.
 *
 * @param app - The app whose asset service publishes the textures and the shader.
 * @param address - The address to register the asset under.
 * @param definition - The resolved document.
 * @param sources - The decoded heights, layer images, and control maps.
 * @returns The asset, holding one share of every handle it published.
 *
 * @internal
 */
export async function buildTerrainAsset(
  app: App,
  address: string,
  definition: TerrainDefinition,
  sources: TerrainAssetSources,
): Promise<TerrainAsset> {
  const field = buildField(definition, sources.heights);
  const control = buildControl(definition, field, sources.controlImages);
  const controlTextures: AssetHandle<TextureAsset>[] = [];
  for (let index = 0; index < control.maps.length; index += 1) {
    const map = control.maps[index];
    if (map === undefined) {
      continue;
    }
    controlTextures.push(
      TextureAsset.fromPixels(app, `${address}#control${String(index)}`, map, control.size, control.size, {
        srgb: false,
        wrap: "clamp",
        filter: "linear",
      }),
    );
  }
  const layers = createLayerTextures(app, address, sources.layerImages);
  const splat = splatSpecOf(definition, layers);
  const shader = await loadGeneratedShader(app, terrainSplatShaderSource(splat));
  return new TerrainAsset({ address, definition, field, control, controlTextures, layers, shader, splat });
}

/**
 * What {@link terrainAssetFromDefinition} accepts.
 *
 * @public
 */
export interface TerrainAssetOptions {
  /** The address to register under. Defaults to a generated `memory:` address. */
  readonly address?: string;
  /**
   * Heights in metres, row-major, `resolution * resolution` of them. Omit them to generate the
   * definition's noise.
   */
  readonly heights?: Float32Array;
}

/**
 * Builds a terrain asset from a definition written in code, without loading a file.
 *
 * @remarks
 * The terrain blends its layer **tints**: a texture array is assembled from decoded images, which
 * only the `.terrain.json` loader has. Give the definition `noise`, or pass `heights`, for the
 * shape; a definition that names a `heightmap` file is refused, because nothing here can fetch it.
 *
 * @param app - The app whose asset service publishes the result.
 * @param input - The document, with every defaulted field optional.
 * @param options - The address and an explicit height array.
 * @returns The handle, with one holder — the caller.
 * @throws IgnifxError with code `IGX-1601` when the definition names a heightmap file, `IGX-1602`
 * for a resolution that does not fit the chunking, or `IGX-1608` when `heights` is the wrong length.
 *
 * @example
 * ```ts
 * const island = await terrainAssetFromDefinition(app, {
 *   size: { width: 256, depth: 256, height: 30 },
 *   resolution: 257,
 *   noise: { seed: 7, octaves: 5 },
 *   layers: [{ name: "grass" }, { name: "rock", triplanar: true }],
 *   splatRules: [{ layer: "grass" }, { layer: "rock", slope: [35, 90] }],
 * });
 * ```
 *
 * @public
 */
export async function terrainAssetFromDefinition(
  app: App,
  input: TerrainDefinitionInput,
  options?: TerrainAssetOptions,
): Promise<AssetHandle<TerrainAsset>> {
  const address = options?.address ?? `memory:terrain/${String(nextSerial())}.terrain.json`;
  const definition = defineTerrain(input, address);
  if (definition.heightmap !== null) {
    throw terrainError(
      TerrainErrorCode.invalidTerrainFile,
      `${address} names the heightmap ${definition.heightmap.source}, which only the .terrain.json loader can fetch.`,
      {
        context: { file: address },
        hint: "Load the document through app.assets, or pass noise or an explicit heights array.",
      },
    );
  }
  const asset = await buildTerrainAsset(app, address, definition, {
    heights: options?.heights ?? null,
    layerImages: null,
    controlImages: null,
  });
  return app.assets.register(asset, { type: TERRAIN_ASSET_TYPE, address });
}

/** Counts the in-code terrains of this process, so two of them never share an address. */
let serial = 0;

/**
 * The next in-code terrain serial.
 *
 * @returns A number no earlier call returned.
 */
function nextSerial(): number {
  serial += 1;
  return serial;
}

/**
 * Builds the height field from explicit heights or from the definition's noise.
 *
 * @param definition - The resolved document.
 * @param heights - Heights in metres, or `null`.
 * @returns The field.
 */
function buildField(definition: TerrainDefinition, heights: Float32Array | null): HeightField {
  if (heights !== null) {
    return new HeightField(definition.resolution, definition.size, heights);
  }
  const noise = definition.noise;
  if (noise === null) {
    return new HeightField(definition.resolution, definition.size);
  }
  const values = generateNoiseField(definition.resolution, definition.size.width, definition.size.depth, noise);
  return HeightField.fromNormalised(definition.resolution, definition.size, values);
}

/**
 * Builds the control maps from painted images, from rules, or from neither.
 *
 * @param definition - The resolved document.
 * @param field - The height field the rules read.
 * @param images - The decoded control images, or `null`.
 * @returns The maps.
 */
function buildControl(
  definition: TerrainDefinition,
  field: HeightField,
  images: readonly { readonly size: number; readonly data: Uint8Array }[] | null,
): ControlMaps {
  if (images !== null && images.length > 0) {
    const size = images[0]?.size ?? field.resolution - 1;
    return { size, maps: images.map((image) => image.data) };
  }
  if (definition.splatRules.length > 0) {
    return generateControlMaps(field, definition.layers, definition.splatRules);
  }
  return solidControlMaps(field.resolution - 1, definition.layers.length);
}

/**
 * Derives the generated shader's shape from the definition and the textures that were built.
 *
 * @param definition - The resolved document.
 * @param layers - The layer texture arrays.
 * @returns The shape.
 */
function splatSpecOf(definition: TerrainDefinition, layers: TerrainLayerTextures): TerrainSplatShaderSpec {
  return {
    layers: definition.layers.map((layer, index) => ({
      triplanar: layer.triplanar,
      hasNormal: layers.hasNormal[index] ?? false,
      color: layer.color,
      tiling: layer.tiling,
    })),
    textured: layers.albedo !== null,
    normals: layers.normals !== null,
  };
}
