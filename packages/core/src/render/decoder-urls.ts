import type { App } from "../app/types.js";
import type { AssetManifest } from "../assets/types.js";
import type { LiteDecoderUrls } from "../lite/gpu/decoders.js";

/**
 * Where Babylon Lite loads its run-time decoders from (`docs/architecture/05-assets-and-loading.md`
 * §7): the KTX2 decoder and its transcoders, the meshopt decoder and the Draco decoder.
 *
 * Lite fetches the first three from `cdn.babylonjs.com` by default, which a packaged game's
 * `script-src 'self'` refuses, and the Draco decoder from the page's root (`/`), where nothing
 * serves it. `@ignifx/core` therefore ships the files (`decoders/`, written by
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
 * The file name of the Draco decoder script Lite injects.
 *
 * @internal
 */
export const DRACO_DECODER_FILE = "draco_decoder.js";

/**
 * The file name of the WebAssembly the Draco decoder script fetches from its own directory.
 *
 * @internal
 */
export const DRACO_WASM_FILE = "draco_decoder_gltf.wasm";

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
 * they are ignored when the manifest has no `babylon.ktx2Decoder.js`. Lite takes the meshopt and
 * Draco decoders' **directories**, so an entry is used only when its URL ends in the file name, and
 * the Draco script only when its WebAssembly is listed in the same directory.
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
  const meshoptBaseUrl = directoryOf(urls.get(MESHOPT_DECODER_FILE), MESHOPT_DECODER_FILE);
  const dracoDirectory = directoryOf(urls.get(DRACO_DECODER_FILE), DRACO_DECODER_FILE);
  const dracoBaseUrl =
    dracoDirectory !== null && urls.get(DRACO_WASM_FILE) === `${dracoDirectory}${DRACO_WASM_FILE}`
      ? dracoDirectory
      : null;
  return { ktx2Decoder, ktx2Transcoders, meshoptBaseUrl, dracoBaseUrl };
}

/**
 * The directory a file is served from, when its URL ends in the name Lite appends.
 *
 * @param url - The manifest URL, or `undefined` when the manifest has no entry.
 * @param file - The file name Lite appends to the directory.
 * @returns The directory with its trailing slash, or `null`.
 */
function directoryOf(url: string | undefined, file: string): string | null {
  return url?.endsWith(file) === true ? url.slice(0, url.length - file.length) : null;
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
  if (urls.ktx2Decoder === null && urls.meshoptBaseUrl === null && urls.dracoBaseUrl === null) {
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
