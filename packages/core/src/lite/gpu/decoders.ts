import {
  getOrCreateSampler,
  loadBasisTexture2D,
  loadKtx2Texture2D,
  setKtx2DecoderUrl,
  setMeshoptBaseUrl,
} from "@babylonjs/lite";
import type { EngineContext, Texture2D, Texture2DOptions } from "@babylonjs/lite";

/**
 * The compressed-texture and decoder half of the Babylon Lite adapter
 * (`docs/architecture/07-rendering.md` §7). Imported only dynamically, from `./texture.ts` and
 * `../../render/decoder-urls.ts`, so a game that loads no KTX2 texture and no glTF carries none of
 * Lite's KTX2, Basis or meshopt glue.
 *
 * Everything here is `@internal`.
 *
 * ## The decoders (verified against `@babylonjs/lite@1.34.0`)
 *
 * `loadKtx2Texture2D` (`index.d.ts` 7892) and the glTF `KHR_texture_basisu` path inject
 * `babylon.ktx2Decoder.js` as a `<script>` and read the `KTX2DECODER` global it defines; that
 * script then fetches its transcoders (`msc_basis_transcoder.js` and `.wasm` for ETC1S,
 * `uastc_*.wasm` for UASTC, `zstddec.wasm` for Zstandard supercompression). glTF
 * `EXT_meshopt_compression` injects `meshopt_decoder.js`. Every one of them comes from
 * `https://cdn.babylonjs.com/` unless `setKtx2DecoderUrl` (12484) and `setMeshoptBaseUrl` (12538)
 * say otherwise (`lib/texture/ktx2-loader.js`, `lib/loader-gltf/meshopt-decode.js`). Both setters
 * write process-wide state, and the KTX2 decoder is loaded once: a URL set after the first KTX2
 * load is ignored until a failed load clears Lite's cached promise.
 *
 * `loadBasisTexture2D` (7771) has no such setter. It always fetches `basis_transcoder.js` and its
 * WASM from `https://cdn.babylonjs.com/basisTranscoder/1/` (`lib/texture/basis-loader.js`), so a
 * `.basis` file cannot load under a `script-src 'self'` policy until Lite adds one.
 *
 * ## Transcode targets
 *
 * Lite picks them; the public API has no override. Its caps come from the device features
 * `texture-compression-{astc,bc,etc2}`, which `createEngine` requests whenever the adapter has
 * them (`lib/engine/engine.js`). The decoder's decision tree (`@babylonjs/ktx2decoder`
 * `transcodeDecisionTree.js`) then gives:
 *
 * - ETC1S: ETC2 (RGB, or RGBA with alpha) when `etc2` is present, else BC7 when `bc` is, else RGBA8.
 * - UASTC: ASTC 4×4 when `astc` is present, else BC7 when `bc` is, else ETC2 when `etc2` is, else
 *   RGBA8.
 *
 * So a Windows or Linux desktop GPU gets BC7, Apple silicon gets ETC2 (ETC1S) or ASTC (UASTC),
 * and a device with no compression feature gets uncompressed RGBA8. `.basis` uses Lite's own
 * order: BC7, ASTC 4×4, ETC2, BC3, BC1, RGBA8.
 */

/**
 * Where Lite should load its decoders from. A `null` field leaves Lite's default for that decoder.
 *
 * @internal
 */
export interface LiteDecoderUrls {
  /** The URL of `babylon.ktx2Decoder.js`, or `null` for Lite's CDN default. */
  readonly ktx2Decoder: string | null;
  /**
   * Overrides for the decoder's transcoder modules: class name in the `KTX2DECODER` namespace →
   * static property → URL, the second argument of `setKtx2DecoderUrl`. Ignored when
   * {@link LiteDecoderUrls.ktx2Decoder} is `null`.
   */
  readonly ktx2Transcoders: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The directory `meshopt_decoder.js` is served from, or `null` for Lite's CDN default. */
  readonly meshoptBaseUrl: string | null;
}

