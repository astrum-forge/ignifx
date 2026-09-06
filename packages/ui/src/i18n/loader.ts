import { I18N_ASSET_TYPE, I18N_FILE_EXTENSIONS, LocaleAsset, parseLocaleFile } from "./locale-file.js";
import type { AssetLoader, LoaderContext } from "@ignifx/core";

/**
 * The `i18n` asset loader: `.i18n.json` to {@link LocaleAsset}
 * (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * The file is data, so the loader is identical under Node and in a browser and has nothing to
 * release on unload. `.i18n.json` is a longer suffix than `.json` and the asset service picks the
 * longest match, so registering it does not shadow the generic JSON loader.
 */

/**
 * Builds the loader for `.i18n.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createLocaleLoader());
 * ```
 *
 * @public
 */
export function createLocaleLoader(): AssetLoader<LocaleAsset> {
  return {
    type: I18N_ASSET_TYPE,
    extensions: I18N_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<LocaleAsset> {
      const parsed: unknown = await ctx.fetchJson();
      return new LocaleAsset(ctx.address, parseLocaleFile(parsed, ctx.address));
    },
  };
}
