import { Signal } from "@ignifx/core";
import { AudioErrorCode, audioError } from "../errors.js";
import { DEFAULT_SOUND_BUS } from "../settings.js";
import { AudioBusImpl } from "./audio-bus.js";
import { SoundVoice } from "./voice.js";
import type { AudioBus } from "./audio-bus.js";
import type { AudioClip } from "../assets/audio-clip.js";
import type { AudioBusDefinition } from "../assets/bus-file.js";
import type { AudioBackend, AudioBackendState, BackendPlayRequest, BackendSoundRequest } from "../backend/types.js";
import type { AudioListener } from "../components/audio-listener.js";
import type { LiteAudioEngine, LiteSpatialTarget } from "../lite/types.js";
import type { AudioSettings } from "../settings.js";
import type { PlayOptions, SoundInstance, VoiceHost, VoiceRequest } from "./voice.js";
import type { App, DiagnosticsGroup, Logger, SignalLike } from "@ignifx/core";

/**
 * `app.audio` (`docs/architecture/10-audio.md` §1): the mixer tree, the unlock state, the voices
 * every `AudioSource` plays through, and the once-per-frame pump that advances all of it.
 *
 * ## The one thing the service does that neither the backend nor a component could
 *
 * It is the only object that knows *when* things happen. Fades advance, simulated playback ends,
 * `onEnded` is raised, and `app.pause()` takes effect all in one place, in `PreRender`, from one
 * frame delta — so a two-second fade takes two seconds of game time whether the app is a browser at
 * 144 fps or a Node test calling `app.step(1 / 60)` sixty times.
 *
 * ## Locked
 *
 * `state` is `"locked"` from construction until the audio context is running: browsers refuse to
 * produce sound before a user gesture, and Babylon Lite quietly drops a non-looping play made while
 * the context is suspended. Every `play()` made while locked is held on its voice and flushed the
 * moment the context runs — through `unlock()` from a "tap to start" button, or through Lite's own
 * `resumeOnInteraction`, which resumes on the first `click` anywhere in the document
 * (`lib/audio/audio-engine.js`) and reaches this service as a state change.
 */

/** The state names, in the order the diagnostics counter reports them. */
const STATE_NAMES: readonly AudioServiceState[] = Object.freeze([
  "locked",
  "running",
  "suspended",
  "interrupted",
  "closed",
]);

/** How many instances one `playOneShot` voice may carry before the oldest is stolen. */
const ONE_SHOT_MAX_INSTANCES = 16;

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * The diagnostics group name (`docs/architecture/15-devtools-and-diagnostics.md` §3).
 *
 * @public
 */
export const AUDIO_DIAGNOSTICS_GROUP = "audio";

/**
 * The counters the `audio` diagnostics group publishes, in index order.
 *
 * @public
 */
export const AUDIO_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "state",
  "voices",
  "instances",
  "streaming",
  "buses",
  "unlockedAtMs",
]);

/**
 * What `app.audio.state` reports: Babylon Lite's `AudioEngineState` (`index.d.ts` 970) plus
 * `"locked"`, the state before the first unlock.
 *
 * @public
 */
export type AudioServiceState = "locked" | "running" | "suspended" | "interrupted" | "closed";

/**
 * Options accepted by {@link AudioService.createBus}.
 *
 * @public
 */
export interface CreateBusOptions {
  /** The name of the bus the new one routes into; empty routes it to the root. */
  readonly parent?: string;
  /** The new bus's own linear gain. Defaults to `1`. */
  readonly volume?: number;
  /** Whether `app.pause()` pauses it. Defaults to whatever the `audio` settings section says. */
  readonly pausable?: boolean;
}

/**
 * Options accepted by {@link AudioService.playOneShot}.
 *
 * @public
 */
export interface OneShotOptions extends PlayOptions {
  /** The bus to route through. Defaults to `"SFX"`. */
  readonly bus?: string;
}

