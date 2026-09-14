import {
  acquireTexture,
  createTexture2DFromPixels,
  loadTexture2D,
  releaseTexture,
  updateTexture2DFromPixels,
} from "@babylonjs/lite";
import type { EngineContext, Texture2D, Texture2DOptions } from "@babylonjs/lite";

/**
 * Texture half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §7). Loading
 * uploads to the device, so this module is GPU-only.
 *
 * Everything here is `@internal`.
 *
 * ## Lifetime (verified against `@babylonjs/lite@1.27.0` `lib/resource/gpu-pool.js`)
 *
 * A `Texture2D` has no `dispose`. Lite keeps a process-wide reference count keyed by the underlying
 * `GPUTexture`: `acquireTexture` increments it, `releaseTexture` decrements it and destroys the
 * texture when it reaches zero, returning whether it did. A texture that was never acquired starts
 * at an implicit count of one, so a single `releaseTexture` frees it. This is the mechanism
 * `docs/architecture/07-rendering.md` §7 means by "release texture handles through Lite's resource
 * pool", and it is why the asset layer — not the material — owns a texture's lifetime.
 *
 * ## Colour space
 *
 * `srgb: true` picks an `rgba8unorm-srgb` format so the GPU decodes to linear when sampling. Base
 * colour and emissive textures need it; normal, ORM, and data textures must not have it
 * (`index.d.ts` 12911).
 *
 * ## Textures built from raw pixels
 *
 * `createTexture2DFromPixels` (`index.d.ts` 3347) takes `width * height * 4` bytes of row-major,
 * top-to-bottom, straight-alpha RGBA8 and creates the texture with `COPY_DST` usage, which is what
 * makes `updateTexture2DFromPixels` (13412) legal on it and on nothing else. Its sampler defaults
 * differ from `loadTexture2D`'s and suit a data map: `clamp-to-edge` on both axes, `nearest` on both
 * filters, `srgb` off. Neither call generates mips — a pixel texture is one mip level, so a
 * `linear` minification filter interpolates within level 0 rather than between levels.
 */

/**
 * The Babylon Lite texture a `TextureAsset` wraps, re-exported under an ignifx name so feature code
 * can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4, coding
 * standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteTexture2D = Texture2D;

/**
 * The sampler, mipmap, colour-space, and decode options `loadTexture2D` accepts
 * (`index.d.ts` 12911), re-exported under an ignifx name.
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteTexture2DOptions = Texture2DOptions;

/**
 * Loads a 2D texture from a URL.
 *
 * @param engine - The engine that owns the GPU texture.
 * @param url - Where to fetch it from.
 * @param options - Sampler, mipmap, colour-space, and decode options.
 * @returns The texture. Its reference count starts at an implicit one.
 *
 * @example
 * ```ts
 * const albedo = await loadTexture(engine, "textures/hero-albedo.png", { srgb: true });
 * ```
 *
 * @internal
 */
export function loadTexture(engine: EngineContext, url: string, options?: Texture2DOptions): Promise<Texture2D> {
  return loadTexture2D(engine, url, options);
}

/**
 * The sampler and colour-space overrides {@link createTextureFromPixels} accepts.
 *
 * @remarks
 * Structurally Lite's `PixelsTexture2DOptions` (`index.d.ts` 8819), restated here so the render
 * layer can build one without naming a Lite type.
 *
 * @internal
 */
export interface PixelTextureLiteOptions {
  /** Address mode along U. */
  readonly addressModeU: GPUAddressMode;
  /** Address mode along V. */
  readonly addressModeV: GPUAddressMode;
  /** Minification filter. */
  readonly minFilter: GPUFilterMode;
  /** Magnification filter. */
  readonly magFilter: GPUFilterMode;
  /** Decode to linear on sample (`rgba8unorm-srgb`). */
  readonly srgb: boolean;
}

/**
 * Creates a 2D texture from tightly packed RGBA8 bytes.
 *
 * @param engine - The engine that owns the GPU texture.
 * @param data - `width * height * 4` bytes, row-major, top row first, straight alpha.
 * @param width - The width in texels, at least 1.
 * @param height - The height in texels, at least 1.
 * @param options - Sampler and colour-space overrides.
 * @returns The texture, created with `COPY_DST` so {@link updateTextureFromPixels} can write to it.
 * Its reference count starts at an implicit one.
 *
 * @internal
 */
export function createTextureFromPixels(
  engine: EngineContext,
  data: Uint8Array,
  width: number,
  height: number,
  options: PixelTextureLiteOptions,
): Texture2D {
  return createTexture2DFromPixels(engine, data, width, height, {
    addressModeU: options.addressModeU,
    addressModeV: options.addressModeV,
    minFilter: options.minFilter,
    magFilter: options.magFilter,
    srgb: options.srgb,
  });
}

/**
 * Writes a rectangular region of a pixel texture.
 *
 * @remarks
 * Only legal on a texture from {@link createTextureFromPixels}: any other `Texture2D` was created
 * without `COPY_DST` usage and WebGPU rejects the write.
 *
 * @param engine - The engine that owns the texture.
 * @param texture - The target.
 * @param data - `width * height * 4` bytes for the region, row-major.
 * @param x - The destination origin's column, in texels.
 * @param y - The destination origin's row, in texels.
 * @param width - The region's width, in texels.
 * @param height - The region's height, in texels.
 *
 * @internal
 */
export function updateTextureFromPixels(
  engine: EngineContext,
  texture: Texture2D,
  data: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  updateTexture2DFromPixels(engine, texture, data, x, y, width, height);
}

/**
 * Claims a share of a texture, so a later {@link releaseTextureHandle} by someone else does not
 * destroy it.
 *
 * @param texture - The texture to retain.
 *
 * @internal
 */
export function retainTexture(texture: Texture2D): void {
  acquireTexture(texture);
}

/**
 * Gives up a share of a texture, destroying it when the last share goes.
 *
 * @param texture - The texture to release.
 * @returns `true` when this call destroyed the underlying `GPUTexture`.
 *
 * @internal
 */
export function releaseTextureHandle(texture: Texture2D): boolean {
  return releaseTexture(texture);
}
