import { acquireTexture, loadTexture2D, releaseTexture } from "@babylonjs/lite";
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
