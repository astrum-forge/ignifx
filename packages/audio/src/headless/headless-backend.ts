import { Signal } from "@ignifx/core";
import type { AudioClip } from "../assets/audio-clip.js";
import type {
  AudioBackend,
  AudioBackendKind,
  AudioBackendState,
  AudioLiteHandles,
  BackendBus,
  BackendBusRequest,
  BackendPlayRequest,
  BackendSound,
  BackendSoundRequest,
  BackendSpatialRequest,
} from "../backend/types.js";
import type { LiteSpatialTarget } from "../lite/types.js";
import type { SignalLike } from "@ignifx/core";

/**
 * The headless {@link AudioBackend} (`docs/architecture/10-audio.md` §7). Pure TypeScript: it
 * imports nothing from Babylon Lite and touches no Web Audio API, so it runs under Node, in a
 * worker, and on a server.
 *
 * ## It simulates playback rather than stubbing it
 *
 * A no-op backend would make every audio test vacuous — `isPlaying` would be a lie and `onEnded`
 * would never fire, so a coroutine that waits for a line of dialogue to finish could not be tested
 * at all. This backend instead keeps the state a real engine keeps and advances it:
 *
 * - `play` spawns an instance with `clip.duration / playbackRate` seconds left to run, stealing the
 *   **oldest** live instance when `maxInstances` is reached — which is what Babylon Lite does
 *   (`lib/audio/static-sound.js`, `_stopExcessInstances` stops the oldest started instances).
 * - {@link HeadlessBackend.update} subtracts the frame delta from every unpaused instance and drops
 *   the ones that reached zero, so `isPlaying` goes false on exactly the frame a real engine would
 *   have gone quiet. Raising `onEnded` is the service's job, from the same pump.
 * - A looping instance, and an instance of a clip whose duration is unknown, never end on their
 *   own. Both are honest: a loop does not end, and a duration this build could not read cannot be
 *   simulated (`AudioClip`).
 *
 * The clock is the **engine clock the pump advances**, not `Date.now()` and not
 * `performance.now()`: `app.step(1 / 60)` therefore advances audio by exactly one sixtieth of a
 * second, and a test that steps sixty times has advanced audio by exactly one second on every
 * machine (coding standards §10: no test sleeps on wall-clock time).
 */

/** Milliseconds in one second, for the diagnostics timestamp. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * One simulated instance of a sound: what a real engine would have as a source node.
 *
 * @internal
 */
interface HeadlessInstance {
  /** Seconds left before the instance starts, from the play request's `delay`. */
  delay: number;
  /** Seconds of playback left, or `null` when the instance never ends on its own. */
  remaining: number | null;
  /** `true` while the instance is paused. */
  paused: boolean;
  /** The order the instance was started in, so the oldest can be stolen. */
  readonly serial: number;
}

/**
 * A bus of the headless backend: a name, a gain, and its place in the tree.
 *
 * @public
 */
export class HeadlessBus implements BackendBus {
  /** The bus name. */
  readonly name: string;

  /** The bus it routes into, or `null` for the root. */
  readonly parent: HeadlessBus | null;

  /** Lite owns nothing here, so the escape hatch is always `null`. */
  readonly lite: null = null;

  /** The bus's own linear gain, before the parent chain. */
  volume: number;

  /** `true` once the tree it belongs to has released it. */
  isDisposed = false;

  /**
   * Creates a simulated bus.
   *
   * @param name - The bus name.
   * @param volume - Its own linear gain.
   * @param parent - The bus it routes into, or `null`.
   */
  constructor(name: string, volume: number, parent: HeadlessBus | null) {
    this.name = name;
    this.volume = volume;
    this.parent = parent;
  }

  /**
   * The gain this bus actually contributes: its own, multiplied up the parent chain. A real Web
   * Audio graph gets this for free by chaining gain nodes; the simulation has to multiply.
   *
   * @returns The product of every gain from this bus to the root.
   */
  get effectiveVolume(): number {
    let volume = this.volume;
    let bus = this.parent;
    while (bus !== null) {
      volume *= bus.volume;
      bus = bus.parent;
    }
    return volume;
  }
}

/**
 * A sound of the headless backend: one clip routed to one bus, carrying simulated instances.
 *
 * @public
 */
export class HeadlessSound implements BackendSound {
  /** The clip this sound plays. */
  readonly clip: AudioClip;

