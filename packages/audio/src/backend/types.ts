import type { AudioClip } from "../assets/audio-clip.js";
import type { LiteAudioBus, LiteAudioEngine, LiteSpatialTarget } from "../lite/types.js";
import type { SignalLike } from "@ignifx/core";

/**
 * The browser backend plays audio; the headless backend tracks playback on engine time.
 * Fades are computed in `PreRender` for both backends so their timing agrees.
 * Headless sound creation is synchronous, allowing playback to begin without a microtask turn.
 */

/**
 * Which implementation of {@link AudioBackend} is running.
 *
 * @public
 */
export type AudioBackendKind = "web" | "headless";

/**
 * The audio context's state, mirroring Babylon Lite's `AudioEngineState` (`index.d.ts` 970) and,
 * through it, Web Audio's `AudioContextState` plus `"interrupted"`.
 *
 * @public
 */
export type AudioBackendState = "running" | "suspended" | "interrupted" | "closed";

/**
 * How distance attenuates a spatial source, matching Web Audio's `distanceModel`
 * (`docs/architecture/10-audio.md` §3).
 *
 * @public
 */
export const AUDIO_DISTANCE_MODELS: readonly ["linear", "inverse", "exponential"] = Object.freeze([
  "linear",
  "inverse",
  "exponential",
] as const);

/**
 * The union of the distance models {@link AUDIO_DISTANCE_MODELS} declares.
 *
 * @public
 */
export type AudioDistanceModel = (typeof AUDIO_DISTANCE_MODELS)[number];

/**
 * The Babylon Lite objects an {@link AudioBackend} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3); `null` on the headless backend, which owns none.
 *
 * @public
 */
export interface AudioLiteHandles {
  /** Lite's audio engine (`index.d.ts` 926). */
  readonly engine: LiteAudioEngine;
}

/**
 * A mixer bus as the backend knows it: an opaque token the service hands back with every sound it
 * creates.
 *
 * @public
 */
export interface BackendBus {
  /** The bus name, as the tree declared it. */
  readonly name: string;
  /** Lite's bus, or `null` on the headless backend. Unstable escape hatch. */
  readonly lite: LiteAudioBus | null;
}

/**
 * A playable sound as the backend knows it: one clip routed to one bus, able to carry several
 * concurrent instances (Babylon Lite's `StaticSound`/`StreamingSound` model, `index.d.ts` 12336 and
 * 12499).
 *
 * @remarks
 * There is deliberately no `onEnded` here. Lite raises its own `onEnded` from a Web Audio `ended`
 * event, which lands at an arbitrary point between frames, and a stopped sound raises it too; the
 * service instead polls {@link BackendSound.isPlaying} once per frame in the `PreRender` pump and
 * raises `SoundInstance.onEnded` there. That is what makes "the sound finished" arrive at a defined
 * point in the frame, the same way every other engine event does, and identical on both backends.
 *
 * @public
 */
export interface BackendSound {
  /** How many instances of this sound are live. */
  readonly instanceCount: number;
  /** `true` while at least one instance is playing or about to. */
  readonly isPlaying: boolean;
  /** `true` when every instance has been paused. */
  readonly isPaused: boolean;
}

/**
 * What {@link AudioBackend.createBus} is asked for.
 *
 * @public
 */
export interface BackendBusRequest {
  /** The bus name. */
  readonly name: string;
  /** Its own linear gain, before the parent chain. */
  readonly volume: number;
  /** The bus it outputs into, or `null` to output into the engine's main bus. */
  readonly parent: BackendBus | null;
}

/**
 * The 3D placement of a spatial sound, already converted into the units Babylon Lite wants: angles
 * in **radians** (`SpatialSoundOptions`, `index.d.ts` 11771), distances in metres.
 *
 * @public
 */
export interface BackendSpatialRequest {
  /** Reference distance below which no attenuation is applied. */
  readonly minDistance: number;
  /** Maximum distance, used by the `"linear"` model. */
  readonly maxDistance: number;
  /** Attenuation roll-off factor. */
  readonly rolloffFactor: number;
  /** Which attenuation curve to use. */
  readonly distanceModel: AudioDistanceModel;
  /** Cone inner angle in radians; `2π` for an omnidirectional source. */
  readonly coneInnerAngleRadians: number;
  /** Cone outer angle in radians. */
  readonly coneOuterAngleRadians: number;
  /** Gain outside the outer cone, in `[0, 1]`. */
  readonly coneOuterVolume: number;
  /** The world transform the source follows, or `null` to stay at the origin. */
  readonly attachedTo: LiteSpatialTarget | null;
}

/**
 * What {@link AudioBackend.createSound} is asked for.
 *
 * @public
 */
export interface BackendSoundRequest {
  /** The clip to play. */
  readonly clip: AudioClip;
  /** The bus it routes into, or `null` for the engine's main bus. */
  readonly bus: BackendBus | null;
  /** The sound's own linear gain. */
  readonly volume: number;
  /** Playback rate multiplier; ignifx's `pitch` field maps onto it. */
  readonly playbackRate: number;
  /** Whether instances loop. */
  readonly loop: boolean;
  /** How many instances may play at once; the oldest is stolen above it. */
  readonly maxInstances: number;
  /** Stereo pan in `[-1, 1]` for a non-spatial sound. */
  readonly pan: number;
  /** The 3D placement, or `null` for a non-spatial sound. */
  readonly spatial: BackendSpatialRequest | null;
}

/**
 * The per-play overrides {@link AudioBackend.play} applies, matching Babylon Lite's
 * `StaticSoundPlayOptions` (`index.d.ts` 12375).
 *
 * @public
 */
