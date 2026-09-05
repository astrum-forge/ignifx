import {
  attachSpatialTarget,
  createAudioBusAsync,
  createAudioEngineAsync,
  createSoundAsync,
  createSoundBufferAsync,
  createStreamingSoundAsync,
  detachSpatialTarget,
  disposeAudioBus,
  disposeAudioEngine,
  disposeSound,
  disposeStreamingSound,
  enableSpatial,
  enableStereo,
  getMasterVolume,
  pauseSound,
  pauseStreamingSound,
  playSound,
  playStreamingSound,
  resumeSound,
  resumeStreamingSound,
  setBusVolume,
  setMasterVolume,
  setSoundVolume,
  setSpatialAutoUpdate,
  setSpatialListener,
  setStereoPan,
  setStreamingSoundVolume,
  SoundState,
  stopSound,
  stopStreamingSound,
  unlockAudioEngineAsync,
  updateSpatialAudio,
} from "@babylonjs/lite";
import { Signal } from "@ignifx/core";
import { AudioErrorCode, audioError } from "../../errors.js";
import type { AudioClip } from "../../assets/audio-clip.js";
import type {
  AudioBackend,
  AudioBackendContext,
  AudioBackendKind,
  AudioBackendState,
  AudioLiteHandles,
  BackendBus,
  BackendBusRequest,
  BackendPlayRequest,
  BackendSound,
  BackendSoundRequest,
} from "../../backend/types.js";
import type {
  LiteAudioBus,
  LiteAudioEngine,
  LiteSpatialTarget,
  LiteStaticSound,
  LiteStreamingSound,
} from "../types.js";
import type { SignalLike } from "@ignifx/core";

/**
 * The {@link AudioBackend} that wraps Babylon Lite's Web Audio engine. This is the only module in
 * `@ignifx/audio` that imports `@babylonjs/lite` (`CONSTITUTION.md` §3.4, coding standards §4), and
 * the only one that cannot run under Node: `createAudioEngineAsync` calls `new AudioContext()` when
 * it is given no context (`lib/audio/audio-engine.js`), which does not exist there.
 *
 * ## Everything is functions
 *
 * Lite's audio API is pure state plus standalone functions — a `StaticSound` has no `play` method,
 * `playSound(sound, options)` does the work. That is why this file is a thin translation layer and
 * not a class hierarchy: each backend method is one or two Lite calls with the ignifx units
 * converted.
 *
 * ## Two things ignifx turns off
 *
 * - **Spatial auto-update.** `setSpatialAutoUpdate(engine, false)` (`index.d.ts` 11001) keeps Lite
 *   from starting its own `requestAnimationFrame` loop; ignifx pumps `updateSpatialAudio`
 *   (`index.d.ts` 13351) from `PreRender` instead, so source and listener poses are read at a
 *   defined point in the frame (`CONSTITUTION.md` §3.2).
 * - **Parameter ramps.** Lite's `RampOptions` are never passed. Fades are interpolated by the audio
 *   service on the frame clock so that a browser and a headless test agree; Lite's own
 *   `parameterRampDuration` (10 ms) still de-clicks each per-frame write.
 *
 * ## Verified against `@babylonjs/lite@1.27.0`
 *
 * `createAudioEngineAsync` 2098, `AudioEngine` 926, `AudioEngineOptions` 950,
 * `unlockAudioEngineAsync` 13187, `disposeAudioEngine` 3917, `createAudioBusAsync` 2091,
 * `setBusVolume` 10390, `disposeAudioBus` 3910, `createSoundBufferAsync` 3125, `SoundBuffer` 11707,
 * `createSoundAsync` 3116, `StaticSoundOptions` 12349, `playSound` 8955,
 * `StaticSoundPlayOptions` 12375, `stopSound` 12472, `pauseSound` 8066, `resumeSound` 9944,
 * `setSoundVolume` 10992, `disposeSound` 4040, `SoundState` 11744,
 * `createStreamingSoundAsync` 3221, `StreamingSoundOptions` 12512,
 * `StreamingSoundPlayOptions` 12530, `playStreamingSound` 8998, `pauseStreamingSound` 8069,
 * `resumeStreamingSound` 9947, `stopStreamingSound` 12487, `setStreamingSoundVolume` 11186,
 * `disposeStreamingSound` 4084, `enableSpatial` 4577, `SpatialSoundOptions` 11771,
 * `attachSpatialTarget` 849, `detachSpatialTarget` 3857, `setSpatialListener` 11008,
 * `setSpatialAutoUpdate` 11001, `updateSpatialAudio` 13351, `enableStereo` 4624,
 * `StereoSoundOptions` 12441, `setStereoPan` 11183, `setMasterVolume` 10551,
 * `getMasterVolume` 5819.
 */

