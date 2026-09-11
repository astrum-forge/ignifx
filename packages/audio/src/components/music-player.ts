import { array, asset, bool, createDefaults, defineSchema, f32, Script, str } from "@ignifx/core";
import { AudioClip } from "../assets/audio-clip.js";
import { playRequest } from "../service/audio-service.js";
import type { SoundInstance, SoundVoice } from "../service/voice.js";
import type { AssetHandle, Disconnect, Schema, ScriptCallbacks } from "@ignifx/core";

/**
 * Music follows its entity's lifetime; put the player in a persistent scene to survive level loads.
 * Crossfades hold two voices and use the audio service's game-time fades.
 * `autoAdvance` follows natural track endings, not explicit stops. Streaming is a clip sidecar setting.
 */

/**
 * Options accepted by {@link MusicPlayer.play}.
 *
 * @public
 */
export interface MusicPlayOptions {
  /** Seconds to fade the new track up over. Defaults to no fade. */
  readonly fadeIn?: number;
}

/**
 * Options accepted by {@link MusicPlayer.stop}.
 *
 * @public
 */
export interface MusicStopOptions {
  /** Seconds to fade the current track out over. Defaults to stopping now. */
  readonly fadeOut?: number;
}

/**
 * The serialized field declarations of {@link MusicPlayer} (`docs/architecture/10-audio.md` §5).
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function musicPlayerSchema(): Schema {
  return defineSchema({
    playlist: array(asset(AudioClip), [], { tooltip: "The tracks, in the order they are played." }),
    bus: str("Music", { tooltip: "Which mixer bus the music routes into." }),
    volume: f32(1, { min: 0, max: 1, tooltip: "The gain a track fades up to." }),
    playOnAwake: bool(false, { tooltip: "Start the first playlist entry as soon as the entity is alive." }),
    autoAdvance: bool(true, { tooltip: "Crossfade to the next track when one ends." }),
    loopPlaylist: bool(true, { tooltip: "Wrap to the first track after the last one." }),
    loopTrack: bool(false, { tooltip: "Repeat the current track instead of ending it." }),
    crossfadeSeconds: f32(1.5, { min: 0, tooltip: "How long a crossfade takes, in seconds." }),
  });
}

/**
 * A music track player with a playlist and crossfading.
 *
 * @example
 * ```ts
 * const jukebox = world.createEntity("Music");
 * const music = jukebox.addComponent(MusicPlayer, { autoAdvance: true, crossfadeSeconds: 3 });
 * music.play(menuTheme.value, { fadeIn: 1.5 });
 * // …later…
 * music.crossfadeTo(battleTheme.value, 2);
 * ```
 *
 * @public
 */
export class MusicPlayer extends Script implements ScriptCallbacks {
  /** The registration id the serializer and the inspector know this class by. */
  static typeId = "ignifx/MusicPlayer";

  /** One music player per entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = musicPlayerSchema();

  /** The tracks, in the order they are played. */
  declare playlist: (AssetHandle<AudioClip> | null)[];

  /** Which mixer bus the music routes into. */
  declare bus: string;

  /** The gain a track fades up to, in `[0, 1]`. */
  declare volume: number;

  /** Whether to start the first playlist entry as soon as the entity is alive. */
  declare playOnAwake: boolean;

  /** Whether a track that ends crossfades into the next one. */
  declare autoAdvance: boolean;

  /** Whether the playlist wraps after its last entry. */
  declare loopPlaylist: boolean;

  /** Whether the current track repeats instead of ending. */
  declare loopTrack: boolean;

  /** How long a crossfade takes, in seconds. */
  declare crossfadeSeconds: number;

  /** Applies the schema defaults, exactly as `Script.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(MusicPlayer.schema));
  }

  #current: SoundVoice | null = null;

  #previous: SoundVoice | null = null;

  #detachEnded: Disconnect | null = null;

  #index = -1;

  /**
   * The track that is playing.
   *
   * @returns The sound, or `null` when nothing is playing.
   */
  get current(): SoundInstance | null {
    return this.#current;
  }

  /**
   * The track that is fading out, while a crossfade is in progress.
   *
   * @returns The outgoing sound, or `null`.
   */
  get previous(): SoundInstance | null {
    return this.#previous;
  }

  /**
   * Which entry of `playlist` is playing.
   *
   * @returns The index, or `-1` when the current track did not come from the playlist.
   */
  get index(): number {
    return this.#index;
  }