/**
 * Points Lite at the given decoder locations.
 *
 * @param urls - The locations; `null` fields are left as they are.
 *
 * @internal
 */
export function applyLiteDecoderUrls(urls: LiteDecoderUrls): void {
  if (urls.ktx2Decoder !== null) {
    // `setKtx2DecoderUrl` keeps its own reference; a copy keeps the caller's object frozen-safe.
    const transcoders: Record<string, Record<string, string>> = {};
    for (const [name, properties] of Object.entries(urls.ktx2Transcoders)) {
      transcoders[name] = { ...properties };
    }
    setKtx2DecoderUrl(urls.ktx2Decoder, transcoders);
  }
  if (urls.meshoptBaseUrl !== null) {
    setMeshoptBaseUrl(urls.meshoptBaseUrl);
  }
}

/**
 * Loads a `.ktx2` texture through Lite's KTX2 decoder and gives it the requested sampler.
 *
 * @remarks
 * `loadKtx2Texture2D` takes only the URL and the sRGB flag. It uploads the file's own mip chain as
 * stored, with a fixed repeat/linear sampler; the sampler is rebuilt here from `options`.
 *
 * ## Orientation: rows as stored
 *
 * Compressed blocks cannot be flipped at upload, so `invertY` has no effect: the file's first row
 * lands at the top of the GPU texture, which is what a PNG gets with `invertY: false`. Lite marks
 * the handle `invertY` and documents that materials flip V for it (`index.d.ts` 14966), but in
 * 1.34 no material reads the flag, and a props-built PBR material ignores `setTextureTransform`
 * too (its UV-transform variant is enabled only by the glTF builder). Measured in
 * `test/assets/ktx2.browser.test.ts`: a top-row-first `.ktx2` draws upside down next to the same
 * PNG loaded with the default `invertY: true`, and a `.ktx2` encoded from the vertically flipped
 * image draws the same. So a `.ktx2` meant to replace a PNG under the default sidecar is encoded
 * flipped (Basis `setYFlip(true)`); `mipMaps` and `premultiplyAlpha` do not apply either.
 *
 * @param engine - The engine that owns the GPU texture.
 * @param url - Where to fetch the file from.
 * @param options - Colour space and sampler.
 * @returns The texture, transcoded to the device's best compressed format. Its reference count
 * starts at one, like `loadTexture2D`'s.
 *
 * @internal
 */
export async function loadKtx2TextureWithOptions(
  engine: EngineContext,
  url: string,
  options: Texture2DOptions,
): Promise<Texture2D> {
  const texture = await loadKtx2Texture2D(engine, url, options.srgb ?? false);
  const hasMips = texture.texture.mipLevelCount > 1;
  const minFilter = options.minFilter ?? "linear";
  const magFilter = options.magFilter ?? "linear";
  const mipmapFilter: GPUMipmapFilterMode = hasMips ? "linear" : "nearest";
  // WebGPU accepts anisotropy only when every filter is linear; this is Lite's own rule for
  // `loadTexture2D`.
  const allLinear = minFilter === "linear" && magFilter === "linear" && mipmapFilter === "linear";
  texture.sampler = getOrCreateSampler(engine, {
    addressModeU: options.addressModeU ?? "repeat",
    addressModeV: options.addressModeV ?? "repeat",
    minFilter,
    magFilter,
    mipmapFilter,
    maxAnisotropy: allLinear ? 4 : 1,
  });
  return texture;
}

/**
 * Loads a `.basis` texture through Lite's Basis Universal loader.
 *
 * @remarks
 * Sampler and sRGB options apply; `mipMaps` and `invertY` are ignored by Lite. The transcoder always
 * comes from the Babylon CDN (see the module comment).
 *
 * @param engine - The engine that owns the GPU texture.
 * @param url - Where to fetch the file from.
 * @param options - Colour space and sampler.
 * @returns The texture.
 *
 * @internal
 */
export function loadBasisTextureWithOptions(
  engine: EngineContext,
  url: string,
  options: Texture2DOptions,
): Promise<Texture2D> {
  return loadBasisTexture2D(engine, url, options);
}
