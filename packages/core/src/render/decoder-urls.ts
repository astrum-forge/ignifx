import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
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
 * A decoder the plugin's `decoders` option left out is still listed, at a local URL that serves
 * nothing and with {@link LEFT_OUT_DECODER_META_KEY} set, and the loaders fail a file that needs it
 * with `IGX-0508` before fetching anything.
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

/**
 * A group of decoders that `@ignifx/vite-plugin`'s `decoders` option can leave out of a build, named
 * by the option's key.
 *
 * @internal
 */
export type DecoderGroup = "draco" | "meshopt" | "ktx2";

/**
 * The manifest `meta` key `@ignifx/vite-plugin` writes on the entry of each decoder file its
 * `decoders` option left out; the value is the {@link DecoderGroup}. The entry keeps a local URL
 * that serves nothing, so Lite is never pointed at `cdn.babylonjs.com` or the page root for it.
 *
 * @internal
 */
export const LEFT_OUT_DECODER_META_KEY = "leftOutDecoder";

/** What each group decodes, for the error message. */
const DECODER_NAMES: Readonly<Record<DecoderGroup, string>> = {
  draco: "Draco",
  meshopt: "meshopt",
  ktx2: "KTX2",
};

/**
 * The glTF extensions that make Lite fetch a decoder, and the group that holds it.
 * `KHR_texture_basisu` images are KTX2 files.
 */
const GLTF_DECODER_EXTENSIONS: readonly (readonly [string, DecoderGroup])[] = [
  ["KHR_draco_mesh_compression", "draco"],
  ["EXT_meshopt_compression", "meshopt"],
  ["KHR_texture_basisu", "ktx2"],
];

/**
 * The decoder groups a manifest marks as left out of the build.
 *
 * @param manifest - The asset manifest.
 * @returns The groups; empty for a manifest the plugin wrote with every decoder, or without the plugin.
 *
 * @internal
 */
export function leftOutDecoders(manifest: AssetManifest): ReadonlySet<DecoderGroup> {
  const groups = new Set<DecoderGroup>();
  for (const entry of manifest.entries) {
    const group = entry.meta?.[LEFT_OUT_DECODER_META_KEY];
    if (group === "draco" || group === "meshopt" || group === "ktx2") {
      groups.add(group);
    }
  }
  return groups;
}

/**
 * Throws `IGX-0508` when the asset needs a decoder the build left out, before anything is fetched
 * for it.
 *
 * @param app - The app whose manifest to read.
 * @param address - The asset being loaded, for the message.
 * @param group - The decoder the asset needs.
 * @throws An {@link IgnifxError} with code `IGX-0508` when the manifest marks `group` as left out.
 *
 * @internal
 */
export function assertDecoderIncluded(app: App, address: string, group: DecoderGroup): void {
  if (!leftOutDecoders(app.assets.manifest).has(group)) {
    return;
  }
  throw decoderLeftOut(address, group);
}

/**
 * Throws `IGX-0508` when a glTF file uses an extension whose decoder the build left out. The check
 * reads the file's `extensionsUsed` only when the manifest marks some decoder as left out.
 *
 * @param app - The app whose manifest to read.
 * @param address - The model being loaded, for the message.
 * @param bytes - The `.glb` or `.gltf` file.
 * @throws An {@link IgnifxError} with code `IGX-0508` for the first such extension.
 *
 * @internal
 */
export function assertModelDecodersIncluded(app: App, address: string, bytes: ArrayBuffer): void {
  const leftOut = leftOutDecoders(app.assets.manifest);
  if (leftOut.size === 0) {
    return;
  }
  const used = gltfExtensionsUsed(bytes);
  for (const [extension, group] of GLTF_DECODER_EXTENSIONS) {
    if (leftOut.has(group) && used.includes(extension)) {
      throw decoderLeftOut(address, group);
    }
  }
}

/**
 * Builds the `IGX-0508` error.
 *
 * @param address - The asset being loaded.
 * @param group - The decoder it needs.
 * @returns The error to throw.
 */
function decoderLeftOut(address: string, group: DecoderGroup): IgnifxError {
  const decoder = DECODER_NAMES[group];
  return new IgnifxError(
    CoreErrorCode.decoderLeftOut,
    `${address} needs the ${decoder} decoder, which the build left out: set \`decoders.${group}: true\` in \`ignifx()\`.`,
    {
      context: { asset: address, decoder },
      hint: `Remove \`${group}: false\` from the \`decoders\` option of ignifx() in vite.config.ts, or set it to true.`,
    },
  );
}

/** `glTF` in ASCII, little-endian: the first four bytes of a `.glb`. */
const GLB_MAGIC = 0x46_54_6c_67;

/** `JSON` in ASCII, little-endian: the type of a `.glb`'s first chunk. */
const GLB_JSON_CHUNK = 0x4e_4f_53_4a;

/**
 * The extension names a glTF file declares in `extensionsUsed` and `extensionsRequired`.
 *
 * @param bytes - A `.glb` container or a `.gltf` JSON document.
 * @returns The names; empty when the file cannot be read, which Lite then reports itself.
 *
 * @internal
 */
export function gltfExtensionsUsed(bytes: ArrayBuffer): readonly string[] {
  let text: string;
  const view = new DataView(bytes);
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    const length = view.getUint32(12, true);
    if (view.getUint32(16, true) !== GLB_JSON_CHUNK || 20 + length > bytes.byteLength) {
      return [];
    }
    text = new TextDecoder().decode(new Uint8Array(bytes, 20, length));
  } else {
    text = new TextDecoder().decode(bytes);
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof document !== "object" || document === null) {
    return [];
  }
  const names: string[] = [];
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    const list: unknown = Object.getOwnPropertyDescriptor(document, key)?.value;
    if (Array.isArray(list)) {
      for (const name of list) {
        if (typeof name === "string") {
          names.push(name);
        }
      }
    }
  }
  return names;
}