/**
 * A bus of the Web Audio backend.
 *
 * @internal
 */
class WebBus implements BackendBus {
  /** The bus name. */
  readonly name: string;

  /** Lite's bus. */
  readonly lite: LiteAudioBus;

  /**
   * Wraps a Lite bus.
   *
   * @param name - The bus name.
   * @param lite - Lite's bus.
   */
  constructor(name: string, lite: LiteAudioBus) {
    this.name = name;
    this.lite = lite;
  }
}

/**
 * A sound of the Web Audio backend: exactly one of Lite's two sound kinds.
 *
 * @internal
 */
class WebSound implements BackendSound {
  /** Lite's buffer-backed sound, or `null` when this is a streaming sound. */
  readonly staticSound: LiteStaticSound | null;

  /** Lite's media-element-backed sound, or `null` when this is a static sound. */
  readonly streamingSound: LiteStreamingSound | null;

  /**
   * Wraps one of Lite's two sound kinds.
   *
   * @param staticSound - Lite's static sound, or `null`.
   * @param streamingSound - Lite's streaming sound, or `null`.
   */
  constructor(staticSound: LiteStaticSound | null, streamingSound: LiteStreamingSound | null) {
    this.staticSound = staticSound;
    this.streamingSound = streamingSound;
  }

  /**
   * How many instances Lite is carrying.
   *
   * @returns The instance count.
   */
  get instanceCount(): number {
    return this.staticSound?.instanceCount ?? this.streamingSound?.instanceCount ?? 0;
  }

  /**
   * Whether anything is sounding.
   *
   * @returns `true` while Lite reports `Starting` or `Started`.
   */
  get isPlaying(): boolean {
    const state = this.staticSound?.state ?? this.streamingSound?.state ?? SoundState.Stopped;
    return state === SoundState.Starting || state === SoundState.Started;
  }

  /**
   * Whether the sound is paused.
   *
   * @returns `true` while Lite reports `Paused`.
   */
  get isPaused(): boolean {
    const state = this.staticSound?.state ?? this.streamingSound?.state ?? SoundState.Stopped;
    return state === SoundState.Paused;
  }
}

/**
 * The audio backend that runs in a browser.
 *
 * @public
 */
export class WebAudioBackend implements AudioBackend {
  /** Which implementation this is. */
  readonly kind: AudioBackendKind = "web";

  readonly #engine: LiteAudioEngine;

  readonly #onStateChanged = new Signal<AudioBackendState>();

  readonly #sounds: WebSound[] = [];

  #detachState: (() => void) | null = null;

  #isDisposed = false;

