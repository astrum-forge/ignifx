import { defineTerrain } from "../definition/define-terrain.js";
import { R16_FILE_EXTENSION, TERRAIN_ASSET_TYPE, TERRAIN_FILE_EXTENSIONS } from "../definition/types.js";
import { TerrainErrorCode, terrainError } from "../errors.js";
import { decodeRgbaImage } from "../heightfield/image.js";
import { decodePng, isPng, pngToSamples16 } from "../heightfield/png.js";
import { decodeR16 } from "../heightfield/r16.js";
import { packLayerImages } from "./layer-textures.js";
import { buildTerrainAsset, TerrainAsset } from "./terrain-asset.js";
import type { TerrainLayerImages } from "./layer-textures.js";
import type { TerrainAssetSources } from "./terrain-asset.js";
import type { TerrainDefinition } from "../definition/types.js";
import type { RgbaImage } from "../heightfield/image.js";
import type { AssetLoader, LoaderContext } from "@ignifx/core";

/**
 * The two loaders `@ignifx/terrain` registers: `.terrain.json` documents, and the raw `.r16`
 * heightmaps they name (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * Every image a terrain needs is fetched as **bytes** and decoded by this package, because no
 * browser image API returns a 16-bit PNG losslessly (spike S0.3) and a layer image has to reach a
 * texture array rather than a `texture_2d`.
 */

/**
 * The asset type a raw heightmap is registered under; the Vite plugin maps `.r16` to it.
 *
 * @public
 */
export const HEIGHTMAP_ASSET_TYPE = "heightmap";

/**
 * The address suffixes that select the heightmap loader.
 *
 * @public
 */
export const HEIGHTMAP_FILE_EXTENSIONS: readonly string[] = Object.freeze([R16_FILE_EXTENSION]);

/** The core asset type that fetches bytes; layer images and control maps arrive through it. */
const BINARY_ASSET_TYPE = "binary";

/** The largest value a 16-bit sample holds. */
const MAX_SAMPLE_16 = 65_535;

/**
 * The loader for raw heightmaps: it fetches the bytes and decodes nothing, because only the
 * `.terrain.json` that names the file knows its resolution.
 *
 * @returns The loader, for `ExtensionContext.registerAssetLoader`.
 *
 * @public
 */
export function createHeightmapLoader(): AssetLoader<ArrayBuffer> {
  return {
    type: HEIGHTMAP_ASSET_TYPE,
    extensions: HEIGHTMAP_FILE_EXTENSIONS,
    load: (ctx: LoaderContext): Promise<ArrayBuffer> => ctx.fetchBytes(),
  };
}

/**
 * The loader for `.terrain.json` documents.
 *
 * @returns The loader, for `ExtensionContext.registerAssetLoader`.
 *
 * @example
 * ```ts
 * const island = await app.assets.loadAsync<TerrainAsset>("terrain/island.terrain.json");
 * ```
 *
 * @public
 */
export function createTerrainLoader(): AssetLoader<TerrainAsset> {
  return {
    type: TERRAIN_ASSET_TYPE,
    extensions: TERRAIN_FILE_EXTENSIONS,
    load: (ctx: LoaderContext): Promise<TerrainAsset> => loadTerrain(ctx),
    unload: (value: unknown): void => {
      if (value instanceof TerrainAsset) {
        value.dispose();
      }
    },
  };
}

/**
 * Reads a `.terrain.json`, fetches everything it names, and builds the asset.
 *
 * @param ctx - The loader context.
 * @returns The asset.
 */
async function loadTerrain(ctx: LoaderContext): Promise<TerrainAsset> {
  const document = await ctx.fetchJson();
  const definition = defineTerrain(asInput(document, ctx.address), ctx.address);
  const sources: TerrainAssetSources = {
    heights: await readHeights(ctx, definition),
    layerImages: await readLayerImages(ctx, definition),
    controlImages: await readControlImages(ctx, definition),
  };
  ctx.reportProgress(1);
  return await buildTerrainAsset(ctx.app, ctx.address, definition, sources);
}

/**
 * Narrows a fetched document to the input shape `defineTerrain` validates.
 *
 * @param document - What the fetch returned.
 * @param address - The document's address, for the message.
 * @returns The document.
 * @throws IgnifxError with code `IGX-1601` when it is not an object.
 */
function asInput(document: unknown, address: string): Record<string, unknown> {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw terrainError(TerrainErrorCode.invalidTerrainFile, `${address} is not a JSON object.`, {
      context: { file: address },
      hint: "A .terrain.json holds one object with format, formatVersion, size and resolution.",
    });
  }
  // JSON is a system boundary; `defineTerrain` is what checks every field (coding standards §5.2).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return document as Record<string, unknown>;
}

/**
 * Fetches and decodes the heightmap, or returns `null` so the asset generates its noise.
 *
 * @param ctx - The loader context.
 * @param definition - The resolved document.
 * @returns The heights in metres, or `null`.
 * @throws IgnifxError with code `IGX-1608` when the decoded sample count does not match the
 * declared resolution, or `IGX-1606` when a PNG cannot be read.
 */
