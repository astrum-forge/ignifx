import {
  asset,
  bool,
  createDefaults,
  defineSchema,
  degToRad,
  enumOf,
  f32,
  i32,
  record,
  Script,
  Signal,
  str,
} from "@ignifx/core";
import { AudioClip } from "../assets/audio-clip.js";
import { AUDIO_DISTANCE_MODELS } from "../backend/types.js";
import { playRequest } from "../service/audio-service.js";
import { DEFAULT_SOUND_BUS } from "../settings.js";
import type { AudioDistanceModel, BackendSpatialRequest } from "../backend/types.js";
import type { PlayOptions, SoundInstance, SoundVoice } from "../service/voice.js";
import type { AssetHandle, Disconnect, Schema, ScriptCallbacks, SignalLike } from "@ignifx/core";

/**
 * `AudioSource` (`docs/architecture/10-audio.md` §3): the component that makes a sound come from an
 * entity.
 *
 * ## What it owns
 *
 * One *voice*: the clip, the bus, and the options, as the backend knows them. Every `play()` starts
 * another instance of that one voice, up to `maxInstances`, above which the **oldest** is stolen —
 * which is what Babylon Lite does (`lib/audio/static-sound.js`, `_stopExcessInstances`) and what a
 * footstep loop wants: the newest step is the one that matters.
 *
 * ## What is applied when
 *
 * `volume` and `pan` are pushed to the running sound as soon as they change. Everything that
 * defines the *shape* of the sound — `clip`, `bus`, `loop`, `maxInstances`, `spatial` and its
 * parameters — cannot be changed on a live Web Audio graph, so changing one rebuilds the voice at
 * the start of the next `update`: anything playing stops, and the next `play()` uses the new
 * settings. `pitch` is a per-play value (Lite's `playbackRate` is fixed once an instance has
 * started), so it takes effect on the next `play()` rather than on the instance that is running.
 *
 * ## Angles
 *
 * `cone.innerAngle` and `cone.outerAngle` are **degrees** here, as everything user-facing in ignifx
 * is (coding standards §5.1), and are converted to the radians Lite's `SpatialSoundOptions` wants
 * (`index.d.ts` 11771; Lite converts them back to degrees for the Web Audio panner in
 * `lib/audio/spatial.js`).
 */

/**
 * Options accepted by {@link AudioSource.playOneShot}.
 *
 * @public
 */
export interface OneShotVolume {
  /** Linear gain for this one play. */
  readonly volume?: number;
}

/**
 * The directional cone of a spatial source, in **degrees** (`docs/architecture/10-audio.md` §3).
 * `360` on both angles is an omnidirectional source, which is the default.
 *
 * @public
 */
export interface AudioConeSettings {
  /** The angle inside which the source is heard at full volume. */
  innerAngle: number;
  /** The angle outside which the source is heard at `outerVolume`. */
  outerAngle: number;
  /** The gain outside the outer cone, in `[0, 1]`. */
  outerVolume: number;
}

/**
 * The serialized field declarations of {@link AudioSource} (`docs/architecture/10-audio.md` §3).
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function audioSourceSchema(): Schema {
  return defineSchema({
    clip: asset(AudioClip, { tooltip: "The sound to play." }),
    bus: str(DEFAULT_SOUND_BUS, { tooltip: "Which mixer bus this source routes into." }),
    volume: f32(1, { min: 0, max: 1, tooltip: "The sound's own linear gain." }),
    pitch: f32(1, { min: 0.1, max: 4, tooltip: "Playback rate; takes effect on the next play()." }),
    loop: bool(false, { tooltip: "Whether instances repeat instead of ending." }),
    playOnAwake: bool(false, { tooltip: "Play once as soon as the entity comes alive." }),
    maxInstances: i32(8, { min: 1, tooltip: "How many may sound at once; the oldest is stolen." }),
    spatial: bool(false, { tooltip: "Position the sound in 3D instead of in the stereo field." }),
    minDistance: f32(1, { min: 0, tooltip: "Distance below which no attenuation is applied." }),
    maxDistance: f32(50, { min: 0, tooltip: "Maximum distance, used by the linear model." }),
    rolloff: f32(1, { min: 0, tooltip: "How steeply the sound falls off with distance." }),
    distanceModel: enumOf(AUDIO_DISTANCE_MODELS, "inverse", { tooltip: "Which attenuation curve to use." }),
    cone: record(
      {
        innerAngle: f32(360, { min: 0, max: 360, tooltip: "Full-volume cone angle, in degrees." }),
        outerAngle: f32(360, { min: 0, max: 360, tooltip: "Outer cone angle, in degrees." }),
        outerVolume: f32(0, { min: 0, max: 1, tooltip: "Gain outside the outer cone." }),
      },
      { tooltip: "Directionality of a spatial source; 360/360 is omnidirectional." },
    ),
    pan: f32(0, { min: -1, max: 1, tooltip: "Stereo pan of a non-spatial source." }),
  });
}

/**
 * A sound attached to an entity.
 *
 * @example
 * ```ts
 * class Footsteps extends Script {
 *   #source: AudioSource | null = null;
 *   awake(): void {
 *     this.#source = this.requireComponent(AudioSource);
 *   }
 *   step(): void {
 *     this.#source?.play({ pitch: 0.9 + Math.random() * 0.2 });
 *   }
 * }
 * ```
 *
 * @public
 */
