import { Signal } from "@ignifx/core";
import { Ramp } from "./ramp.js";
import type { AudioBus } from "./audio-bus.js";
import type { AudioClip } from "../assets/audio-clip.js";
import type { AudioBackend, BackendPlayRequest, BackendSound, BackendSpatialRequest } from "../backend/types.js";
import type { SignalLike } from "@ignifx/core";

/**
 * A *voice*: one clip, routed to one bus, with one set of options — the thing a backend can be
 * asked to play, and what `AudioSource.play()` hands back as a {@link SoundInstance}.
 *
 * ## Why one handle and not one per `play()`
 *
 * Babylon Lite's audio engine has no per-instance handle. `playSound(sound)` returns `void`
 * (`index.d.ts` 8955), instances live inside the sound, and `stopSound`, `pauseSound`, and
 * `setSoundVolume` all act on every instance at once. ignifx does not invent a handle Lite cannot
 * back: a `SoundInstance` names *the sound*, so repeated `play()` calls on the same source return
 * the same object and it reports `instanceCount` rather than pretending to be one of them. The
 * alternative — a Lite sound per `play()` — would put a gain sub-graph and an asynchronous
 * creation between a footstep and the ear.
 *
 * ## The three things a voice does that a backend cannot
 *
 * 1. **Queue while locked.** A browser will not play anything before a user gesture, and Lite
 *    silently drops a non-looping play made while the context is suspended
 *    (`lib/audio/static-sound.js`: only a looping instance subscribes to `onStateChanged`). A voice
 *    holds those plays and flushes them on unlock, which is what `audio({ queueWhileLocked })`
 *    switches off.
 * 2. **Queue while creating.** Web Audio decoding is asynchronous; a `play()` made in `awake` must
 *    not be lost because the buffer had not arrived yet.
 * 3. **Fade.** `stop(2)` interpolates the gain to zero over two seconds of frame time and stops the
 *    sound when it gets there — identically on both backends (see `backend/types.ts`).
 */

/**
 * The per-play overrides a game passes to `play()` (`docs/architecture/10-audio.md` §3).
 *
 * @public
 */
export interface PlayOptions {
  /** Linear gain for this play; defaults to the source's `volume`. */
  readonly volume?: number;
  /** Playback rate for this play; defaults to the source's `pitch`. */
  readonly pitch?: number;
  /** Whether this play loops; defaults to the source's `loop`. */
  readonly loop?: boolean;
  /** How long to wait before it starts, in seconds. */
  readonly delay?: number;
  /** Where in the clip to start, in seconds. */
  readonly startOffset?: number;
  /** How long to play for, in seconds; `0` plays to the end of the clip. */
  readonly duration?: number;
}

/**
 * A playing sound: what `AudioSource.play()` and `app.audio.playOneShot()` return
 * (`docs/architecture/10-audio.md` §1, §3).
 *
 * @remarks
 * It names the sound, not one of its concurrent instances — see the note on this module. Two
 * `play()` calls on the same `AudioSource` therefore return the same object with
 * `instanceCount === 2`, and `stop()` stops both.
 *
 * @example
 * ```ts
 * const engineLoop = this.source.play({ loop: true });
 * engineLoop.setVolume(0.2, 0.5);
 * engineLoop.onEnded.connect(() => this.spawnPuff(), { owner: this });
 * ```
 *
 * @public
 */
export interface SoundInstance {
  /** The clip being played. */
  readonly clip: AudioClip;
  /** The bus it routes into, or `null` when it goes straight to the engine's main bus. */
  readonly bus: AudioBus | null;
  /** `true` while at least one instance is sounding, or waiting for the unlock. */
  readonly isPlaying: boolean;
  /** `true` when every live instance is paused. */
  readonly isPaused: boolean;
  /** How many instances are live, including ones queued behind the unlock. */
  readonly instanceCount: number;
  /** The gain, where a fade in progress has reached. */
  readonly volume: number;
  /**
   * Fades the gain.
   *
   * @param volume - The target linear gain.
   * @param rampSeconds - How long the fade takes, in frame time; `0` applies immediately.
   */
  setVolume(volume: number, rampSeconds?: number): void;
  /**
   * Stops every instance, optionally fading out first.
   *
   * @param fadeSeconds - Seconds of frame time to fade over; `0` stops now.
   */
  stop(fadeSeconds?: number): void;
  /** Pauses every instance, keeping its position. */
  pause(): void;
  /** Resumes every paused instance. */
  resume(): void;
  /**
   * Emitted in `PreRender` on the frame the last instance stops sounding, whether it ran out or was
   * stopped. Never emitted for a sound that is merely paused.
   */
  readonly onEnded: SignalLike;
}