  /** The bus it routes into, or `null` for the main bus. */
  readonly bus: HeadlessBus | null;

  /** The 3D placement it was created with, or `null` for a non-spatial sound. */
  readonly spatial: BackendSpatialRequest | null;

  /** How many instances may play at once. */
  readonly maxInstances: number;

  /** The sound's own linear gain, as the last `setSoundVolume` left it. */
  volume: number;

  /** The sound's stereo pan, as the last `setSoundPan` left it. */
  pan: number;

  /** `true` once the backend has released it. */
  isDisposed = false;

  readonly #instances: HeadlessInstance[] = [];

  #serial = 0;

  /**
   * Creates a simulated sound.
   *
   * @param request - The clip, routing, and per-sound options.
   */
  constructor(request: BackendSoundRequest) {
    this.clip = request.clip;
    // The bus a request carries is always one this backend made, because the service only ever
    // hands back buses the backend gave it (coding standards §5.2: the invariant, stated once).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    this.bus = request.bus === null ? null : (request.bus as HeadlessBus);
    this.spatial = request.spatial;
    this.maxInstances = request.maxInstances;
    this.volume = request.volume;
    this.pan = request.pan;
  }

  /**
   * How many instances are live.
   *
   * @returns The instance count.
   */
  get instanceCount(): number {
    return this.#instances.length;
  }

  /**
   * Whether anything is sounding.
   *
   * @returns `true` while at least one instance is live and not paused.
   */
  get isPlaying(): boolean {
    for (let index = 0; index < this.#instances.length; index += 1) {
      if (this.#instances[index]?.paused === false) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether every live instance is paused.
   *
   * @returns `true` when there is at least one instance and none of them are running.
   */
  get isPaused(): boolean {
    return this.#instances.length > 0 && !this.isPlaying;
  }

  /**
   * The gain a listener would hear: the sound's own gain times its bus chain.
   *
   * @returns The product.
   */
  get effectiveVolume(): number {
    return this.volume * (this.bus?.effectiveVolume ?? 1);
  }

  /**
   * Starts one instance, stealing the oldest when the sound is already at `maxInstances`.
   *
   * @param request - The per-play overrides.
   */
  start(request: BackendPlayRequest): void {
    const duration = this.clip.duration;
    const rate = request.playbackRate > 0 ? request.playbackRate : 1;
    const playable = request.duration > 0 ? request.duration : (duration ?? 0) - request.startOffset;
    this.#instances.push({
      delay: Math.max(0, request.delay),
      remaining: request.loop || duration === null ? null : Math.max(0, playable) / rate,
      paused: false,
      serial: this.#serial,
    });
    this.#serial += 1;
    while (this.#instances.length > this.maxInstances) {
      this.#instances.shift();
    }
  }

  /** Stops every instance at once, without an `onEnded`: a stop is not an end. */
  stopAll(): void {
    this.#instances.length = 0;
  }

  /** Pauses every instance, keeping its remaining time. */
  pauseAll(): void {
    for (let index = 0; index < this.#instances.length; index += 1) {
      const instance = this.#instances[index];
      if (instance !== undefined) {
        instance.paused = true;
      }
    }
  }

  /** Resumes every paused instance. */
  resumeAll(): void {
    for (let index = 0; index < this.#instances.length; index += 1) {
      const instance = this.#instances[index];
      if (instance !== undefined) {
        instance.paused = false;
      }
    }
  }

  /**
   * Advances every running instance and drops the ones that finished.
   *
   * @param deltaSeconds - The frame delta in seconds.
   */
  advance(deltaSeconds: number): void {
    if (this.#instances.length === 0) {
      return;
    }
    let write = 0;
    for (let read = 0; read < this.#instances.length; read += 1) {
      const instance = this.#instances[read];
      if (instance === undefined) {
        continue;
      }
      let left = deltaSeconds;
      if (!instance.paused) {
        if (instance.delay > 0) {
          const spent = Math.min(instance.delay, left);
          instance.delay -= spent;
          left -= spent;
        }
        if (instance.remaining !== null && left > 0) {
          instance.remaining -= left;
        }
      }
      if (instance.remaining !== null && instance.remaining <= 0) {
        continue;
      }
      this.#instances[write] = instance;
      write += 1;
    }
    this.#instances.length = write;
  }

  /** Drops every instance; the backend calls it from `disposeSound`. */
  dispose(): void {
    this.#instances.length = 0;
    this.isDisposed = true;
  }
}

/**
 * Options accepted by {@link HeadlessBackend}.
 *
 * @public
 */
export interface HeadlessBackendOptions {
  /** The initial master gain. Defaults to `1`. */
  readonly masterVolume?: number;
  /**
   * Start in the `"suspended"` state, so `app.audio.state` reads `"locked"` and plays are queued
   * until `app.audio.unlock()` — the browser's behaviour, reproduced under Node so the unlock flow
   * can be tested without a browser. Defaults to `false`.
   */
  readonly startSuspended?: boolean;
}

/**
 * The audio backend that runs where there is no Web Audio.
 *
 * @example
 * ```ts
 * // Exercise the browser's locked-until-a-gesture behaviour in a Node test.
 * const app = await createApp({
 *   headless: true,
 *   extensions: [audio({ createBackend: () => new HeadlessBackend({ startSuspended: true }) })],
 * });
 * ```
 *
 * @public
 */
export class HeadlessBackend implements AudioBackend {
  /** Which implementation this is. */
  readonly kind: AudioBackendKind = "headless";