export class AudioSource extends Script implements ScriptCallbacks {
  /** The registration id the serializer and the inspector know this class by. */
  static typeId = "ignifx/AudioSource";

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = audioSourceSchema();

  /** The sound to play. */
  declare clip: AssetHandle<AudioClip> | null;

  /** Which mixer bus this source routes into. */
  declare bus: string;

  /** The sound's own linear gain, in `[0, 1]`. */
  declare volume: number;

  /** Playback rate; Lite's own `pitch` is in cents and is not exposed. */
  declare pitch: number;

  /** Whether instances repeat instead of ending. */
  declare loop: boolean;

  /** Whether to play once as soon as the entity comes alive. */
  declare playOnAwake: boolean;

  /** How many instances may sound at once; the oldest is stolen above it. */
  declare maxInstances: number;

  /** Whether the sound is positioned in 3D instead of in the stereo field. */
  declare spatial: boolean;

  /** Distance below which no attenuation is applied, in metres. */
  declare minDistance: number;

  /** Maximum distance, in metres; used by the `"linear"` model. */
  declare maxDistance: number;

  /** How steeply the sound falls off with distance. */
  declare rolloff: number;

  /** Which attenuation curve distance follows. */
  declare distanceModel: AudioDistanceModel;

  /** The source's directionality, in degrees. */
  declare cone: AudioConeSettings;

  /** Stereo pan of a non-spatial source, in `[-1, 1]`. */
  declare pan: number;

  /** Applies the schema defaults, exactly as `Script.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(AudioSource.schema));
  }

  readonly #onEnded = new Signal();

  #voice: SoundVoice | null = null;

  #detachEnded: Disconnect | null = null;

  #appliedClip: AudioClip | null = null;

  #appliedBus = "";

  #appliedLoop = false;

  #appliedMaxInstances = 0;

  #appliedSpatial = false;

  #appliedVolume = Number.NaN;

  #appliedPan = Number.NaN;

  #appliedShape = Number.NaN;

  /**
   * `true` while at least one instance is sounding, or waiting behind the unlock.
   *
   * @returns Whether the source is making a sound.
   */
  get isPlaying(): boolean {
    return this.#voice?.isPlaying ?? false;
  }

  /**
   * How many instances of this source are live.
   *
   * @returns The instance count, `0` when nothing is playing.
   */
  get instanceCount(): number {
    return this.#voice?.instanceCount ?? 0;
  }

  /**
   * The sound this source is playing, once it has played at least once.
   *
   * @returns The instance, or `null`.
   */
  get instance(): SoundInstance | null {
    return this.#voice;
  }

  /**
   * Emitted in `PreRender` on the frame the last instance stops sounding, whether it ran out or was
   * stopped (`docs/architecture/10-audio.md` §3).
   *
   * @returns The signal.
   */
  get onEnded(): SignalLike {
    return this.#onEnded;
  }

  /** Starts the source when `playOnAwake` is set, after the scene's props have been decoded. */
  awake(): void {
    if (this.playOnAwake) {
      this.play();
    }
  }

  /** Stops everything this source is playing; a disabled source makes no sound. */
  onDisable(): void {
    this.#voice?.stop();
  }

  /** Releases the voice and its backend sound. */
  onDestroy(): void {
    this.#releaseVoice();
    this.#onEnded.clear();
  }

  /**
   * Pushes the field changes a running sound can accept and rebuilds the voice when one it cannot
   * accept changed.
   */
  update(): void {
    if (this.#hasShapeChanged()) {
      this.#releaseVoice();
      return;
    }
    const voice = this.#voice;
    if (voice === null) {
      return;
    }
    if (this.volume !== this.#appliedVolume) {
      this.#appliedVolume = this.volume;
      voice.setVolume(this.volume);
    }
    if (this.pan !== this.#appliedPan && !this.spatial) {
      this.#appliedPan = this.pan;
      voice.setPan(this.pan);
    }
  }

  /**
   * Starts one more instance of this source's clip.
   *
   * @param options - Per-play overrides for volume, pitch, loop, delay, start offset, and duration.
   * @returns The sound, so a caller can fade or stop it; `null` when the source has no clip.
   * @throws IgnifxError with code `IGX-1001` when `bus` names a bus the tree does not hold.
   *
   * @example
   * ```ts
   * this.source.play({ volume: 0.6, delay: 0.25 });
   * ```
   */
  play(options?: PlayOptions): SoundInstance | null {
    const voice = this.#ensureVoice();
    if (voice === null) {
      return null;
    }
    voice.play(playRequest(options, this.pitch, this.loop));
    return voice;
  }

