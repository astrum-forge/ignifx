import { createFontFromBytes } from "../../lite/font.js";
import { FONT_ASSET_TYPE, FONT_FILE_EXTENSIONS, FontAsset } from "../font-asset.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";

/**
 * The `font` asset loader (`docs/architecture/05-assets-and-loading.md` §5, the `font` row).
 *
 * It is the only core rendering loader with no headless branch. `createFontFromBuffer`
 * (`index.d.ts` 2527) parses the byte range and touches no device, so a font loads identically
 * under the null engine and under a real one — which is what makes the whole path, including the
 * fetch, testable in Node.
 *
 * A file Lite cannot parse throws from inside the parser; the asset service retries it and then
 * settles the handle with `IGX-0505`, carrying the parser's own message as `cause`. There is
 * nothing to release on unload: a Lite `Font` is a branded value with no disposer and no GPU
 * resource.
 */

/**
 * Builds the loader for `.ttf` and `.otf` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createFontLoader());
 * ```
 *
 * @public
 */
export function createFontLoader(): AssetLoader<FontAsset> {
  return {
    type: FONT_ASSET_TYPE,
    extensions: FONT_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<FontAsset> {
      const bytes = await ctx.fetchBytes();
      return new FontAsset(ctx.address, createFontFromBytes(bytes), bytes.byteLength);
    },
  };
}
