import { loadBasisTexture, loadKtx2Texture, loadTexture } from "../../lite/gpu/texture.js";
import { configureDecoders } from "../decoder-urls.js";
import { readTextureImportOptions, TEXTURE_ASSET_TYPE, TextureAsset, toLiteTextureOptions } from "../texture-asset.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";
import type { LiteTexture2D, LiteTexture2DOptions } from "../../lite/gpu/texture.js";
import type { LiteEngine } from "../../lite/scene.js";

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
 * ## The container picks the decoder
 *
 * `.png`, `.jpg`, `.jpeg` and `.webp` go to `loadTexture2D` and the browser's image decoder.
 * `.ktx2` goes to Lite's KTX2 loader and `.basis` to its Basis loader, which transcode to the
 * device's best compressed format (`src/lite/gpu/decoders.ts` lists the targets); handing either
 * to `createImageBitmap` fails with "The source image could not be decoded". The asset type stays
 * `texture` for all six, so the choice is made here, from the address's extension — the one name a
 * manifest entry, a hashed build URL and a hand-written `{ type: "texture" }` load all keep. Before
 * a KTX2 or Basis load, {@link configureDecoders} points Lite at the decoders the manifest lists,
 * which is how a built game avoids `cdn.babylonjs.com`.
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
      const container = textureContainerOf(ctx.address, ctx.url);
      if (container !== "image") {
        await configureDecoders(ctx.app);
      }
      const texture = await loadByContainer(container, ctx.lite.engine, ctx.url, toLiteTextureOptions(options));
      ctx.reportProgress(1);
      return new TextureAsset(ctx.address, texture, options);
    },
    unload(value: TextureAsset): void {
      value.releaseGpu();
    },
  };
}

/**
 * The file formats the texture loader tells apart.
 *
 * @internal
 */
export type TextureContainer = "image" | "ktx2" | "basis";

/**
 * The lowercase extension of a path or URL, without its query or fragment.
 *
 * @param reference - An address or URL.
 * @returns The extension with its dot, or `""`.
 */
function extensionOf(reference: string): string {
  const path = reference.split(/[?#]/u, 1)[0] ?? "";
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/**
 * Decides which Lite loader a texture needs.
 *
 * @remarks
 * The address decides; the URL is consulted only when the address has no extension, which happens
 * when a load passes `{ type: "texture" }` for an address the manifest maps to a file. Anything that
 * is neither `.ktx2` nor `.basis` is an image for the browser to decode.
 *
 * @param address - The asset address.
 * @param url - The URL it resolved to.
 * @returns The container.
 *
 * @example
 * ```ts
 * textureContainerOf("textures/rock.ktx2", "/assets/textures/rock.3f2a1b9c.ktx2"); // "ktx2"
 * ```
 *
 * @internal
 */
export function textureContainerOf(address: string, url: string): TextureContainer {
  const extension = extensionOf(address) || extensionOf(url);
  if (extension === ".ktx2") {
    return "ktx2";
  }
  if (extension === ".basis") {
    return "basis";
  }
  return "image";
}

/**
 * Loads a texture with the Lite loader its container needs.
 *
 * @param container - What the file is.
 * @param engine - The engine that owns the GPU texture.
 * @param url - Where to fetch it from.
 * @param options - Lite's texture options, from the sidecar.
 * @returns The texture.
 */
function loadByContainer(
  container: TextureContainer,
  engine: LiteEngine,
  url: string,
  options: LiteTexture2DOptions,
): Promise<LiteTexture2D> {
  if (container === "ktx2") {
    return loadKtx2Texture(engine, url, options);
  }
  if (container === "basis") {
    return loadBasisTexture(engine, url, options);
  }
  return loadTexture(engine, url, options);
}