export interface BackendPlayRequest {
  /** The instance's linear gain. */
  readonly volume: number;
  /** The instance's playback rate. */
  readonly playbackRate: number;
  /** Whether the instance loops. */
  readonly loop: boolean;
  /** Where in the clip the instance starts, in seconds. */
  readonly startOffset: number;
  /** How long the instance plays, in seconds; `0` means "to the end of the clip". */
  readonly duration: number;
  /** How long to wait before the instance starts, in seconds. */
  readonly delay: number;
}

/**
 * The audio implementation behind `app.audio`
 * (`docs/architecture/10-audio.md` §1, §7).
 *
 * @remarks
 * A game never touches this. It exists so the service and the components have exactly one thing to
 * talk to, and so `audio({ createBackend })` can substitute a recording double in a test.
 *
 * @example
 * ```ts
 * const app = await createApp({ headless: true, extensions: [audio({ createBackend: () => spy })] });
 * ```
 *
 * @public
 */
export interface AudioBackend {
  /** Which implementation this is. */
  readonly kind: AudioBackendKind;
  /** The audio context's current state. */
  readonly state: AudioBackendState;
  /** Emitted whenever {@link AudioBackend.state} changes. */
  readonly onStateChanged: SignalLike<AudioBackendState>;
  /** The Lite objects this backend owns, or `null` when it owns none. */
  readonly lite: AudioLiteHandles | null;

  /**
   * Reads the master output gain.
   *
   * @returns The gain, where `1` is unity.
   */
  getMasterVolume(): number;

  /**
   * Sets the master output gain.
   *
   * @param volume - The gain to apply now, where `1` is unity.
   */
  setMasterVolume(volume: number): void;

  /**
   * Resumes a suspended context — what a "tap to start" prompt calls.
   *
   * @returns A promise that settles once the context is running, or immediately when the backend
   * needs no gesture.
   */
  unlock(): Promise<void>;

  /**
   * Creates one mixer bus.
   *
   * @param request - The name, gain, and parent bus.
   * @returns The bus.
   */
  createBus(request: BackendBusRequest): Promise<BackendBus>;

  /**
   * Sets a bus's own gain.
   *
   * @param bus - The bus.
   * @param volume - The gain to apply now.
   */
  setBusVolume(bus: BackendBus, volume: number): void;

  /**
   * Releases a bus and its sub-graph.
   *
   * @param bus - The bus.
   */
  disposeBus(bus: BackendBus): void;

  /**
   * Decodes a static clip's bytes into a buffer every sound built from it can share, and records
   * the exact duration on the clip. Calling it twice is a no-op, and a backend that never decodes —
   * the headless one — does nothing at all.
   *
   * @param clip - The clip to decode.
   * @returns A promise that settles once the clip is playable.
   */
  decode(clip: AudioClip): Promise<void>;

  /**
   * Creates a playable sound.
   *
   * @param request - The clip, routing, and per-sound options.
   * @returns The sound, or a promise for it when the backend has to decode first.
   */
  createSound(request: BackendSoundRequest): BackendSound | Promise<BackendSound>;

  /**
   * Starts one new instance of a sound, stealing the oldest when `maxInstances` is reached. A
   * paused sound is resumed instead, which is Babylon Lite's documented behaviour
   * (`index.d.ts` 8955).
   *
   * @param sound - The sound.
   * @param request - The per-play overrides.
   */
  play(sound: BackendSound, request: BackendPlayRequest): void;

  /**
   * Stops every instance of a sound immediately. Fading is the service's job, so that both
   * backends fade identically.
   *
   * @param sound - The sound.
   */
  stop(sound: BackendSound): void;

  /**
   * Pauses every instance of a sound, keeping its position.
   *
   * @param sound - The sound.
   */
  pause(sound: BackendSound): void;

  /**
   * Resumes a paused sound.
   *
   * @param sound - The sound.
   */
  resume(sound: BackendSound): void;

  /**
   * Sets a sound's gain.
   *
   * @param sound - The sound.
   * @param volume - The gain to apply now.
   */
  setSoundVolume(sound: BackendSound, volume: number): void;

  /**
   * Sets a non-spatial sound's stereo pan.
   *
   * @param sound - The sound.
   * @param pan - The pan in `[-1, 1]`.
   */
  setSoundPan(sound: BackendSound, pan: number): void;

  /**
   * Releases a sound and its sub-graph.
   *
   * @param sound - The sound.
   */
  disposeSound(sound: BackendSound): void;

  /**
   * Points the spatial listener at a world transform.
   *
   * @param target - The transform to follow, or `null` to leave the listener at the world origin.
   */
  setListener(target: LiteSpatialTarget | null): void;

  /**
   * Advances the backend by one frame: the web backend pumps `updateSpatialAudio`, the headless
   * backend advances simulated playback and fires `onEnded`.
   *
   * @param deltaSeconds - The frame delta in seconds.
   */
  update(deltaSeconds: number): void;

  /** Releases everything the backend owns, including the audio context. */
  dispose(): void;
}

/**
 * What a backend factory is handed (`audio({ createBackend })`).
 *
 * @public
 */
export interface AudioBackendContext {
  /** `true` when the app runs with no render surface. */
  readonly isHeadless: boolean;
  /** An existing Web Audio context to build the engine on — an `OfflineAudioContext` in tests. */
  readonly audioContext: BaseAudioContext | null;
  /** The initial master gain. */
  readonly masterVolume: number;
}