/**
 * The Babylon Lite objects `app.audio` owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface AudioServiceLiteHandles {
  /** Lite's audio engine, or `null` under the headless backend. */
  readonly engine: LiteAudioEngine | null;
}

/**
 * What {@link AudioService}'s constructor is handed. The extension builds this; a game never does.
 *
 * @public
 */
export interface AudioServiceOptions {
  /** The app the service belongs to. */
  readonly app: App;
  /** A logger scoped to the extension. */
  readonly log: Logger;
  /** The backend every call is forwarded to. */
  readonly backend: AudioBackend;
  /** The resolved `audio` settings section, with the extension's options merged over it. */
  readonly settings: AudioSettings;
}

/**
 * The service behind `app.audio`.
 *
 * @example
 * ```ts
 * app.audio.bus("Music").setVolume(0.3, 2);
 * app.audio.playOneShot(coin.value, { volume: 0.8, pitch: 1.2 });
 * await app.audio.unlock(); // from a click handler, for an explicit "tap to start"
 * ```
 *
 * @public
 */
export class AudioService implements VoiceHost {
  /** The backend every call is forwarded to; `"headless"` under Node. */
  readonly backend: AudioBackend;

  readonly #app: App;

  readonly #log: Logger;

  readonly #settings: AudioSettings;

  readonly #buses = new Map<string, AudioBusImpl>();

  readonly #busOrder: AudioBusImpl[] = [];

  readonly #voices: SoundVoice[] = [];

  readonly #pending = new Map<SoundVoice, VoiceRequest>();

  readonly #oneShots = new Map<string, SoundVoice>();

  readonly #listeners: AudioListener[] = [];

  readonly #pausedByApp: SoundVoice[] = [];

  readonly #onStateChanged = new Signal<AudioServiceState>();

  #diagnostics: DiagnosticsGroup | null = null;

  #isLocked: boolean;

  #isTreeReady = false;

  #isDisposed = false;

  #wasPaused = false;

  #masterVolume: number;

  #unlockedAtMs: number | null = null;

  #detachState: (() => void) | null = null;

