import { AnimatorAsset } from "./animator-asset.js";
import { ANIMATOR_ASSET_TYPE, ANIMATOR_FILE_EXTENSIONS, defineAnimator } from "./definition.js";
import type { AnimatorInput } from "./definition.js";
import type { AssetLoader, LoaderContext } from "@ignifx/core";

/**
 * The `animator` asset loader (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * The document is pure data — parameters, states, transitions — so the loader needs no device and
 * behaves identically under a headless app. It does not load the model whose clips it names: the
 * `Animator` component reads those off the `Model` sharing its entity, and loading a second copy
 * would double the upload.
 */

/**
 * Builds the loader for `.animator.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createAnimatorLoader());
 * ```
 *
 * @public
 */
export function createAnimatorLoader(): AssetLoader<AnimatorAsset> {
  return {
    type: ANIMATOR_ASSET_TYPE,
    extensions: ANIMATOR_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<AnimatorAsset> {
      const raw = await ctx.fetchJson<AnimatorInput>();
      return new AnimatorAsset(ctx.address, defineAnimator(raw, ctx.address));
    },
  };
}