  /** There is no Lite engine behind this backend. */
  readonly lite: AudioLiteHandles | null = null;

  readonly #onStateChanged = new Signal<AudioBackendState>();

  readonly #sounds: HeadlessSound[] = [];

  readonly #buses: HeadlessBus[] = [];

  #state: AudioBackendState;

  #masterVolume: number;

  #listener: LiteSpatialTarget | null = null;

  #elapsedSeconds = 0;

  /**
   * Creates the backend.
   *
   * @param options - The initial gain, and whether to start suspended.
   */
  constructor(options?: HeadlessBackendOptions) {
    this.#masterVolume = options?.masterVolume ?? 1;
    this.#state = options?.startSuspended === true ? "suspended" : "running";
  }

  /**
   * The simulated context's state.
   *
   * @returns The state.
   */
  get state(): AudioBackendState {
    return this.#state;
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
   * Every sound this backend has made and not released, for tests and diagnostics.
   *
   * @returns The live sounds, in creation order.
   */
  get sounds(): readonly HeadlessSound[] {
    return this.#sounds;
  }

  /**
   * Every bus this backend has made, for tests and diagnostics.
   *
   * @returns The live buses, in creation order.
   */
  get buses(): readonly HeadlessBus[] {
    return this.#buses;
  }

  /**
   * The world transform the listener follows.
   *
   * @returns The target, or `null` when the listener sits at the world origin.
   */
  get listener(): LiteSpatialTarget | null {
    return this.#listener;
  }

  /**
   * How many seconds of engine time the pump has advanced.
   *
   * @returns The elapsed simulated time in seconds.
   */
  get elapsedSeconds(): number {
    return this.#elapsedSeconds;
  }

  /**
   * How many milliseconds of engine time the pump has advanced, for diagnostics.
   *
   * @returns The elapsed simulated time in milliseconds.
   */
  get elapsedMs(): number {
    return this.#elapsedSeconds * MILLISECONDS_PER_SECOND;
  }

  /**
   * Reads the master gain.
   *
   * @returns The gain.
   */
  getMasterVolume(): number {
    return this.#masterVolume;
  }

  /**
   * Sets the master gain.
   *
   * @param volume - The gain to apply now.
   */
  setMasterVolume(volume: number): void {
    this.#masterVolume = volume;
  }

  /**
   * Moves the simulated context to `"running"`.
   *
   * @returns A promise that settles once the state has changed.
   */
  unlock(): Promise<void> {
    this.#setState("running");
    return Promise.resolve();
  }

  /**
   * Creates a simulated bus.
   *
   * @param request - The name, gain, and parent bus.
   * @returns The bus.
   */
  createBus(request: BackendBusRequest): Promise<BackendBus> {
    // The parent is always a bus this backend made; see the note in `HeadlessSound`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const parent = request.parent === null ? null : (request.parent as HeadlessBus);
    const bus = new HeadlessBus(request.name, request.volume, parent);
    this.#buses.push(bus);
    return Promise.resolve(bus);
  }

  /**
   * Sets a bus's gain.
   *
   * @param bus - The bus.
   * @param volume - The gain to apply now.
   */
  setBusVolume(bus: BackendBus, volume: number): void {
    if (bus instanceof HeadlessBus) {
      bus.volume = volume;
    }
  }

  /**
   * Releases a bus.
   *
   * @param bus - The bus.
   */
  disposeBus(bus: BackendBus): void {
    if (!(bus instanceof HeadlessBus)) {
      return;
    }
    bus.isDisposed = true;
    const index = this.#buses.indexOf(bus);
    if (index >= 0) {
      this.#buses.splice(index, 1);
    }
  }

  /**
   * Nothing is decoded under Node: a clip keeps whatever duration its container header gave it.
   *
   * @returns A settled promise.
   */
  decode(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Creates a simulated sound. Synchronously, on purpose: it is what makes `onEnded` timing exact
   * in a test that never awaits between `play()` and the frames it steps.
   *
   * @param request - The clip, routing, and per-sound options.
   * @returns The sound.
   */
  createSound(request: BackendSoundRequest): BackendSound {
    const sound = new HeadlessSound(request);
    this.#sounds.push(sound);
    return sound;
  }

  /**
   * Starts one instance, or resumes the sound when it was paused — Babylon Lite's documented
   * behaviour (`index.d.ts` 8955).
   *
   * @param sound - The sound.
   * @param request - The per-play overrides.
   */
  play(sound: BackendSound, request: BackendPlayRequest): void {
    if (!(sound instanceof HeadlessSound)) {
      return;
    }
    if (sound.isPaused) {
      sound.resumeAll();
      return;
    }
    sound.start(request);
  }

  /**
   * Stops every instance.
   *
   * @param sound - The sound.
   */
  stop(sound: BackendSound): void {
    if (sound instanceof HeadlessSound) {
      sound.stopAll();
    }
  }

  /**
   * Pauses every instance.
   *
   * @param sound - The sound.
   */
  pause(sound: BackendSound): void {
    if (sound instanceof HeadlessSound) {
      sound.pauseAll();
    }
  }

  /**
   * Resumes every paused instance.
   *
   * @param sound - The sound.
   */
  resume(sound: BackendSound): void {
    if (sound instanceof HeadlessSound) {
      sound.resumeAll();
    }
  }

  /**
   * Sets a sound's gain. Fades are interpolated by the service, so the value arrives already at
   * this frame's position along the ramp.
   *
   * @param sound - The sound.
   * @param volume - The gain to apply now.
   */
  setSoundVolume(sound: BackendSound, volume: number): void {
    if (sound instanceof HeadlessSound) {
      sound.volume = volume;
    }
  }

  /**
   * Sets a sound's stereo pan.
   *
   * @param sound - The sound.
   * @param pan - The pan in `[-1, 1]`.
   */
  setSoundPan(sound: BackendSound, pan: number): void {
    if (sound instanceof HeadlessSound) {
      sound.pan = pan;
    }
  }

  /**
   * Releases a sound.
   *
   * @param sound - The sound.
   */
  disposeSound(sound: BackendSound): void {
    if (!(sound instanceof HeadlessSound)) {
      return;
    }
    sound.dispose();
    const index = this.#sounds.indexOf(sound);
    if (index >= 0) {
      this.#sounds.splice(index, 1);
    }
  }

  /**
   * Records the transform the listener follows. Nothing is audible, so nothing else happens; the
   * value is here so a test can assert that a listener was selected.
   *
   * @param target - The transform, or `null`.
   */
  setListener(target: LiteSpatialTarget | null): void {
    this.#listener = target;
  }

  /**
   * Advances simulated playback by one frame, dropping every instance whose time ran out.
   *
   * @param deltaSeconds - The frame delta in seconds.
   */
  update(deltaSeconds: number): void {
    if (deltaSeconds <= 0) {
      return;
    }
    this.#elapsedSeconds += deltaSeconds;
    for (let index = 0; index < this.#sounds.length; index += 1) {
      this.#sounds[index]?.advance(deltaSeconds);
    }
  }

  /** Releases every sound and bus and closes the simulated context. */
  dispose(): void {
    for (let index = 0; index < this.#sounds.length; index += 1) {
      this.#sounds[index]?.dispose();
    }
    this.#sounds.length = 0;
    this.#buses.length = 0;
    this.#listener = null;
    this.#setState("closed");
    this.#onStateChanged.clear();
  }

  /**
   * Moves to a new state and announces it, ignoring a move to the state it is already in.
   *
   * @param state - The new state.
   */
  #setState(state: AudioBackendState): void {
    if (this.#state === state) {
      return;
    }
    this.#state = state;
    this.#onStateChanged.emit(state);
  }
}
