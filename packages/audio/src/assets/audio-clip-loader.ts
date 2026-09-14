import { AUDIO_ASSET_TYPE, AUDIO_FILE_EXTENSIONS, AudioClip } from "./audio-clip.js";
import { parseWavHeader } from "./wav-header.js";
import type { AssetLoader, JsonObject, LoaderContext } from "@ignifx/core";

/**
 * Static clips fetch bytes through the asset queue and use the backend's decoder when available.
 * Streaming clips keep a URL for the media element to fetch, avoiding a duplicate download.
 * Without a decoder, retain header metadata and discard bytes; decoder availability is independent
 * of whether the app is headless.
 */

/**
 * Narrows an unknown JSON value to an object.
 *
 * @param value - The value to test.
 * @returns The value as a record, or `null`.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // The three cases that are not string-keyed bags are
  // gone, so what is left is a JSON object read by name.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Record<string, unknown>;
}

/**
 * Reads the `audio` sub-object of an address's `.meta.json` sidecar.
 *
 * @param meta - The sidecar the manifest recorded, or `null`.
 * @returns Whether the clip streams.
 */
function readStreaming(meta: JsonObject | null): boolean {
  return asRecord(meta?.["audio"])?.["streaming"] === true;
}

/**
 * How a clip's bytes are turned into a decoded buffer, when the app has a backend that can.
 *
 * @remarks
 * The loader is registered in `register`, long before `onStart` creates the backend, so it holds a
 * lookup rather than a backend: the function answers `null` until there is one.
 *
 * @public
 */
export type AudioDecoder = (clip: AudioClip) => Promise<void>;

/**
 * Options accepted by {@link createAudioClipLoader}.
 *
 * @public
 */
export interface AudioClipLoaderOptions {
  /**
   * Returns the decoder to run on a freshly loaded static clip, or `null` to leave the clip
   * undecoded until a source plays it.
   */
  readonly decoder: () => AudioDecoder | null;
}

/**
 * Builds the loader for audio addresses.
 *
 * @param options - How to reach the app's decoder.
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createAudioClipLoader({ decoder: () => service.decoder() }));
 * ```
 *
 * @public
 */
export function createAudioClipLoader(options: AudioClipLoaderOptions): AssetLoader<AudioClip> {
  return {
    type: AUDIO_ASSET_TYPE,
    extensions: AUDIO_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<AudioClip> {
      if (readStreaming(ctx.meta)) {
        return new AudioClip({
          address: ctx.address,
          url: ctx.url,
          isStreaming: true,
          duration: null,
          channels: null,
          sampleRate: null,
          bytes: null,
        });
      }
      const bytes = await ctx.fetchBytes();
      const header = parseWavHeader(bytes);
      const decode = options.decoder();
      const clip = new AudioClip({
        address: ctx.address,
        url: ctx.url,
        isStreaming: false,
        duration: header?.duration ?? null,
        channels: header?.channels ?? null,
        sampleRate: header?.sampleRate ?? null,
        // With no decoder the bytes will never be read again, so they go now rather than being held
        // for the life of the handle.
        bytes: decode === null ? null : bytes,
      });
      if (decode !== null) {
        await decode(clip);
      }
      return clip;
    },
    unload(value: AudioClip): void {
      value.release();
    },
  };
}
