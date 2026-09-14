import { TEXTURE_ASSET_TYPE, TextureAsset } from "@ignifx/core";
import { TerrainErrorCode, terrainError } from "../errors.js";
import { createLayerTextureArray } from "../lite/gpu/texture-array.js";
import type { RgbaImage } from "../heightfield/image.js";
import type { App, AssetHandle } from "@ignifx/core";

/**
 * A terrain's layer images and the `texture_2d_array` handles built from them
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2).
 *
 * Eight layers cost two samplers instead of sixteen, which is what keeps the splat inside the
 * plugin sampler budget. Headless the arrays are not uploaded, but the size check still runs, so a
 * Node test can assert `IGX-1607`.
 */

/** A flat tangent-space normal, so a layer without a map perturbs nothing. */
const FLAT_NORMAL: readonly [number, number, number, number] = Object.freeze([128, 128, 255, 255]);

/** Opaque white, so a layer without an albedo image shows its tint. */
const WHITE_TEXEL: readonly [number, number, number, number] = Object.freeze([255, 255, 255, 255]);

/** Bytes per RGBA texel. */
const BYTES_PER_TEXEL = 4;

/**
 * The decoded layer images of one terrain, all the same size.
 *
 * @public
 */
export interface TerrainLayerImages {
  /** Every layer's width, in texels. */
  readonly width: number;
  /** Every layer's height, in texels. */
  readonly height: number;
  /** One RGBA8 image per layer, in layer order. */
  readonly albedo: readonly Uint8Array[];
  /** One RGBA8 normal map per layer, or `null` for a layer without one. */
  readonly normals: readonly (Uint8Array | null)[];
}

/**
 * The texture assets a terrain material samples its layers through.
 *
 * @public
 */
export interface TerrainLayerTextures {
  /** The albedo array, one slice per layer; `null` for a terrain with no layer images. */
  readonly albedo: AssetHandle<TextureAsset> | null;
  /** The normal array, or `null` when no layer carries a normal map. */
  readonly normals: AssetHandle<TextureAsset> | null;
  /** Which layers carry a normal map, in layer order. */
  readonly hasNormal: readonly boolean[];
}

/**
 * Checks that every decoded layer image shares one size and packs them into layer order.
 *
 * @param albedo - One albedo image per layer; `null` entries become opaque white.
 * @param normals - One normal map per layer, or `null` for a layer without one.
 * @param file - The terrain's address, for messages.
 * @returns The packed images, or `null` when no layer supplied an image at all.
 * @throws IgnifxError with code `IGX-1607` when two images differ in size.
 *
 * @public
 */
export function packLayerImages(
  albedo: readonly (RgbaImage | null)[],
  normals: readonly (RgbaImage | null)[],
  file: string,
): TerrainLayerImages | null {
  const reference = checkSizes(albedo, normals, file);
  if (reference === null) {
    return null;
  }
  const texels = reference.width * reference.height;
  const packedAlbedo: Uint8Array[] = [];
  const packedNormals: (Uint8Array | null)[] = [];
  for (let index = 0; index < albedo.length; index += 1) {
    packedAlbedo.push(albedo[index]?.data ?? solid(texels, WHITE_TEXEL));
    packedNormals.push(normals[index]?.data ?? null);
  }
  return { width: reference.width, height: reference.height, albedo: packedAlbedo, normals: packedNormals };
}

/**
 * Builds the albedo and normal texture arrays of a terrain and publishes them as texture assets.
 *
 * @remarks
 * Headless both handles wrap `null` GPU textures and nothing is uploaded; the assets still report
 * their size. Each handle has one holder — the `TerrainAsset`, which releases it when it unloads.
 *
 * @param app - The app whose engine uploads and whose asset service publishes.
 * @param name - The terrain's address, which prefixes the texture addresses.
 * @param images - The packed layer images, or `null` for a textureless terrain.
 * @returns The texture handles.
 *
 * @public
 */