  /**
   * Creates the service. The extension does this in `onStart`, once a backend exists.
   *
   * @param options - The app, the logger, the backend, and the resolved settings.
   */
  constructor(options: AudioServiceOptions) {
    this.#app = options.app;
    this.#log = options.log;
    this.backend = options.backend;
    this.#settings = options.settings;
    this.#masterVolume = options.settings.masterVolume;
    this.#isLocked = options.backend.state !== "running";
    this.backend.setMasterVolume(this.#masterVolume);
    if (!this.#isLocked) {
      this.#unlockedAtMs = 0;
    }
    this.#detachState = this.backend.onStateChanged.connect((state: AudioBackendState): void => {
      if (this.#isLocked && state === "running") {
        this.#markUnlocked();
        return;
      }
      this.#onStateChanged.emit(this.state);
    });
  }

  /**
   * Where the audio engine is (`docs/architecture/10-audio.md` §1).
   *
   * @returns `"locked"` until the first unlock, and the audio context's own state after it.
   */
  get state(): AudioServiceState {
    return this.#isLocked ? "locked" : this.backend.state;
  }

  /**
   * `true` once the audio context has run at least once, so plays are no longer queued.
   *
   * @returns Whether the engine has been unlocked.
   */
  get isUnlocked(): boolean {
    return !this.#isLocked;
  }

  /**
   * `true` before the first unlock — the predicate voices queue on.
   *
   * @returns Whether plays are being held.
   */
  get isLocked(): boolean {
    return this.#isLocked;
  }

  /**
   * Whether plays made while locked are held rather than dropped.
   *
   * @returns The `audio.queueWhileLocked` setting.
   */
  get queueWhileLocked(): boolean {
    return this.#settings.queueWhileLocked;
  }

  /**
   * When the engine was unlocked, on the app's realtime clock.
   *
   * @returns Milliseconds since the app was created, or `null` while still locked.
   */
  get unlockedAtMs(): number | null {
    return this.#unlockedAtMs;
  }

  /**
   * The master output gain, applied after every bus.
   *
   * @returns The linear gain, where `1` is unity.
   */
  get masterVolume(): number {
    return this.#masterVolume;
  }

  // The accessor pair is documented on the getter above: API Extractor's `ae-setter-with-docs`
  // rejects a doc comment on the setter, and this package's api-report gate treats that as an error.
  // eslint-disable-next-line jsdoc/require-jsdoc -- see above.
  set masterVolume(value: number) {
    this.#masterVolume = value;
    this.backend.setMasterVolume(value);
  }

  /**
   * The mixer tree, keyed by bus name, in declaration order.
   *
   * @returns The buses. Empty until the tree has been built, which is before the first frame unless
   * the project loads its tree from a `.audio.json`.
   */
  get buses(): ReadonlyMap<string, AudioBus> {
    return this.#buses;
  }

  /**
   * `true` once the mixer tree exists and sounds can be routed.
   *
   * @returns Whether the tree has been built.
   */
  get isTreeReady(): boolean {
    return this.#isTreeReady;
  }

  /**
   * The listener spatial audio is heard from (`docs/architecture/10-audio.md` §4).
   *
   * @returns The most recently enabled {@link AudioListener}, or `null` when none is enabled.
   */
  get listener(): AudioListener | null {
    return this.#listeners.at(-1) ?? null;
  }

  /**
   * Emitted whenever {@link AudioService.state} changes.
   *
   * @returns The signal.
   */
  get onStateChanged(): SignalLike<AudioServiceState> {
    return this.#onStateChanged;
  }

  /**
   * The Babylon Lite objects behind the service. Unstable escape hatch.
   *
   * @returns The engine, or `null` under the headless backend.
   */
  get lite(): AudioServiceLiteHandles {
    return { engine: this.backend.lite?.engine ?? null };
  }

  /**
   * Resumes the audio context — what a "tap to start" button calls
   * (`docs/architecture/10-audio.md` §1).
   *
   * @remarks
   * Every `play()` made while locked is started as this settles, in the order it was requested.
   * Calling it when already unlocked is a no-op. Call it from inside a real user-gesture handler:
   * browsers ignore a resume that does not come from one.
   *
   * @returns A promise that settles once the context is running.
   *
   * @example
   * ```ts
   * button.addEventListener("click", () => void app.audio.unlock());
   * ```
   */
  async unlock(): Promise<void> {
    if (this.#isDisposed) {
      throw audioError(AudioErrorCode.audioDisposed, "The audio service has been disposed.", {
        context: { member: "app.audio.unlock" },
      });
    }
    await this.backend.unlock();
    this.#markUnlocked();
  }

  /**
   * Looks a bus up by name.
   *
   * @param name - The bus name, for example `"Music"`.
   * @returns The bus.
   * @throws IgnifxError with code `IGX-1001` when the tree holds no such bus.
   *
   * @example
   * ```ts
   * app.audio.bus("SFX").volume = 0.5;
   * ```
   */
  bus(name: string): AudioBus {
    const found = this.#buses.get(name);
    if (found === undefined) {
      throw audioError(AudioErrorCode.unknownBus, `${name} is not a bus of this app's audio tree.`, {
        context: { bus: name, buses: [...this.#buses.keys()].join(", ") },
        hint: "Declare it in the project's .audio.json or audio.defaultBuses, or call app.audio.createBus.",
      });
    }
    return found;
  }

  /**
   * Looks a bus up, tolerating its absence — the pattern for code that must work with or without a
   * particular bus (coding standards §5.5).
   *
   * @param name - The bus name.
   * @returns The bus, or `null`.
   */
  tryBus(name: string): AudioBus | null {
    return this.#buses.get(name) ?? null;
  }

  /**
   * Adds a bus to the tree at run time.
   *
   * @param name - The new bus's name.
   * @param options - Its parent, gain, and pause behaviour.
   * @returns The bus, once the backend has built it.
   * @throws IgnifxError with code `IGX-1001` when `options.parent` names a bus that does not exist,
   * or `IGX-1005` when the name is already taken.
   *
   * @example
   * ```ts
   * const ambience = await app.audio.createBus("Ambience", { parent: "Master", volume: 0.4 });
   * ```
   */
  async createBus(name: string, options?: CreateBusOptions): Promise<AudioBus> {
    if (this.#buses.has(name)) {
      throw audioError(AudioErrorCode.duplicateBusName, `The bus ${name} already exists.`, {
        context: { bus: name },
        hint: "Bus names are unique; reach the existing one with app.audio.bus(name).",
      });
    }
    const parentName = options?.parent ?? "";
    const parent = parentName === "" ? (this.#busOrder[0] ?? null) : this.#requireBus(parentName);
    const volume = options?.volume ?? 1;
    const pausable = options?.pausable ?? this.#settings.pausableBuses.includes(name);
    const backendBus = await this.backend.createBus({
      name,
      volume,
      parent: parent?.backendBus ?? null,
    });
    const bus = new AudioBusImpl(this.backend, backendBus, parent, volume, pausable);
    this.#buses.set(name, bus);
    this.#busOrder.push(bus);
    return bus;
  }

  /**
   * Plays a clip once, with no component and nothing to keep hold of — a coin pickup, a UI click
   * (`docs/architecture/10-audio.md` §1).
   *
   * @remarks
   * One voice is kept per clip-and-bus pair and reused, so a hundred coins in a second cost one
   * Web Audio sub-graph and a hundred instances, with the oldest stolen past sixteen. The clip must
   * already be loaded; an `asset()` field hands you exactly that.
   *
   * This is the **wider** of the two one-shot calls: it takes {@link OneShotOptions}, which is `bus`
   * plus all of `PlayOptions`. `AudioSource.playOneShot(clip, { volume })` is the narrow form — it
   * supplies the source's bus and accepts a gain and nothing else
   * (`docs/architecture/10-audio.md` §3, "Corrections"). Neither form is spatial; a positional sound
   * is `play()` on a spatial `AudioSource`.
   *
   * @param clip - The clip to play.
   * @param options - Per-play overrides, and the bus to route through.
   * @returns The sound, so a caller that wants to can stop or fade it.
   *
   * @example
   * ```ts
   * class Coin extends Script {
   *   pickup: AssetHandle<AudioClip> | null = null;
   *   onTriggerEnter(): void {
   *     if (this.pickup !== null) {
   *       this.app.audio.playOneShot(this.pickup.value, { pitch: 1 + Math.random() * 0.1 });
   *     }
   *   }
   * }
   * ```
   */
  playOneShot(clip: AudioClip, options?: OneShotOptions): SoundInstance {
    const busName = options?.bus ?? DEFAULT_SOUND_BUS;
    const key = `${clip.address} ${busName}`;
    let voice = this.#oneShots.get(key);
    if (voice === undefined || voice.isDisposed) {
      voice = this.createVoice({
        clip,
        bus: busName,
        volume: 1,
        playbackRate: 1,
        loop: false,
        maxInstances: ONE_SHOT_MAX_INSTANCES,
        pan: 0,
        spatial: null,
      });
      this.#oneShots.set(key, voice);
    }
    voice.play(playRequest(options, 1, false));
    return voice;
  }

  /**
   * Builds a voice: one clip routed to one bus, with the options an `AudioSource` carries.
   *
   * @remarks
   * The backend sound is created as soon as the mixer tree exists, which is normally before the
   * first frame; a voice built earlier holds its plays until then, the same way it holds them
   * behind the unlock.
   *
   * @param request - The clip, the bus name, and the per-sound options.
   * @returns The voice.
   *
   * @example
   * ```ts
   * const voice = app.audio.createVoice({
   *   clip, bus: "SFX", volume: 1, playbackRate: 1, loop: false, maxInstances: 8, pan: 0, spatial: null,
   * });
   * ```
   */
  createVoice(request: VoiceRequest): SoundVoice {
    const voice = new SoundVoice(this, request.clip, request.volume);
    this.#voices.push(voice);
    if (request.spatial !== null && this.listener === null) {
      this.#log.warnOnce(
        AudioErrorCode.noAudioListener,
        `${AudioErrorCode.noAudioListener}: a spatial AudioSource is playing with no enabled AudioListener; using the world origin.`,
      );
    }
    this.#materialise(voice, request);
    return voice;
  }

  /**
   * Releases a voice and its backend sound.
   *
   * @param voice - The voice to release.
   */
  releaseVoice(voice: SoundVoice): void {
    voice.dispose();
    this.#pending.delete(voice);
    const index = this.#voices.indexOf(voice);
    if (index >= 0) {
      this.#voices.splice(index, 1);
    }
  }

  /**
   * Adds a listener to the selection (`docs/architecture/10-audio.md` §4). The most recently
   * registered enabled listener wins, which during a scene load is the one with the highest
   * creation serial.
   *
   * @param listener - The listener that just became enabled.
   */
  registerListener(listener: AudioListener): void {
    if (!this.#listeners.includes(listener)) {
      this.#listeners.push(listener);
    }
    this.#applyListener();
  }

  /**
   * Removes a listener from the selection.
   *
   * @param listener - The listener that was disabled or destroyed.
   */
  unregisterListener(listener: AudioListener): void {
    const index = this.#listeners.indexOf(listener);
    if (index >= 0) {
      this.#listeners.splice(index, 1);
    }
    this.#applyListener();
  }

  /**
   * Builds the mixer tree, releasing whatever tree was there before.
   *
   * @param definitions - The buses, parents before children.
   * @throws IgnifxError with code `IGX-1006` when a definition names a parent that is not declared
   * before it.
   */
  async buildBuses(definitions: readonly AudioBusDefinition[]): Promise<void> {
    this.#disposeBuses();
    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index];
      if (definition === undefined) {
        continue;
      }
      const parent = definition.parent === null ? null : this.#requireBus(definition.parent);
      const pausable = definition.pausable ?? this.#settings.pausableBuses.includes(definition.name);
      // Sequential on purpose, and `Promise.all` is not an option: a bus is created *into* its
      // parent (Lite's `outBus`, `index.d.ts` 2091), so the parent has to exist first. The tree is
      // built once, at registration, with a handful of buses.
      // oxlint-disable-next-line no-await-in-loop -- parents must exist before their children.
      const backendBus = await this.backend.createBus({
        name: definition.name,
        volume: definition.volume,
        parent: parent?.backendBus ?? null,
      });
      const bus = new AudioBusImpl(this.backend, backendBus, parent, definition.volume, pausable);
      this.#buses.set(definition.name, bus);
      this.#busOrder.push(bus);
    }
    this.#isTreeReady = true;
    this.#materialisePending();
  }

  /**
   * Turns a list of bus names into the default tree: the first name is the root and every other
   * name routes into it (`docs/architecture/10-audio.md` §1).
   *
   * @param names - The bus names, root first.
   * @returns The definitions to hand {@link AudioService.buildBuses}.
   */
  static defaultBusTree(names: readonly string[]): readonly AudioBusDefinition[] {
    const root = names[0] ?? "Master";
    const definitions: AudioBusDefinition[] = [];
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (name === undefined) {
        continue;
      }
      definitions.push({ name, parent: index === 0 ? null : root, volume: 1, pausable: null });
    }
    return definitions;
  }

  /**
   * Attaches the diagnostics group the extension registered.
   *
   * @param group - The `audio` counter group.
   */
  setDiagnostics(group: DiagnosticsGroup): void {
    this.#diagnostics = group;
  }

  /**
   * Reports a failure that has no caller to throw at, through `app.onError`.
   *
   * @param error - What went wrong.
   */
  reportError(error: unknown): void {
    this.#app.onError.emit({ error, source: "extension", phase: null, entity: null, component: null });
  }

  /**
   * Advances everything time-based by one frame: fades, pending stops, the app-pause transition,
   * simulated playback, and `onEnded` (`docs/architecture/01-lifecycle-and-time.md` §3 step 10).
   *
   * @param deltaSeconds - The frame delta in seconds.
   */
  pump(deltaSeconds: number): void {
    if (this.#isDisposed) {
      return;
    }
    this.#pumpPause();
    for (let index = 0; index < this.#busOrder.length; index += 1) {
      this.#busOrder[index]?.advance(deltaSeconds);
    }
    for (let index = 0; index < this.#voices.length; index += 1) {
      this.#voices[index]?.advance(deltaSeconds);
    }
    this.backend.update(deltaSeconds);
    for (let index = 0; index < this.#voices.length; index += 1) {
      this.#voices[index]?.settle();
    }
    this.#sample();
  }

  /** Releases every voice, every bus, and the backend itself. */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#detachState?.();
    this.#detachState = null;
    for (let index = 0; index < this.#voices.length; index += 1) {
      this.#voices[index]?.dispose();
    }
    this.#voices.length = 0;
    this.#pending.clear();
    this.#oneShots.clear();
    this.#listeners.length = 0;
    this.#pausedByApp.length = 0;
    this.#buses.clear();
    this.#busOrder.length = 0;
    this.backend.dispose();
    this.#onStateChanged.clear();
  }

  /**
   * Looks a bus up, throwing the shared `IGX-1001`.
   *
   * @param name - The bus name.
   * @returns The bus.
   * @throws IgnifxError with code `IGX-1001` when the tree holds no such bus.
   */
  #requireBus(name: string): AudioBusImpl {
    const found = this.#buses.get(name);
    if (found === undefined) {
      throw audioError(AudioErrorCode.unknownBus, `${name} is not a bus of this app's audio tree.`, {
        context: { bus: name, buses: [...this.#buses.keys()].join(", ") },
        hint: "Declare it in the project's .audio.json or audio.defaultBuses, or call app.audio.createBus.",
      });
    }
    return found;
  }

  /**
   * Creates the backend sound behind a voice, or records the request until the tree is ready.
   *
   * @param voice - The voice to give a sound.
   * @param request - What to build it from.
   */
  #materialise(voice: SoundVoice, request: VoiceRequest): void {
    if (!this.#isTreeReady) {
      this.#pending.set(voice, request);
      return;
    }
    const busName = request.bus === "" ? DEFAULT_SOUND_BUS : request.bus;
    const bus = this.#requireBus(busName);
    const soundRequest: BackendSoundRequest = {
      clip: request.clip,
      bus: bus.backendBus,
      volume: request.volume,
      playbackRate: request.playbackRate,
      loop: request.loop,
      maxInstances: request.maxInstances,
      pan: request.pan,
      spatial: request.spatial,
    };
    const created = this.backend.createSound(soundRequest);
    if (created instanceof Promise) {
      void created.then(
        (sound): void => {
          voice.attach(sound, bus);
        },
        (error: unknown): void => {
          this.reportError(error);
        },
      );
      return;
    }
    voice.attach(created, bus);
  }

  /** Materialises every voice that was waiting for the mixer tree. */
  #materialisePending(): void {
    if (this.#pending.size === 0) {
      return;
    }
    const waiting = [...this.#pending];
    this.#pending.clear();
    for (let index = 0; index < waiting.length; index += 1) {
      const entry = waiting[index];
      if (entry === undefined || entry[0].isDisposed) {
        continue;
      }
      try {
        this.#materialise(entry[0], entry[1]);
      } catch (error) {
        // A voice that named a bus the delivered tree does not hold has no caller left to throw at:
        // its `play()` returned frames ago. `IGX-1001` goes to `app.onError` instead.
        this.reportError(error);
      }
    }
  }

  /** Records the unlock, flushes every queued play, and announces the new state. */
  #markUnlocked(): void {
    if (!this.#isLocked) {
      return;
    }
    this.#isLocked = false;
    this.#unlockedAtMs = this.#app.time.realtimeSinceStartup * MILLISECONDS_PER_SECOND;
    for (let index = 0; index < this.#voices.length; index += 1) {
      this.#voices[index]?.flush();
    }
    this.#onStateChanged.emit(this.state);
  }

  /** Points the backend's listener at whichever listener component is active. */
  #applyListener(): void {
    const active = this.listener;
    const target: LiteSpatialTarget | null = active === null ? null : active.spatialTarget;
    this.backend.setListener(target);
  }

  /** Pauses or resumes the pausable buses when `app.pause()`/`resume()` was called. */
  #pumpPause(): void {
    if (!this.#settings.pauseWithApp) {
      return;
    }
    const paused = this.#app.time.paused;
    if (paused === this.#wasPaused) {
      return;
    }
    this.#wasPaused = paused;
    if (paused) {
      for (let index = 0; index < this.#voices.length; index += 1) {
        const voice = this.#voices[index];
        if (voice !== undefined && voice.isPlaying && (voice.bus?.pausable ?? true)) {
          voice.pause();
          this.#pausedByApp.push(voice);
        }
      }
      return;
    }
    for (let index = 0; index < this.#pausedByApp.length; index += 1) {
      this.#pausedByApp[index]?.resume();
    }
    this.#pausedByApp.length = 0;
  }

  /** Writes this frame's counters. */
  #sample(): void {
    const group = this.#diagnostics;
    if (group === null) {
      return;
    }
    let instances = 0;
    let streaming = 0;
    for (let index = 0; index < this.#voices.length; index += 1) {
      const voice = this.#voices[index];
      if (voice === undefined) {
        continue;
      }
      instances += voice.instanceCount;
      if (voice.clip.isStreaming && voice.instanceCount > 0) {
        streaming += 1;
      }
    }
    group.set(0, STATE_NAMES.indexOf(this.state));
    group.set(1, this.#voices.length);
    group.set(2, instances);
    group.set(3, streaming);
    group.set(4, this.#buses.size);
    group.set(5, this.#unlockedAtMs ?? 0);
  }

  /** Releases every bus of the current tree. */
  #disposeBuses(): void {
    for (let index = this.#busOrder.length - 1; index >= 0; index -= 1) {
      const bus = this.#busOrder[index];
      if (bus !== undefined) {
        this.backend.disposeBus(bus.backendBus);
      }
    }
    this.#buses.clear();
    this.#busOrder.length = 0;
    this.#isTreeReady = false;
  }
}

/**
 * Turns the options a game passed to `play()` into the request a backend understands.
 *
 * @remarks
 * `volume` defaults to `1`, not to the source's `volume` field: the field is the *sound's* gain and
 * is already on the voice, so a per-play volume multiplies it the way Unity's `PlayOneShot`
 * volume scale does. Passing the field here as well would square it.
 *
 * @param options - What the caller passed, if anything.
 * @param playbackRate - The sound's own rate, used when the caller named no pitch.
 * @param loop - The sound's own loop flag, used when the caller named none.
 * @returns The request.
 *
 * @internal
 */
export function playRequest(options: PlayOptions | undefined, playbackRate: number, loop: boolean): BackendPlayRequest {
  return {
    volume: options?.volume ?? 1,
    playbackRate: options?.pitch ?? playbackRate,
    loop: options?.loop ?? loop,
    startOffset: options?.startOffset ?? 0,
    duration: options?.duration ?? 0,
    delay: options?.delay ?? 0,
  };
}