/**
 * What a voice needs from the service to decide whether to play now or later. `AudioService`
 * implements it; nothing else has any reason to.
 *
 * @public
 */
export interface VoiceHost {
  /** The backend every call is forwarded to. */
  readonly backend: AudioBackend;
  /** `true` before the first unlock, when a browser would refuse to make a sound. */
  readonly isLocked: boolean;
  /** Whether plays made while locked are held rather than dropped. */
  readonly queueWhileLocked: boolean;
  /**
   * Reports a failure that has no caller to throw at — a decode that rejected, say.
   *
   * @param error - What went wrong.
   */
  reportError(error: unknown): void;
}

/**
 * What the service is asked to build a voice from: an {@link AudioSource}'s fields, or the
 * arguments of one `playOneShot`.
 *
 * @public
 */
export interface VoiceRequest {
  /** The clip to play. */
  readonly clip: AudioClip;
  /** The name of the bus it routes into; empty routes to the default sound bus. */
  readonly bus: string;
  /** The sound's own linear gain. */
  readonly volume: number;
  /** Playback rate; ignifx's `pitch` maps onto it. */
  readonly playbackRate: number;
  /** Whether instances loop. */
  readonly loop: boolean;
  /** How many instances may play at once; the oldest is stolen above it. */
  readonly maxInstances: number;
  /** Stereo pan in `[-1, 1]`, for a non-spatial sound. */
  readonly pan: number;
  /** The 3D placement, or `null` for a non-spatial sound. */
  readonly spatial: BackendSpatialRequest | null;
}

/**
 * The concrete class behind {@link SoundInstance}, as `app.audio.createVoice` returns it.
 *
 * @remarks
 * Hold a {@link SoundInstance} rather than this: the interface is the contract, and this class adds
 * only what the components that own a voice need — releasing it, re-panning it, and flushing the
 * plays it held while the engine was locked.
 *
 * @public
 */
export class SoundVoice implements SoundInstance {
  /** The clip being played. */
  readonly clip: AudioClip;

  readonly #host: VoiceHost;

  readonly #queued: BackendPlayRequest[] = [];

  readonly #volume: Ramp;

  readonly #onEnded = new Signal();

  #sound: BackendSound | null = null;

  #bus: AudioBus | null = null;

  #stopIn: number | null = null;

  #wasAlive = false;

  #isDisposed = false;

  /**
   * Creates a voice. The service does this; game code reaches one through `play()`.
   *
   * @param host - The backend and the lock state.
   * @param clip - The clip to play.
   * @param volume - Its starting gain.
   */
  constructor(host: VoiceHost, clip: AudioClip, volume: number) {
    this.#host = host;
    this.clip = clip;
    this.#volume = new Ramp(volume);
  }

  /**
   * The bus this voice routes into.
   *
   * @returns The bus, or `null` while the tree is still being built or when the voice goes straight
   * to the engine's main bus.
   */
  get bus(): AudioBus | null {
    return this.#bus;
  }

  /**
   * Whether anything is sounding.
   *
   * @returns `true` while an instance is running or a play is waiting for the unlock.
   */
  get isPlaying(): boolean {
    return this.#queued.length > 0 || this.#sound?.isPlaying === true;
  }

  /**
   * Whether every live instance is paused.
   *
   * @returns `true` when the sound is paused.
   */
  get isPaused(): boolean {
    return this.#sound?.isPaused === true;
  }

