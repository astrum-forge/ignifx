import type { App } from "../app/types.js";
import type { AssetManifest } from "../assets/types.js";
import type { LiteDecoderUrls } from "../lite/gpu/decoders.js";

/**
 * Where Babylon Lite loads its run-time decoders from (`docs/architecture/05-assets-and-loading.md`
 * §7): the KTX2 decoder and its transcoders, and the meshopt decoder.
 *
 * Lite fetches all of them from `cdn.babylonjs.com` by default, which a packaged game's
 * `script-src 'self'` refuses. `@ignifx/core` therefore ships the files (`decoders/`, written by
 * `pnpm vendor:decoders`) and lists them in its `ignifx.assets.public`, so `@ignifx/vite-plugin`
 * serves them in development, copies them unhashed into the build, and writes a manifest entry for
 * each at its bare file name. Before the first load that can need a decoder, the texture and model
 * loaders call {@link configureDecoders}, which points Lite at whichever of those entries the
 * manifest has. A decoder the manifest does not list keeps Lite's default, so a project without the
 * plugin behaves exactly as before; it can self-host by adding the entries to its own manifest.
 */

/**
 * The file name of the KTX2 decoder script Lite injects.
 *
 * @internal
 */
export const KTX2_DECODER_FILE = "babylon.ktx2Decoder.js";

/**
 * The file name of the meshopt decoder script Lite injects.
 *
 * @internal
 */
export const MESHOPT_DECODER_FILE = "meshopt_decoder.js";

/**
 * The transcoder modules `babylon.ktx2Decoder.js` fetches, as `[class, static property, file]`:
 * the class in the decoder's `KTX2DECODER` namespace whose property holds the URL, and the file
 * name it is served under. These are the defaults in `@babylonjs/ktx2decoder`'s
 * `Transcoders/*.js` and `zstddec.js`.
 *
 * @internal
 */
export const KTX2_TRANSCODER_FILES: readonly (readonly [string, string, string])[] = [
  ["MSCTranscoder", "JSModuleURL", "msc_basis_transcoder.js"],
  ["MSCTranscoder", "WasmModuleURL", "msc_basis_transcoder.wasm"],
  ["ZSTDDecoder", "WasmModuleURL", "zstddec.wasm"],
  ["LiteTranscoder_UASTC_ASTC", "WasmModuleURL", "uastc_astc.wasm"],
  ["LiteTranscoder_UASTC_BC7", "WasmModuleURL", "uastc_bc7.wasm"],
  ["LiteTranscoder_UASTC_R8_UNORM", "WasmModuleURL", "uastc_r8_unorm.wasm"],
  ["LiteTranscoder_UASTC_RG8_UNORM", "WasmModuleURL", "uastc_rg8_unorm.wasm"],
  ["LiteTranscoder_UASTC_RGBA_SRGB", "WasmModuleURL", "uastc_rgba8_srgb_v2.wasm"],
  ["LiteTranscoder_UASTC_RGBA_UNORM", "WasmModuleURL", "uastc_rgba8_unorm_v2.wasm"],
];

/**
 * Reads the decoder locations a manifest records.
 *
 * @remarks
 * The transcoders are only worth overriding together with the decoder script that reads them, so
 * they are ignored when the manifest has no `babylon.ktx2Decoder.js`. Lite takes the meshopt
 * decoder's **directory**, so its entry is used only when its URL ends in the file name.
 *
 * @param manifest - The asset manifest.
 * @returns The locations; a `null` field means the manifest does not list that decoder.
 *
 * @example
 * ```ts
 * decoderUrlsFromManifest(app.assets.manifest).ktx2Decoder; // "/assets/babylon.ktx2Decoder.js"
 * ```
 *
 * @internal
 */
export function decoderUrlsFromManifest(manifest: AssetManifest): LiteDecoderUrls {
  const urls = new Map<string, string>();
  for (const entry of manifest.entries) {
    urls.set(entry.address, entry.url);
  }
  const ktx2Decoder = urls.get(KTX2_DECODER_FILE) ?? null;
  const ktx2Transcoders: Record<string, Record<string, string>> = {};
  if (ktx2Decoder !== null) {
    for (const [name, property, file] of KTX2_TRANSCODER_FILES) {
      const url = urls.get(file);
      if (url !== undefined) {
        ktx2Transcoders[name] = { ...ktx2Transcoders[name], [property]: url };
      }
    }
  }
  const meshoptUrl = urls.get(MESHOPT_DECODER_FILE);
  const meshoptBaseUrl =
    meshoptUrl?.endsWith(MESHOPT_DECODER_FILE) === true
      ? meshoptUrl.slice(0, meshoptUrl.length - MESHOPT_DECODER_FILE.length)
      : null;
  return { ktx2Decoder, ktx2Transcoders, meshoptBaseUrl };
}

/** What {@link configureDecoders} last handed Lite, so an unchanged manifest costs one comparison. */
let appliedKey: string | null = null;

/**
 * Points Lite at the decoders the app's manifest lists, before a load that may need one.
 *
 * @remarks
 * Lite's decoder locations are process-wide, so two apps on one page with different manifests share
 * the last one applied. Lite loads the KTX2 decoder once and keeps it, so this has to run before the
 * first KTX2 texture — the texture and model loaders call it at the start of every load, and a call
 * whose manifest has not changed does nothing.
 *
 * @param app - The app whose manifest to read.
 * @returns Once Lite has been told; immediately when the manifest lists no decoder.
 *
 * @internal
 */
export async function configureDecoders(app: App): Promise<void> {
  const urls = decoderUrlsFromManifest(app.assets.manifest);
  if (urls.ktx2Decoder === null && urls.meshoptBaseUrl === null) {
    return;
  }
  const key = JSON.stringify(urls);
  if (key === appliedKey) {
    return;
  }
  const decoders = await import("../lite/gpu/decoders.js");
  decoders.applyLiteDecoderUrls(urls);
  appliedKey = key;
}
