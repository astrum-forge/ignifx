/**
 * The run-time decoder files `@ignifx/core` lists in `ignifx.assets.public`, grouped by the
 * `decoders` option that turns each group off (`docs/architecture/05-assets-and-loading.md` §7).
 */

import type { ExtensionPublicAsset } from "./extension-assets.js";
import type { ResolvedDecoderOptions } from "./options.js";

/** The package that ships the decoders. */
const DECODER_PACKAGE = "@ignifx/core";

/** Each decoder group's file names, as core's `decoders/` holds them. */
const DECODER_FILES: Readonly<Record<keyof ResolvedDecoderOptions, ReadonlySet<string>>> = {
  draco: new Set(["draco_decoder.js", "draco_decoder_gltf.wasm"]),
  meshopt: new Set(["meshopt_decoder.js"]),
  ktx2: new Set([
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
  ]),
};

/**
 * Whether an extension public asset is one of core's decoder files that the `decoders` option
 * turned off.
 *
 * @param file - The discovered file.
 * @param decoders - The resolved `decoders` option.
 * @returns `true` when the file must be neither served nor copied.
 */
export function isLeftOutDecoder(file: ExtensionPublicAsset, decoders: ResolvedDecoderOptions): boolean {
  if (file.packageName !== DECODER_PACKAGE) {
    return false;
  }
  return (
    (!decoders.draco && DECODER_FILES.draco.has(file.fileName)) ||
    (!decoders.meshopt && DECODER_FILES.meshopt.has(file.fileName)) ||
    (!decoders.ktx2 && DECODER_FILES.ktx2.has(file.fileName))
  );
}
