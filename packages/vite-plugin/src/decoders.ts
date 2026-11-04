/**
 * The run-time decoder files `@ignifx/core` lists in `ignifx.assets.public`, grouped by the
 * `decoders` option that turns each group off (`docs/architecture/05-assets-and-loading.md` §7).
 */

import type { ExtensionPublicAsset } from "./extension-assets.js";
import type { ResolvedDecoderOptions } from "./options.js";

/** The package that ships the decoders. */
const DECODER_PACKAGE = "@ignifx/core";

/** Each decoder group's file names, as core's `decoders/` holds them. */
const DECODER_FILES: Readonly<Record<keyof ResolvedDecoderOptions, readonly string[]>> = {
  draco: ["draco_decoder.js", "draco_decoder_gltf.wasm"],
  meshopt: ["meshopt_decoder.js"],
  ktx2: [
    "babylon.ktx2Decoder.js",
    "msc_basis_transcoder.js",
    "msc_basis_transcoder.wasm",
    "uastc_astc.wasm",
    "uastc_bc7.wasm",
    "uastc_r8_unorm.wasm",
    "uastc_rg8_unorm.wasm",
    "uastc_rgba8_srgb_v2.wasm",
    "uastc_rgba8_unorm_v2.wasm",
    "zstddec.wasm",
  ],
};

/**
 * The manifest `meta` key that marks an entry as a decoder the `decoders` option left out. Its value
 * is the option's key (`"draco"`, `"meshopt"` or `"ktx2"`). `@ignifx/core`'s loaders read it
 * (`render/decoder-urls.ts`) and fail with `IGX-0508` before a load that needs the decoder, rather
 * than let Lite fetch it from `cdn.babylonjs.com` or the page root.
 */
export const LEFT_OUT_DECODER_META_KEY = "leftOutDecoder";

/**
 * Which `decoders` group left an extension public asset out, if any.
 *
 * @param file - The discovered file.
 * @param decoders - The resolved `decoders` option.
 * @returns The option key that turned the file off, or `null` when it is served and copied.
 */
export function leftOutDecoderGroup(
  file: ExtensionPublicAsset,
  decoders: ResolvedDecoderOptions,
): keyof ResolvedDecoderOptions | null {
  if (file.packageName !== DECODER_PACKAGE) {
    return null;
  }
  for (const group of ["draco", "meshopt", "ktx2"] as const) {
    if (!decoders[group] && DECODER_FILES[group].includes(file.fileName)) {
      return group;
    }
  }
  return null;
}
