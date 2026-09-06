import { loadTexture2D, releaseTexture } from "@babylonjs/lite";
import type { EngineContext, SpriteSampling, Texture2D } from "@babylonjs/lite";

/**
 * The device-only half of the atlas adapter: uploading an atlas image and releasing it again.
 * Every line here needs `engine._device`, so the module lives under `gpu/` and the root Vitest
 * coverage config excludes it; the `browser` project covers it instead
 * (`vitest.config.ts`, and the same rule core's `src/lite/gpu/**` follows).
 *
 * Everything here is `@internal`.
 */

/**
 * Uploads an atlas image with the sampler settings a sprite atlas needs.
 *
 * @remarks
 * Four of the five options are not defaults and each one matters, and Lite's own `loadSpriteAtlas`
 * chooses exactly the same set (`lib/sprite/shared/sprite-atlas.js`):
 *
 * - `invertY: false` — Lite's `Texture2DOptions.invertY` defaults to **`true`** (`index.d.ts`
 *   12923) to match Babylon's convention, but sprite UVs are top-down with the origin at the image
 *   top-left, so flipping would put every frame upside down.
 * - `mipMaps: false` — a sprite is drawn at roughly one texel per pixel; a mip chain only costs
 *   memory and blurs a pixel-perfect camera.
 * - `addressModeU`/`addressModeV: "clamp-to-edge"` — the default `"repeat"` lets a frame at the
 *   image edge sample its opposite edge.
 * - `minFilter`/`magFilter` — `"nearest"` is what pixel art needs; anything else blends adjacent
 *   texels and defeats `Camera2D.pixelPerfect`.
 *
 * @param engine - The engine that owns the GPU texture.
 * @param url - Where to fetch the image from.
 * @param sampling - The min/mag filter.
 * @param premultiplyOnLoad - Whether to premultiply alpha at decode time.
 * @returns The uploaded texture; its reference count starts at an implicit one.
 *
 * @internal
 */
export function loadAtlasTexture(
  engine: EngineContext,
  url: string,
  sampling: SpriteSampling,
  premultiplyOnLoad: boolean,
): Promise<Texture2D> {
  const filter = sampling === "nearest" ? "nearest" : "linear";
  return loadTexture2D(engine, url, {
    invertY: false,
    mipMaps: false,
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: filter,
    magFilter: filter,
    premultiplyAlpha: premultiplyOnLoad,
  });
}

/**
 * Releases an atlas texture through Lite's reference-counted resource pool.
 *
 * @remarks
 * This is deliberately **not** `disposeSpriteAtlas`. That function calls
 * `atlas.texture.texture.destroy()` unconditionally (`lib/sprite/shared/sprite-atlas.js` line 73)
 * and its own doc says idempotence is not guaranteed and that an atlas built over an
 * externally-owned texture should be freed by whoever owns the texture. ignifx's asset layer owns
 * it, so it releases the texture through the pool instead — the same call
 * `@ignifx/core`'s `TextureAsset` makes.
 *
 * @param texture - The texture to release.
 * @returns `true` when the reference count reached zero and the GPU texture was destroyed.
 *
 * @internal
 */
export function releaseAtlasTexture(texture: Texture2D): boolean {
  return releaseTexture(texture);
}