  /**
   * Plays another clip once through this source's bus, without disturbing what this source is
   * playing (`docs/architecture/10-audio.md` §3).
   *
   * @param clip - The clip to play.
   * @param options - The gain for this one play.
   * @returns The sound.
   *
   * @example
   * ```ts
   * this.source.playOneShot(this.impact.value, { volume: 0.5 });
   * ```
   */
  playOneShot(clip: AudioClip, options?: OneShotVolume): SoundInstance {
    return this.app.audio.playOneShot(clip, {
      bus: this.bus,
      ...(options?.volume === undefined ? {} : { volume: options.volume }),
    });
  }

  /**
   * Stops every instance, optionally fading out first.
   *
   * @param fadeSeconds - Seconds of frame time to fade over; omitted or `0` stops now.
   */
  stop(fadeSeconds?: number): void {
    this.#voice?.stop(fadeSeconds);
  }

  /** Pauses every instance, keeping its position. */
  pause(): void {
    this.#voice?.pause();
  }

  /** Resumes every paused instance. */
  resume(): void {
    this.#voice?.resume();
  }

  /**
   * Builds the voice on first use, and rebuilds it after a shape change.
   *
   * @returns The voice, or `null` when the source has no clip to play.
   */
  #ensureVoice(): SoundVoice | null {
    if (this.#voice !== null) {
      return this.#voice;
    }
    const clip = clipOf(this.clip);
    if (clip === null) {
      return null;
    }
    const voice = this.app.audio.createVoice({
      clip,
      bus: this.bus,
      volume: this.volume,
      playbackRate: this.pitch,
      loop: this.loop,
      maxInstances: this.maxInstances,
      pan: this.pan,
      spatial: this.spatial ? this.#spatialRequest() : null,
    });
    this.#voice = voice;
    this.#detachEnded = voice.onEnded.connect(
      (): void => {
        this.#onEnded.emit();
      },
      { owner: this },
    );
    this.#appliedClip = clip;
    this.#appliedBus = this.bus;
    this.#appliedLoop = this.loop;
    this.#appliedMaxInstances = this.maxInstances;
    this.#appliedSpatial = this.spatial;
    this.#appliedVolume = this.volume;
    this.#appliedPan = this.pan;
    this.#appliedShape = this.#shapeHash();
    return voice;
  }

  /**
   * The 3D placement, in the units Babylon Lite wants.
   *
   * @returns The request, with the cone angles converted from degrees to radians.
   */
  #spatialRequest(): BackendSpatialRequest {
    return {
      minDistance: this.minDistance,
      maxDistance: this.maxDistance,
      rolloffFactor: this.rolloff,
      distanceModel: this.distanceModel,
      coneInnerAngleRadians: degToRad(this.cone.innerAngle),
      coneOuterAngleRadians: degToRad(this.cone.outerAngle),
      coneOuterVolume: this.cone.outerVolume,
      attachedTo: this.transform.lite,
    };
  }

  /**
   * A cheap summary of the spatial numbers, so a change to one of them can be spotted without
   * allocating a comparison object every frame (coding standards §7).
   *
   * @returns A number that changes whenever a spatial parameter does.
   */
  #shapeHash(): number {
    return (
      this.minDistance +
      this.maxDistance * 7 +
      this.rolloff * 31 +
      this.cone.innerAngle * 131 +
      this.cone.outerAngle * 521 +
      this.cone.outerVolume * 2069 +
      AUDIO_DISTANCE_MODELS.indexOf(this.distanceModel) * 8191
    );
  }

  /**
   * Whether a field the running sound cannot accept has changed.
   *
   * @returns `true` when the voice has to be rebuilt.
   */
  #hasShapeChanged(): boolean {
    if (this.#voice === null) {
      return false;
    }
    return (
      clipOf(this.clip) !== this.#appliedClip ||
      this.bus !== this.#appliedBus ||
      this.loop !== this.#appliedLoop ||
      this.maxInstances !== this.#appliedMaxInstances ||
      this.spatial !== this.#appliedSpatial ||
      (this.spatial && this.#shapeHash() !== this.#appliedShape)
    );
  }

  /** Stops and releases the voice, so the next `play()` builds a fresh one. */
  #releaseVoice(): void {
    this.#detachEnded?.();
    this.#detachEnded = null;
    const voice = this.#voice;
    this.#voice = null;
    if (voice !== null) {
      this.app.audio.releaseVoice(voice);
    }
  }
}

/**
 * The loaded clip behind an `asset()` field, or `null`.
 *
 * @param handle - The field's value.
 * @returns The clip, or `null` when the field is empty or the handle has not been delivered yet —
 * reading `handle.value` too early throws `IGX-0501`, and a missing sound is not worth a throw
 * (`CONSTITUTION.md` §3.9).
 */
function clipOf(handle: AssetHandle<AudioClip> | null): AudioClip | null {
  return handle !== null && handle.state === "loaded" ? handle.value : null;
}
