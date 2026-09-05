import {
  AUDIO_BUSES_ASSET_TYPE,
  AUDIO_BUSES_FILE_EXTENSION,
  AudioBusesAsset,
  parseAudioBusesFile,
} from "./bus-file.js";
import type { AssetLoader, LoaderContext } from "@ignifx/core";

/**
 * The `audiobuses` asset loader: `.audio.json` to {@link AudioBusesAsset}
 * (`docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * The file is data, not a GPU or Web Audio resource, so the loader is identical in a browser and
 * under Node and has nothing to release on unload. `.audio.json` is a longer suffix than `.json`,
 * and the asset service picks the longest match (`matchExtension`), so registering it does not
 * shadow the generic JSON loader.
 */

/**
 * Builds the loader for `.audio.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createAudioBusesLoader());
 * ```
 *
 * @public
 */
export function createAudioBusesLoader(): AssetLoader<AudioBusesAsset> {
  return {
    type: AUDIO_BUSES_ASSET_TYPE,
    extensions: [AUDIO_BUSES_FILE_EXTENSION],
    async load(ctx: LoaderContext): Promise<AudioBusesAsset> {
      const parsed: unknown = await ctx.fetchJson();
      return new AudioBusesAsset(ctx.address, parseAudioBusesFile(parsed, ctx.address));
    },
  };
}
