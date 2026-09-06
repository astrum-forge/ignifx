import { resolveRelative } from "../assets/relative.js";
import { defineSpriteAnimation, SPRITE_ANIMATION_ASSET_TYPE, SPRITE_ANIMATION_FILE_EXTENSIONS } from "./definition.js";
import { SpriteAnimationAsset } from "./sprite-animation-asset.js";
import type { SpriteAnimationInput } from "./definition.js";
import type { AssetLoader, LoaderContext } from "@ignifx/core";

/**
 * The `spriteanimation` asset loader (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * The document is pure data — clip names, frame names, rates — so the loader needs no device and
 * behaves identically under a headless app. It does not load the atlas it names: a `SpriteAnimator`
 * already has one on its `SpriteRenderer`, and forcing a second copy would double the upload.
 * `SpriteAnimationAsset.atlasAddress` carries the reference for a game that wants to load it.
 */

/**
 * Builds the loader for `.spriteanim.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createSpriteAnimationLoader());
 * ```
 *
 * @public
 */
export function createSpriteAnimationLoader(): AssetLoader<SpriteAnimationAsset> {
  return {
    type: SPRITE_ANIMATION_ASSET_TYPE,
    extensions: SPRITE_ANIMATION_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<SpriteAnimationAsset> {
      const raw = await ctx.fetchJson<SpriteAnimationInput>();
      const definition = defineSpriteAnimation(raw, ctx.address);
      const atlasAddress = definition.atlas === "" ? "" : resolveRelative(ctx.address, definition.atlas);
      return new SpriteAnimationAsset(ctx.address, definition, atlasAddress);
    },
  };
}