  /**
   * Wraps an audio engine Lite has already created.
   *
   * @param engine - The engine from `createAudioEngineAsync`.
   */
  constructor(engine: LiteAudioEngine) {
    this.#engine = engine;
    // ignifx owns the frame (`CONSTITUTION.md` §3.2), so Lite's own rAF pump stays off.
    setSpatialAutoUpdate(engine, false);
    this.#detachState = engine.onStateChanged.add((state: AudioBackendState): void => {
      this.#onStateChanged.emit(state);
    });
  }

  /**
   * The audio context's state.
   *
   * @returns Lite's `AudioEngineState`, which is always `"running"` for an `OfflineAudioContext`.
   */
  get state(): AudioBackendState {
    return this.#engine.state;
  }

  /**
   * Emitted whenever the state changes.
   *
   * @returns The signal.
   */
  get onStateChanged(): SignalLike<AudioBackendState> {
    return this.#onStateChanged;
  }

  /**
   * The Lite objects this backend owns. Unstable escape hatch.
   *
   * @returns The engine.
   */
  get lite(): AudioLiteHandles {
    return { engine: this.#engine };
  }

  /**
   * Reads the master gain.
   *
   * @returns The gain.
   */
  getMasterVolume(): number {
    return getMasterVolume(this.#engine);
  }

  /**
   * Sets the master gain.
   *
   * @param volume - The gain to apply now.
   */
  setMasterVolume(volume: number): void {
    setMasterVolume(this.#engine, volume);
  }

  /**
   * Resumes the audio context. Browsers only honour this from inside a user-gesture handler; Lite
   * also resumes on the first `click` anywhere in the document on its own.
   *
   * @returns A promise that settles once the context is running.
   */
  async unlock(): Promise<void> {
    await unlockAudioEngineAsync(this.#engine);
  }

  /**
   * Creates a Lite bus routed into its parent.
   *
   * @param request - The name, gain, and parent bus.
   * @returns The bus.
   */
  async createBus(request: BackendBusRequest): Promise<BackendBus> {
    const parent = request.parent === null ? undefined : (request.parent.lite ?? undefined);
    const bus = await createAudioBusAsync(this.#engine, request.name, {
      volume: request.volume,
      ...(parent === undefined ? {} : { outBus: parent }),
    });
    return new WebBus(request.name, bus);
  }

  /**
   * Sets a bus's gain.
   *
   * @param bus - The bus.
   * @param volume - The gain to apply now.
   */
  setBusVolume(bus: BackendBus, volume: number): void {
    if (bus.lite !== null) {
      setBusVolume(bus.lite, volume);
    }
  }

  /**
   * Releases a bus and its sub-graph.
   *
   * @param bus - The bus.
   */
  disposeBus(bus: BackendBus): void {
    if (bus.lite !== null) {
      disposeAudioBus(bus.lite);
    }
  }

  /**
   * Decodes a static clip's bytes into a buffer every sound built from it shares.
   *
   * @param clip - The clip to decode.
   * @throws IgnifxError with code `IGX-1008` when the bytes are not audio this browser can decode.
   */
  async decode(clip: AudioClip): Promise<void> {
    if (clip.isStreaming || clip.isDecoded) {
      return;
    }
    const bytes = clip.bytes();
    if (bytes === null) {
      return;
    }
    try {
      const buffer = await createSoundBufferAsync(this.#engine, bytes);
      clip.attachBuffer(buffer, buffer.duration, buffer.channelCount, buffer.sampleRate);
    } catch (error) {
      throw audioError(AudioErrorCode.clipDecodeFailed, `${clip.address} could not be decoded into playable audio.`, {
        context: { asset: clip.address },
        hint: "Check that the file is one this browser can decode; .wav and .mp3 are the safest.",
        cause: error,
      });
    }
  }

  /**
   * Creates a Lite sound: buffer-backed for a static clip, media-element-backed for a streaming one.
   *
   * @param request - The clip, routing, and per-sound options.
   * @returns The sound.
   * @throws IgnifxError with code `IGX-1008` when a static clip cannot be decoded, or `IGX-1009`
   * when a streaming clip is asked for on a context that cannot stream.
   */
  async createSound(request: BackendSoundRequest): Promise<BackendSound> {
    const outBus = request.bus?.lite ?? undefined;
    const sound = request.clip.isStreaming
      ? new WebSound(null, await this.#createStreaming(request, outBus))
      : new WebSound(await this.#createStatic(request, outBus), null);
    this.#configure(sound, request);
    this.#sounds.push(sound);
    return sound;
  }

  /**
   * Starts one instance, or resumes a paused sound — which is what Lite's `playSound` does
   * (`index.d.ts` 8955).
   *
   * @param sound - The sound.
   * @param request - The per-play overrides.
   */
  play(sound: BackendSound, request: BackendPlayRequest): void {
    if (!(sound instanceof WebSound)) {
      return;
    }
    if (sound.staticSound !== null) {
      playSound(sound.staticSound, {
        volume: request.volume,
        playbackRate: request.playbackRate,
        loop: request.loop,
        startOffset: request.startOffset,
        duration: request.duration,
        waitTime: request.delay,
      });
      return;
    }
    if (sound.streamingSound !== null) {
      // Lite's streaming play options carry no rate, duration, or delay (`index.d.ts` 12530): a
      // media element has none of them. Music does not need them.
      playStreamingSound(sound.streamingSound, {
        volume: request.volume,
        loop: request.loop,
        startOffset: request.startOffset,
      });
    }
  }

  /**
   * Stops every instance.
   *
   * @param sound - The sound.
   */
  stop(sound: BackendSound): void {
    if (!(sound instanceof WebSound)) {
      return;
    }
    if (sound.staticSound !== null) {
      stopSound(sound.staticSound);
      return;
    }
    if (sound.streamingSound !== null) {
      stopStreamingSound(sound.streamingSound);
    }
  }

  /**
   * Pauses every instance.
   *
   * @param sound - The sound.
   */
  pause(sound: BackendSound): void {
    if (!(sound instanceof WebSound)) {
      return;
    }
    if (sound.staticSound !== null) {
      pauseSound(sound.staticSound);
      return;
    }
    if (sound.streamingSound !== null) {
      pauseStreamingSound(sound.streamingSound);
    }
  }

  /**
   * Resumes every paused instance.
   *
   * @param sound - The sound.
   */
  resume(sound: BackendSound): void {
    if (!(sound instanceof WebSound)) {
      return;
    }
    if (sound.staticSound !== null) {
      resumeSound(sound.staticSound);
      return;
    }
    if (sound.streamingSound !== null) {
      resumeStreamingSound(sound.streamingSound);
    }
  }

  /**
   * Sets a sound's gain.
   *
   * @param sound - The sound.
   * @param volume - The gain to apply now.
   */
  setSoundVolume(sound: BackendSound, volume: number): void {
    if (!(sound instanceof WebSound)) {
      return;
    }
    if (sound.staticSound !== null) {
      setSoundVolume(sound.staticSound, volume);
      return;
    }
    if (sound.streamingSound !== null) {
      setStreamingSoundVolume(sound.streamingSound, volume);
    }
  }

  /**
   * Sets a sound's stereo pan, building the panner sub-node on first use.
   *
   * @param sound - The sound.
   * @param pan - The pan in `[-1, 1]`.
   */
  setSoundPan(sound: BackendSound, pan: number): void {
    const host = hostOf(sound);
    if (host !== null) {
      setStereoPan(host, pan);
    }
  }

  /**
   * Releases a sound and its sub-graph.
   *
   * @param sound - The sound.
   */
  disposeSound(sound: BackendSound): void {
    if (!(sound instanceof WebSound)) {
      return;
    }
    const index = this.#sounds.indexOf(sound);
    if (index >= 0) {
      this.#sounds.splice(index, 1);
    }
    if (sound.staticSound !== null) {
      disposeSound(sound.staticSound);
      return;
    }
    if (sound.streamingSound !== null) {
      disposeStreamingSound(sound.streamingSound);
    }
  }

  /**
   * Attaches Lite's spatial listener to a world transform, or leaves it at the world origin.
   *
   * @param target - The transform to follow, or `null`.
   */
  setListener(target: LiteSpatialTarget | null): void {
    if (target === null) {
      detachSpatialTarget(this.#engine);
      return;
    }
    setSpatialListener(this.#engine, { attachedTo: target });
  }

  /**
   * Re-reads the world matrix of every attached source and of the listener.
   *
   * @param deltaSeconds - The frame delta; Lite's pump reads poses rather than integrating, so it
   * is not used and is accepted only to satisfy the contract.
   */
  update(deltaSeconds: number): void {
    void deltaSeconds;
    if (!this.#isDisposed) {
      updateSpatialAudio(this.#engine);
    }
  }

  /** Stops every sound, tears down the graph, and closes the audio context. */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#detachState?.();
    this.#detachState = null;
    this.#sounds.length = 0;
    disposeAudioEngine(this.#engine);
    this.#onStateChanged.clear();
  }

  /**
   * Builds the buffer-backed sound behind a static clip.
   *
   * @param request - The clip, routing, and per-sound options.
   * @param outBus - Lite's bus to route into, or `undefined` for the main bus.
   * @returns Lite's sound.
   * @throws IgnifxError with code `IGX-1008` when the clip holds nothing playable.
   */
  async #createStatic(request: BackendSoundRequest, outBus: LiteAudioBus | undefined): Promise<LiteStaticSound> {
    await this.decode(request.clip);
    const buffer = request.clip.lite.buffer;
    if (buffer === null) {
      throw audioError(AudioErrorCode.clipDecodeFailed, `${request.clip.address} holds no decoded audio to play.`, {
        context: { asset: request.clip.address },
        hint: "Load the clip through app.assets so its bytes reach the audio backend.",
      });
    }
    return createSoundAsync(this.#engine, buffer, {
      volume: request.volume,
      loop: request.loop,
      playbackRate: request.playbackRate,
      maxInstances: request.maxInstances,
      ...(outBus === undefined ? {} : { outBus }),
    });
  }

  /**
   * Builds the media-element-backed sound behind a streaming clip.
   *
   * @param request - The clip, routing, and per-sound options.
   * @param outBus - Lite's bus to route into, or `undefined` for the main bus.
   * @returns Lite's sound.
   * @throws IgnifxError with code `IGX-1009` when the context cannot stream — an
   * `OfflineAudioContext` has no media element to attach to.
   */
  async #createStreaming(request: BackendSoundRequest, outBus: LiteAudioBus | undefined): Promise<LiteStreamingSound> {
    try {
      return await createStreamingSoundAsync(this.#engine, request.clip.url, {
        volume: request.volume,
        loop: request.loop,
        maxInstances: request.maxInstances,
        ...(outBus === undefined ? {} : { outBus }),
      });
    } catch (error) {
      throw audioError(
        AudioErrorCode.streamingUnavailable,
        `${request.clip.address} is a streaming clip and this audio context cannot stream.`,
        {
          context: { asset: request.clip.address },
          hint: 'Streaming needs a real-time AudioContext; drop { "audio": { "streaming": true } } from the sidecar to decode instead.',
          cause: error,
        },
      );
    }
  }

  /**
   * Applies the spatial or stereo placement a request carries.
   *
   * @param sound - The freshly created sound.
   * @param request - What it was created from.
   */
  #configure(sound: WebSound, request: BackendSoundRequest): void {
    const host = hostOf(sound);
    if (host === null) {
      return;
    }
    const spatial = request.spatial;
    if (spatial !== null) {
      enableSpatial(host, {
        minDistance: spatial.minDistance,
        maxDistance: spatial.maxDistance,
        rolloffFactor: spatial.rolloffFactor,
        distanceModel: spatial.distanceModel,
        coneInnerAngle: spatial.coneInnerAngleRadians,
        coneOuterAngle: spatial.coneOuterAngleRadians,
        coneOuterVolume: spatial.coneOuterVolume,
      });
      if (spatial.attachedTo !== null) {
        attachSpatialTarget(host, spatial.attachedTo);
      }
      return;
    }
    if (request.pan !== 0) {
      enableStereo(host, { pan: request.pan });
    }
  }
}

/**
 * The Lite object a spatial, stereo, or analyser sub-node hangs off.
 *
 * @param sound - The backend sound.
 * @returns Lite's sound, or `null` when the value did not come from this backend.
 */
function hostOf(sound: BackendSound): LiteStaticSound | LiteStreamingSound | null {
  if (!(sound instanceof WebSound)) {
    return null;
  }
  return sound.staticSound ?? sound.streamingSound;
}

/**
 * Creates the Web Audio backend.
 *
 * @remarks
 * `createAudioEngineAsync` calls `new AudioContext()` when it is handed none, which throws outside a
 * browser — so this factory is reached only when `app.isHeadless` is false, or when a test supplies
 * its own context. Pass an `OfflineAudioContext` to render deterministically and faster than real
 * time; Lite reports such an engine as permanently `"running"` (`lib/audio/audio-engine.js`), so
 * there is no unlock to wait for.
 *
 * @param context - Whether the app is headless, an audio context to build on, and the initial gain.
 * @returns The backend.
 * @throws IgnifxError with code `IGX-1007` when this host has no Web Audio at all.
 *
 * @example
 * ```ts
 * const offline = new OfflineAudioContext({ numberOfChannels: 2, length: 44100, sampleRate: 44100 });
 * const backend = await createWebAudioBackend({ isHeadless: false, audioContext: offline, masterVolume: 1 });
 * ```
 *
 * @public
 */
export async function createWebAudioBackend(context: AudioBackendContext): Promise<AudioBackend> {
  if (context.audioContext === null && typeof globalThis.AudioContext !== "function") {
    throw audioError(AudioErrorCode.audioEngineUnavailable, "This host has no Web Audio.", {
      context: { backend: "web" },
      hint: "Run with the headless backend, or supply an audioContext through audio({ audioContext }).",
    });
  }
  const engine = await createAudioEngineAsync({
    volume: context.masterVolume,
    resumeOnInteraction: true,
    resumeOnPause: true,
    ...(context.audioContext === null ? {} : { audioContext: context.audioContext }),
  });
  return new WebAudioBackend(engine);
}
