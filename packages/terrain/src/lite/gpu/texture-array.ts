import { createTexture2DArrayFromPixels } from "@babylonjs/lite";
import type { EngineContext, Texture2DArray } from "@babylonjs/lite";

/**
 * The texture-array half of the terrain's Babylon Lite adapter
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2).
 *
 * Core's `TextureAsset.fromPixels` creates only a `texture_2d`, so the layer array is created here
 * with `createTexture2DArrayFromPixels` (`@babylonjs/lite@1.27.0` `index.d.ts` 3323) and wrapped in
 * a `TextureAsset` by `src/assets/layer-textures.ts`; `Texture2DArray` extends `Texture2D`, so the
 * asset releases it through the same pool. The report asks core for `TextureAsset.fromPixelsArray`,
 * which would retire this file.
 */

/**
 * The options {@link createLayerTextureArray} takes.
 *
 * @internal
 */
export interface LayerTextureArrayOptions {
  /** Decode to linear on sample; albedo yes, normals no. */
  readonly srgb: boolean;
}

/**
 * Creates a 2D texture array from layer-major RGBA8 bytes, with a mip chain per layer, repeating
 * on both axes with linear filtering — the sampler a tiled terrain texture wants.
 *
 * @param engine - The engine that owns the GPU texture.
 * @param data - `width * height * layers * 4` bytes, layer-major, top row first.
 * @param width - Layer width in texels.
 * @param height - Layer height in texels.
 * @param layers - How many layers.
 * @param options - Colour space.
 * @returns The array; its reference count starts at an implicit one.
 *
 * @internal
 */
export function createLayerTextureArray(
  engine: EngineContext,
  data: Uint8Array,
  width: number,
  height: number,
  layers: number,
  options: LayerTextureArrayOptions,
): Texture2DArray {
  return createTexture2DArrayFromPixels(engine, data, width, height, layers, {
    mipMaps: true,
    srgb: options.srgb,
    addressModeU: "repeat",
    addressModeV: "repeat",
    minFilter: "linear",
    magFilter: "linear",
  });
}
