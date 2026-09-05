import type { LiteSoundBuffer } from "../lite/types.js";

/**
 * `AudioClip` (`docs/architecture/10-audio.md` §2, `05-assets-and-loading.md` §5): one addressed
 * sound file, static or streaming.
 *
 * A clip is **not** a playing sound. It is the shared, immutable thing many `AudioSource`s point
 * at: a decoded buffer (static) or a URL a media element streams from (streaming). Sources create
 * their own playable sound from it, which is what makes one footstep clip serve a hundred entities
 * without a hundred decodes.
 *
 * ## Where `duration` comes from
 *
 * - Browser, static: exact, read off Lite's `SoundBuffer` (`index.d.ts` 11707) once the backend has
 *   decoded the bytes.
 * - Headless, `.wav`: exact, from the RIFF header (`parseWavHeader`).
 * - Headless, `.mp3`/`.ogg`/`.webm`/`.flac`: `null`. Parsing those containers needs a dependency
 *   this package does not take (coding standards §13). A `null`-duration clip still plays under the
 *   headless backend; its instances simply never end on their own, so a test that wants an
 *   `onEnded` uses a WAV fixture.
 * - Streaming, either backend: `null` until the media element reports it, which ignifx does not
 *   wait for.
 */

/**
 * The asset type audio clips are registered under.
 *
 * @public
 */
export const AUDIO_ASSET_TYPE = "audio";

/**
 * The address suffixes that select the audio loader
 * (`docs/architecture/10-audio.md` §2).
 *
 * @public
 */
export const AUDIO_FILE_EXTENSIONS: readonly string[] = Object.freeze([".mp3", ".ogg", ".wav", ".webm", ".flac"]);

/**
 * The Babylon Lite objects an {@link AudioClip} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface AudioClipLiteHandles {
  /**
   * The decoded buffer shared by every sound built from this clip, or `null` — headless always,
   * streaming always, and in a browser until the first sound is created from the clip.
   */
  readonly buffer: LiteSoundBuffer | null;
}

/**
 * What the loader hands {@link AudioClip}'s constructor.
 *
 * @public
 */
export interface AudioClipInit {
  /** The address the clip was loaded from, fragment included. */
  readonly address: string;
  /** The URL the address resolved to; a streaming clip plays straight from it. */
  readonly url: string;
  /** Whether the clip streams from a media element rather than decoding into memory. */
  readonly isStreaming: boolean;
  /** The playing length in seconds, or `null` when this build cannot tell yet. */
  readonly duration: number | null;
  /** How many channels the data holds, or `null` when unknown. */
  readonly channels: number | null;
  /** Samples per second, or `null` when unknown. */
  readonly sampleRate: number | null;
  /**
   * The undecoded bytes, kept only until a backend decodes them; `null` for a streaming clip and
   * for a headless load, neither of which will ever decode.
   */
  readonly bytes: ArrayBuffer | null;
}

/**
 * One loaded sound file (`docs/architecture/10-audio.md` §2).
 *
 * @example
 * ```ts
 * const step = await app.assets.loadAsync<AudioClip>("audio/footstep.wav");
 * step.value.duration; // 0.42
 * app.audio.playOneShot(step.value);
 * ```
 *
 * @public
 */
export class AudioClip {
  /** The type name the asset service registers audio clips under. */
  static assetType: string = AUDIO_ASSET_TYPE;

  /** The address the clip was loaded from. */
  readonly address: string;

  /** The URL the address resolved to. */
  readonly url: string;

  /** Whether the clip is played by a media element rather than from a decoded buffer. */
  readonly isStreaming: boolean;

  #duration: number | null;

  #channels: number | null;

  #sampleRate: number | null;

  #bytes: ArrayBuffer | null;

  #byteLength: number;

  #buffer: LiteSoundBuffer | null = null;

  /**
   * Wraps a loaded file. The `audio` loader constructs these.
   *
   * @param init - The address, the URL, and whatever the container told the loader.
   *
   * @internal
   */
  constructor(init: AudioClipInit) {
    this.address = init.address;
    this.url = init.url;
    this.isStreaming = init.isStreaming;
    this.#duration = init.duration;
    this.#channels = init.channels;
    this.#sampleRate = init.sampleRate;
    this.#bytes = init.bytes;
    this.#byteLength = init.bytes?.byteLength ?? 0;
  }

  /**
   * How long the clip plays, in seconds.
   *
   * @returns The duration, or `null` when this build has not been able to determine it.
   */
  get duration(): number | null {
    return this.#duration;
  }

  /**
   * How many interleaved channels the clip holds.
   *
   * @returns The channel count, or `null` when unknown.
   */
  get channels(): number | null {
    return this.#channels;
  }

  /**
   * The clip's sample rate.
   *
   * @returns Samples per second, or `null` when unknown.
   */
  get sampleRate(): number | null {
    return this.#sampleRate;
  }

  /**
   * How many bytes the file held, for diagnostics. Stays at its loaded value after the bytes have
   * been decoded and released.
   *
   * @returns The file size in bytes, or `0` for a streaming clip, which is never fetched.
   */
  get byteLength(): number {
    return this.#byteLength;
  }

  /**
   * `true` once a backend has decoded this clip into a playable buffer.
   *
   * @returns Whether {@link AudioClip.lite} carries a buffer.
   */
  get isDecoded(): boolean {
    return this.#buffer !== null;
  }

  /**
   * The Babylon Lite objects the clip owns. Unstable escape hatch.
   *
   * @returns The decoded buffer, or `null`.
   */
  get lite(): AudioClipLiteHandles {
    return { buffer: this.#buffer };
  }

  /**
   * The undecoded bytes, for the backend that is about to decode them.
   *
   * @returns The bytes, or `null` when there are none left to decode.
   *
   * @internal
   */
  bytes(): ArrayBuffer | null {
    return this.#bytes;
  }

  /**
   * Records the buffer a backend decoded and releases the bytes it came from.
   *
   * @param buffer - The decoded buffer.
   * @param duration - Its exact duration in seconds.
   * @param channels - Its channel count.
   * @param sampleRate - Its sample rate.
   *
   * @internal
   */
  attachBuffer(buffer: LiteSoundBuffer, duration: number, channels: number, sampleRate: number): void {
    this.#buffer = buffer;
    this.#duration = duration;
    this.#channels = channels;
    this.#sampleRate = sampleRate;
    this.#bytes = null;
  }

  /**
   * Drops the decoded buffer and the undecoded bytes. The `audio` loader's `unload` calls it when
   * the last holder releases the handle.
   *
   * @internal
   */
  release(): void {
    this.#buffer = null;
    this.#bytes = null;
  }
}