  /**
   * How many instances are live.
   *
   * @returns The backend's instance count plus the plays still queued.
   */
  get instanceCount(): number {
    return (this.#sound?.instanceCount ?? 0) + this.#queued.length;
  }

  /**
   * The gain, where a fade in progress has reached.
   *
   * @returns The linear gain.
   */
  get volume(): number {
    return this.#volume.value;
  }

  /**
   * Emitted when the last instance stops sounding.
   *
   * @returns The signal.
   */
  get onEnded(): SignalLike {
    return this.#onEnded;
  }

  /**
   * `true` once the voice has been released and can no longer play.
   *
   * @returns Whether the voice is dead.
   */
  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /**
   * `true` while the voice holds a live instance or a queued play — which is the predicate
   * `onEnded` watches, and which stays `true` for a paused sound because a pause is not an end.
   *
   * @returns Whether anything is still owed.
   */
  get isAlive(): boolean {
    return this.#queued.length > 0 || (this.#sound?.instanceCount ?? 0) > 0;
  }

  /**
   * The backend's sound, once it exists.
   *
   * @returns The sound, or `null` while it is still being created.
   */
  get sound(): BackendSound | null {
    return this.#sound;
  }

  /**
   * Adopts the backend sound the service created and releases whatever was queued behind it.
   *
   * @param sound - The freshly created sound.
   * @param bus - The bus it was routed to.
   */
  attach(sound: BackendSound, bus: AudioBus | null): void {
    if (this.#isDisposed) {
      this.#host.backend.disposeSound(sound);
      return;
    }
    this.#sound = sound;
    this.#bus = bus;
    this.#host.backend.setSoundVolume(sound, this.#volume.value);
    this.flush();
  }

  /**
   * Starts one instance, or holds the request until the sound exists and the engine is unlocked.
   *
   * @param request - The per-play overrides.
   */
  play(request: BackendPlayRequest): void {
    if (this.#isDisposed) {
      return;
    }
    this.#stopIn = null;
    const sound = this.#sound;
    if (sound === null || this.#host.isLocked) {
      if (this.#host.isLocked && !this.#host.queueWhileLocked) {
        return;
      }
      this.#queued.push(request);
      this.#wasAlive = true;
      return;
    }
    this.#host.backend.play(sound, request);
    this.#wasAlive = true;
  }

  /** Starts every play that was waiting for the sound or for the unlock. */
  flush(): void {
    const sound = this.#sound;
    if (sound === null || this.#host.isLocked || this.#queued.length === 0) {
      return;
    }
    for (let index = 0; index < this.#queued.length; index += 1) {
      const request = this.#queued[index];
      if (request !== undefined) {
        this.#host.backend.play(sound, request);
      }
    }
    this.#queued.length = 0;
  }

  /**
   * Fades the gain.
   *
   * @param volume - The target linear gain.
   * @param rampSeconds - How long the fade takes, in frame time.
   */
  setVolume(volume: number, rampSeconds: number = 0): void {
    this.#volume.to(volume, rampSeconds);
    if (!this.#volume.isActive) {
      this.#applyVolume();
    }
  }

  /**
   * Sets the stereo pan of a non-spatial sound.
   *
   * @param pan - The pan in `[-1, 1]`.
   */
  setPan(pan: number): void {
    if (this.#sound !== null) {
      this.#host.backend.setSoundPan(this.#sound, pan);
    }
  }

  /**
   * Stops every instance, optionally fading first.
   *
   * @param fadeSeconds - Seconds of frame time to fade over; `0` stops now.
   */
  stop(fadeSeconds: number = 0): void {
    if (fadeSeconds > 0 && this.isAlive) {
      this.#volume.to(0, fadeSeconds);
      this.#stopIn = fadeSeconds;
      return;
    }
    this.#stopNow();
  }

  /** Pauses every instance. */
  pause(): void {
    if (this.#sound !== null) {
      this.#host.backend.pause(this.#sound);
    }
  }

  /** Resumes every paused instance. */
  resume(): void {
    if (this.#sound !== null) {
      this.#host.backend.resume(this.#sound);
    }
  }

  /**
   * Advances the fade and the pending stop. Runs before the backend's own update, so a stop that
   * comes due this frame is seen as an end in the same frame.
   *
   * @param deltaSeconds - The frame delta in seconds.
   */
  advance(deltaSeconds: number): void {
    if (this.#volume.advance(deltaSeconds)) {
      this.#applyVolume();
    }
    if (this.#stopIn === null) {
      return;
    }
    this.#stopIn -= deltaSeconds;
    if (this.#stopIn <= 0) {
      this.#stopNow();
    }
  }

  /**
   * Raises `onEnded` when the voice stopped being alive since the previous frame. Runs after the
   * backend's update, so a simulated instance that ran out this frame is already gone.
   */
  settle(): void {
    if (!this.#wasAlive || this.isAlive) {
      return;
    }
    this.#wasAlive = false;
    this.#onEnded.emit();
  }

  /** Releases the backend sound and every listener. */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#queued.length = 0;
    if (this.#sound !== null) {
      this.#host.backend.stop(this.#sound);
      this.#host.backend.disposeSound(this.#sound);
      this.#sound = null;
    }
    this.#onEnded.clear();
  }

  /** Stops the sound now and drops anything still queued. */
  #stopNow(): void {
    this.#stopIn = null;
    this.#queued.length = 0;
    if (this.#sound !== null) {
      this.#host.backend.stop(this.#sound);
    }
  }

  /** Writes the current gain to the backend. */
  #applyVolume(): void {
    if (this.#sound !== null) {
      this.#host.backend.setSoundVolume(this.#sound, this.#volume.value);
    }
  }
}
