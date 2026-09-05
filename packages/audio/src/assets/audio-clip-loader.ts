import { AUDIO_ASSET_TYPE, AUDIO_FILE_EXTENSIONS, AudioClip } from "./audio-clip.js";
import { parseWavHeader } from "./wav-header.js";
import type { AssetLoader, JsonObject, LoaderContext } from "@ignifx/core";

/**
 * The `audio` asset loader: `.mp3`, `.ogg`, `.wav`, `.webm`, and `.flac` to {@link AudioClip}
 * (`docs/architecture/05-assets-and-loading.md` §5, `10-audio.md` §2).
 *
 * ## Static or streaming
 *
 * Static is the default: the bytes are fetched through the service's queue — so the load has
 * progress, cancellation, and retries — and handed to the audio backend to decode once, into one
 * buffer shared by every source that plays the clip.
 *
 * A sidecar `.meta.json` switches a clip to streaming:
 *
 * ```json
 * { "audio": { "streaming": true } }
 * ```
 *
 * A streaming clip is **not** fetched here. Babylon Lite's `createStreamingSoundAsync`
 * (`index.d.ts` 3221) takes a URL and builds a media element around it, so fetching the bytes would
 * download the file twice. The clip records the URL and the media element does the rest, which is
 * the point of streaming a five-minute music track.
 *
 * ## Decoding is the backend's job, not the loader's
 *
 * The loader never imports `@babylonjs/lite`. It parses whatever the container will cheaply tell it
 * (`parseWavHeader`) and then asks the app's backend to decode the bytes, if the app has a backend
 * that decodes anything. The headless backend does not, so it publishes no decoder and the loader
 * drops the bytes as soon as the header has been read — which is what keeps a Node run from holding
 * every sound file it ever loaded in memory.
 *
 * The predicate is "is there a decoder", not "is the app headless". They are not the same thing: a
 * browser test drives a headless app against a real `OfflineAudioContext`, and that app decodes.
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
  // Boundary assertion (coding standards §5.2): the three cases that are not string-keyed bags are
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
