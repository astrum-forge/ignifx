import {
  createTextureFromPixels,
  releaseTextureHandle,
  retainTexture,
  updateTextureFromPixels,
} from "../../lite/gpu/texture.js";
import type { LiteTexture2D } from "../../lite/gpu/texture.js";
import type { LiteEngine } from "../../lite/scene.js";
import type { TextureImportOptions } from "../texture-asset.js";

/**
 * The device-only half of `TextureAsset` (`docs/architecture/07-rendering.md` §6).
 *
 * Each function takes the engine or the texture as a nullable and returns early when it is `null`,
 * so the asset keeps no headless branch of its own.
 */

/**
 * Creates a texture from tightly packed RGBA8 bytes, or nothing under a headless app.
 *
 * @param isHeadless - Whether the app has a device.
 * @param engine - The engine that uploads it.
 * @param data - `width * height * 4` bytes, row-major, top row first, straight alpha.
 * @param width - The width in texels.
 * @param height - The height in texels.
 * @param options - The resolved import options; only the sampler subset reaches Lite.
 * @returns The texture, or `null`.
 *
 * @internal
 */
export function createPixelTexture(
  isHeadless: boolean,
  engine: LiteEngine,
  data: Uint8Array,
  width: number,
  height: number,
  options: TextureImportOptions,
): LiteTexture2D | null {
  if (isHeadless) {
    return null;
  }
  return createTextureFromPixels(engine, data, width, height, {
    // The sidecar is JSON, so the sampler modes arrive as plain strings; WebGPU validates them when
    // the sampler is created (the same boundary `toLiteTextureOptions` records).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    addressModeU: options.addressModeU as GPUAddressMode,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    addressModeV: options.addressModeV as GPUAddressMode,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    minFilter: options.minFilter as GPUFilterMode,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    magFilter: options.magFilter as GPUFilterMode,
    srgb: options.srgb,
  });
}

/**
 * Writes a rectangular region of a pixel texture, when it still has one.
 *
 * @param engine - The engine that owns the queue.
 * @param texture - The target, or `null` when the app is headless or the share was released.
 * @param data - The region's RGBA8 bytes.
 * @param x - The destination column.
 * @param y - The destination row.
 * @param width - The region width.
 * @param height - The region height.
 *
 * @internal
 */
export function writePixelTexture(
  engine: LiteEngine,
  texture: LiteTexture2D | null,
  data: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (texture === null) {
    return;
  }
  updateTextureFromPixels(engine, texture, data, x, y, width, height);
}

/**
 * Claims an extra share of a texture, when there is one.
 *
 * @param texture - The texture, or `null`.
 *
 * @internal
 */
export function retainTextureShare(texture: LiteTexture2D | null): void {
  if (texture === null) {
    return;
  }
  retainTexture(texture);
}

/**
 * Gives up a share of a texture, when there is one.
 *
 * @param texture - The texture, or `null`.
 * @returns `true` when this call destroyed the underlying `GPUTexture`.
 *
 * @internal
 */
export function releaseTextureShare(texture: LiteTexture2D | null): boolean {
  return texture === null ? false : releaseTextureHandle(texture);
}