  /**
   * Whether music is sounding.
   *
   * @returns `true` while a track is playing or waiting behind the unlock.
   */
  get isPlaying(): boolean {
    return this.#current?.isPlaying ?? false;
  }

  /** Starts the first playlist entry when `playOnAwake` is set. */
  awake(): void {
    if (this.playOnAwake) {
      this.#playIndex(0, this.crossfadeSeconds);
    }
  }

  /** Stops the music and releases both voices. */
  onDestroy(): void {
    this.#release(this.#previous);
    this.#previous = null;
    this.#detachEnded?.();
    this.#detachEnded = null;
    this.#release(this.#current);
    this.#current = null;
  }

  /**
   * Plays a track, replacing whatever was playing.
   *
   * @param clip - The track.
   * @param options - How long to fade the new track up over.
   * @returns The sound.
   *
   * @example
   * ```ts
   * music.play(theme.value, { fadeIn: 2 });
   * ```
   */
  play(clip: AudioClip, options?: MusicPlayOptions): SoundInstance {
    const fade = options?.fadeIn ?? 0;
    this.#index = -1;
    return this.#start(clip, fade, fade);
  }

  /**
   * Fades the current track out while fading a new one in.
   *
   * @param clip - The track to fade in.
   * @param seconds - How long both fades take; defaults to `crossfadeSeconds`.
   * @returns The incoming sound.
   *
   * @example
   * ```ts
   * music.crossfadeTo(battleTheme.value, 3);
   * ```
   */
  crossfadeTo(clip: AudioClip, seconds?: number): SoundInstance {
    const fade = seconds ?? this.crossfadeSeconds;
    this.#index = -1;
    return this.#start(clip, fade, fade);
  }

  /**
   * Stops the music.
   *
   * @param options - How long to fade out over; omitted stops now.
   */
  stop(options?: MusicStopOptions): void {
    const fade = options?.fadeOut ?? 0;
    this.#detachEnded?.();
    this.#detachEnded = null;
    this.#current?.stop(fade);
    this.#previous?.stop(fade);
  }

  /**
   * Crossfades to the next playlist entry, wrapping when `loopPlaylist` is set.
   *
   * @returns The incoming sound, or `null` when the playlist has nothing left to play.
   */
  next(): SoundInstance | null {
    const total = this.playlist.length;
    if (total === 0) {
      return null;
    }
    const wanted = this.#index + 1;
    if (wanted >= total && !this.loopPlaylist) {
      return null;
    }
    return this.#playIndex(wanted % total, this.crossfadeSeconds);
  }

  /**
   * Starts one playlist entry.
   *
   * @param index - Which entry.
   * @param fade - How long the crossfade takes.
   * @returns The incoming sound, or `null` when the entry holds no loaded clip.
   */
  #playIndex(index: number, fade: number): SoundInstance | null {
    const handle: AssetHandle<AudioClip> | null = this.playlist[index] ?? null;
    if (handle === null || handle.state !== "loaded") {
      return null;
    }
    const instance = this.#start(handle.value, fade, fade);
    this.#index = index;
    return instance;
  }

  /**
   * Retires the current track and starts a new one in its place.
   *
   * @param clip - The track to start.
   * @param fadeIn - How long the new track fades up over.
   * @param fadeOut - How long the old track fades down over.
   * @returns The incoming sound.
   */
  #start(clip: AudioClip, fadeIn: number, fadeOut: number): SoundVoice {
    this.#detachEnded?.();
    this.#detachEnded = null;
    this.#release(this.#previous);
    this.#previous = this.#current;
    this.#previous?.stop(fadeOut);
    const voice = this.app.audio.createVoice({
      clip,
      bus: this.bus,
      volume: fadeIn > 0 ? 0 : this.volume,
      playbackRate: 1,
      loop: this.loopTrack,
      maxInstances: 1,
      pan: 0,
      spatial: null,
    });
    this.#current = voice;
    voice.play(playRequest(undefined, 1, this.loopTrack));
    if (fadeIn > 0) {
      voice.setVolume(this.volume, fadeIn);
    }
    this.#detachEnded = voice.onEnded.connect(
      (): void => {
        if (this.autoAdvance && this.#current === voice) {
          this.next();
        }
      },
      { owner: this },
    );
    return voice;
  }

  /**
   * Releases a voice the player is finished with.
   *
   * @param voice - The voice, or `null`.
   */
  #release(voice: SoundVoice | null): void {
    if (voice !== null) {
      this.app.audio.releaseVoice(voice);
    }
  }
}
