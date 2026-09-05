import { loadTexture } from "../../lite/gpu/texture.js";
import { readTextureImportOptions, TEXTURE_ASSET_TYPE, TextureAsset, toLiteTextureOptions } from "../texture-asset.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";

/**
 * The `texture` asset loader (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * ## Lite fetches the bytes, not ignifx
 *
 * Every other GPU loader here reads through `ctx.fetchBytes`, which is what gives it progress,
 * cancellation, and retries. A texture cannot: `loadTexture2D` takes a **URL** and decodes it with
 * `createImageBitmap`, which is the browser's own hardware-accelerated decode path
 * (`src/lite/gpu/texture.ts`). Handing it bytes would mean decoding a PNG in JavaScript. So the
 * loader hands Lite `ctx.url` and reports its own coarse progress instead, and a texture's
 * `AbortSignal` stops the *request* rather than the fetch. The trade is deliberate and it is the
 * one place §5's "the three `fetch*` methods are the only network paths" does not hold; the
 * alternative is worse.
 *
 * ## Options come from the sidecar
 *
 * `.meta.json` sidecars carry per-asset import options (§7), the build copies them into the
 * manifest entry, and `ctx.meta` is how a loader reads its own block. sRGB is the one that matters:
 * a base-colour or emissive texture wants it, and a normal, ORM, or data map must not have it.
 */

/**
 * Builds the loader for `.png`, `.jpg`, `.jpeg`, `.webp`, `.ktx2`, and `.basis` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createTextureLoader());
 * ```
 *
 * @public
 */
export function createTextureLoader(): AssetLoader<TextureAsset> {
  return {
    type: TEXTURE_ASSET_TYPE,
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".basis"],
    async load(ctx: LoaderContext): Promise<TextureAsset> {
      const options = readTextureImportOptions(ctx.meta);
      if (ctx.app.isHeadless) {
        // §5: "a loader must tolerate the null engine (return CPU-only data with `gpu: null`)".
        return new TextureAsset(ctx.address, null, options);
      }
      ctx.reportProgress(0);
      const texture = await loadTexture(ctx.lite.engine, ctx.url, toLiteTextureOptions(options));
      ctx.reportProgress(1);
      return new TextureAsset(ctx.address, texture, options);
    },
    unload(value: TextureAsset): void {
      value.releaseGpu();
    },
  };
}