async function readHeights(ctx: LoaderContext, definition: TerrainDefinition): Promise<Float32Array | null> {
  const heightmap = definition.heightmap;
  if (heightmap === null) {
    return null;
  }
  const bytes = await fetchBytes(ctx, heightmap.source, HEIGHTMAP_ASSET_TYPE);
  const samples = await decodeHeightmap(ctx, bytes, heightmap.source, definition.resolution);
  const expected = definition.resolution * definition.resolution;
  if (samples.length !== expected) {
    throw terrainError(
      TerrainErrorCode.heightmapSizeMismatch,
      `${heightmap.source} decoded to ${String(samples.length)} samples, not the ${String(expected)} its resolution declares.`,
      {
        context: { file: heightmap.source, actual: samples.length, expected },
        hint: `A ${String(definition.resolution)} resolution needs a ${String(definition.resolution)}x${String(definition.resolution)} heightmap.`,
      },
    );
  }
  const scale = definition.size.height / MAX_SAMPLE_16;
  const heights = new Float32Array(expected);
  for (let index = 0; index < expected; index += 1) {
    heights[index] = (samples[index] ?? 0) * scale;
  }
  return heights;
}

/**
 * Decodes a heightmap's bytes: `.r16` raw, or a PNG through the package's decoder.
 *
 * @param ctx - The loader context, for the terracing warning.
 * @param bytes - The file's bytes.
 * @param address - The file's address, for messages.
 * @param resolution - The declared samples per side, which sizes a `.r16`.
 * @returns The 16-bit samples.
 */
async function decodeHeightmap(
  ctx: LoaderContext,
  bytes: ArrayBuffer,
  address: string,
  resolution: number,
): Promise<Uint16Array> {
  const view = new Uint8Array(bytes);
  if (!isPng(view)) {
    return decodeR16(bytes, resolution, address);
  }
  const png = await decodePng(view, address);
  if (png.bitDepth === 8) {
    ctx.app.log.warn(
      `${TerrainErrorCode.eightBitHeightmap}: {file} is an 8-bit heightmap, which terraces; ` +
        "convert it with `ignifx import heightmap`.",
      address,
    );
  }
  return pngToSamples16(png);
}

/**
 * Fetches and decodes every layer's albedo and normal map.
 *
 * @param ctx - The loader context.
 * @param definition - The resolved document.
 * @returns The packed images, or `null` when no layer names one.
 */
async function readLayerImages(ctx: LoaderContext, definition: TerrainDefinition): Promise<TerrainLayerImages | null> {
  const albedo = await Promise.all(definition.layers.map((layer) => readImage(ctx, layer.albedo)));
  const normals = await Promise.all(definition.layers.map((layer) => readImage(ctx, layer.normal ?? "")));
  return packLayerImages(albedo, normals, ctx.address);
}

/**
 * Fetches and decodes the painted control maps.
 *
 * @param ctx - The loader context.
 * @param definition - The resolved document.
 * @returns One square RGBA map per four layers, or `null` when the document paints none.
 * @throws IgnifxError with code `IGX-1606` when a map is not square.
 */
async function readControlImages(
  ctx: LoaderContext,
  definition: TerrainDefinition,
): Promise<readonly { readonly size: number; readonly data: Uint8Array }[] | null> {
  const splat = definition.splat;
  if (splat === null) {
    return null;
  }
  const decoded = await Promise.all(splat.control.map((address) => readImage(ctx, address)));
  const maps: { readonly size: number; readonly data: Uint8Array }[] = [];
  for (let index = 0; index < decoded.length; index += 1) {
    const image = decoded[index] ?? null;
    const address = splat.control[index] ?? "";
    if (image === null) {
      continue;
    }
    if (image.width !== image.height) {
      throw terrainError(
        TerrainErrorCode.unsupportedImage,
        `${address} is not an image the built-in decoder reads: a control map must be square, and this one is ${String(image.width)}x${String(image.height)}.`,
        { context: { file: address, reason: "control map is not square" } },
      );
    }
    maps.push({ size: image.width, data: image.data });
  }
  return maps.length === 0 ? null : maps;
}

/**
 * Fetches and decodes one image, or answers `null` for an empty address.
 *
 * @param ctx - The loader context.
 * @param address - The image's address.
 * @returns The decoded image, or `null`.
 */
async function readImage(ctx: LoaderContext, address: string): Promise<RgbaImage | null> {
  if (address === "") {
    return null;
  }
  return decodeRgbaImage(await fetchBytes(ctx, address, BINARY_ASSET_TYPE), address);
}

/**
 * Loads one dependency as raw bytes.
 *
 * @param ctx - The loader context.
 * @param address - The dependency's address.
 * @param type - The asset type to load it as, which overrides the extension.
 * @returns The bytes.
 */
async function fetchBytes(ctx: LoaderContext, address: string, type: string): Promise<ArrayBuffer> {
  const handle = await ctx.loadDependency<ArrayBuffer>(address, { type });
  return handle.value;
}