export function createLayerTextures(app: App, name: string, images: TerrainLayerImages | null): TerrainLayerTextures {
  if (images === null || images.albedo.length === 0) {
    return { albedo: null, normals: null, hasNormal: [] };
  }
  const hasNormal = images.albedo.map((_layer, index) => (images.normals[index] ?? null) !== null);
  const albedo = publishArray(app, `${name}#albedo`, images.albedo, images.width, images.height, true);
  let normals: AssetHandle<TextureAsset> | null = null;
  if (hasNormal.some((flag) => flag)) {
    const texels = images.width * images.height;
    const filled = images.albedo.map((_layer, index) => images.normals[index] ?? solid(texels, FLAT_NORMAL));
    normals = publishArray(app, `${name}#normals`, filled, images.width, images.height, false);
  }
  return { albedo, normals, hasNormal };
}

/**
 * Refuses a set of images whose sizes differ, and reports the size they all share.
 *
 * @param albedo - The albedo images.
 * @param normals - The normal maps.
 * @param file - The terrain's address, for messages.
 * @returns The shared size, or `null` when every entry is `null`.
 * @throws IgnifxError with code `IGX-1607`.
 */
function checkSizes(
  albedo: readonly (RgbaImage | null)[],
  normals: readonly (RgbaImage | null)[],
  file: string,
): RgbaImage | null {
  let reference: RgbaImage | null = null;
  for (let index = 0; index < albedo.length; index += 1) {
    for (const image of [albedo[index] ?? null, normals[index] ?? null]) {
      if (image === null) {
        continue;
      }
      reference ??= image;
      if (image.width !== reference.width || image.height !== reference.height) {
        throw terrainError(
          TerrainErrorCode.layerSizeMismatch,
          `${file} layer ${String(index)} is ${String(image.width)}x${String(image.height)}; every layer texture must be ${String(reference.width)}x${String(reference.height)}.`,
          {
            context: {
              file,
              layer: index,
              width: image.width,
              height: image.height,
              expectedWidth: reference.width,
              expectedHeight: reference.height,
            },
            hint: "A texture array needs equal layer sizes; resize the textures to match.",
          },
        );
      }
    }
  }
  return reference;
}

/**
 * One RGBA8 image of a single repeated texel.
 *
 * @param texels - How many texels the image holds.
 * @param color - The texel, as four bytes.
 * @returns The image.
 */
function solid(texels: number, color: readonly [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(texels * BYTES_PER_TEXEL);
  for (let texel = 0; texel < texels; texel += 1) {
    const at = texel * BYTES_PER_TEXEL;
    out[at] = color[0];
    out[at + 1] = color[1];
    out[at + 2] = color[2];
    out[at + 3] = color[3];
  }
  return out;
}

/**
 * Concatenates layer images into the layer-major buffer a texture-array upload takes.
 *
 * @param layers - One RGBA8 image per layer, all the same size.
 * @param width - Layer width.
 * @param height - Layer height.
 * @returns `width * height * layers * 4` bytes.
 */
function concatenate(layers: readonly Uint8Array[], width: number, height: number): Uint8Array {
  const bytesPerLayer = width * height * BYTES_PER_TEXEL;
  const out = new Uint8Array(bytesPerLayer * layers.length);
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer !== undefined) {
      out.set(layer.subarray(0, bytesPerLayer), index * bytesPerLayer);
    }
  }
  return out;
}

/**
 * Uploads one texture array and wraps it in a texture asset.
 *
 * @param app - The app.
 * @param name - The asset's address.
 * @param layers - The layer images.
 * @param width - Layer width.
 * @param height - Layer height.
 * @param srgb - Whether the array decodes to linear on sample.
 * @returns The handle, with one holder.
 */
function publishArray(
  app: App,
  name: string,
  layers: readonly Uint8Array[],
  width: number,
  height: number,
  srgb: boolean,
): AssetHandle<TextureAsset> {
  const texture = app.isHeadless
    ? null
    : createLayerTextureArray(app.lite.engine, concatenate(layers, width, height), width, height, layers.length, {
        srgb,
      });
  // `TextureAsset`'s constructor is `@internal` in core; the report asks for a public
  // `TextureAsset.fromPixelsArray` so this seam closes.
  const asset = new TextureAsset(name, texture, {
    srgb,
    mipMaps: true,
    addressModeU: "repeat",
    addressModeV: "repeat",
    minFilter: "linear",
    magFilter: "linear",
    invertY: false,
    premultiplyAlpha: false,
  });
  return app.assets.register(asset, { type: TEXTURE_ASSET_TYPE, address: name });
}
