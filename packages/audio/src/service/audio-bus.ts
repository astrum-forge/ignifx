import { Ramp } from "./ramp.js";
import type { AudioBackend, BackendBus } from "../backend/types.js";
import type { LiteAudioBus } from "../lite/types.js";

/**
 * One mixer bus of `app.audio` (`docs/architecture/10-audio.md` §1). A bus is a named gain in a
 * tree: `SFX` routes into `Master`, `Master` routes into the engine's output, and turning `Master`
 * down turns everything down.
 *
 * ## Two members the design document does not list
 *
 * `parent` and `effectiveVolume` are additions. A tree whose shape cannot be read back is a tree
 * nothing can inspect — no devtools fader panel, no test that "Music sits under Master" — and
 * `effectiveVolume` is the number that actually reaches the output, which is the one a mixing
 * problem is diagnosed with. Neither costs anything: the chain is at most a handful of links, and
 * `effectiveVolume` is computed on read.
 */

/**
 * A named gain in the mixer tree.
 *
 * @example
 * ```ts
 * app.audio.bus("Music").setVolume(0.2, 1.5); // duck the music over a second and a half
 * app.audio.bus("SFX").muted = true;
 * ```
 *
 * @public
 */
export interface AudioBus {
  /** The bus name; what `AudioSource.bus` and `app.audio.bus(name)` use. */
  readonly name: string;
  /** The bus this one routes into, or `null` for the root. */
  readonly parent: AudioBus | null;
  /** Whether `app.pause()` pauses the sounds routed directly to this bus. */
  readonly pausable: boolean;
  /** This bus's own linear gain, ignoring its parents. Setting it applies immediately. */
  volume: number;
  /** Silences the bus and everything under it without losing {@link AudioBus.volume}. */
  muted: boolean;
  /** The gain that actually reaches the output: this bus's applied gain times its parents'. */
  readonly effectiveVolume: number;
  /**
   * Fades this bus's own gain.
   *
   * @param volume - The target linear gain.
   * @param rampSeconds - How long the fade takes, in frame time; `0` applies immediately.
   */
  setVolume(volume: number, rampSeconds?: number): void;
  /** Lite's bus, or `null` under the headless backend. Unstable escape hatch. */
  readonly lite: LiteAudioBus | null;
}

/**
 * The bus `app.audio` builds and the pump advances.
 *
 * @internal
 */
export class AudioBusImpl implements AudioBus {
  /** The bus name. */
  readonly name: string;

  /** The bus this one routes into, or `null` for the root. */
  readonly parent: AudioBusImpl | null;

  /** Whether `app.pause()` pauses the sounds routed to this bus. */
  readonly pausable: boolean;

  /** The backend's own bus object. */
  readonly backendBus: BackendBus;

  readonly #backend: AudioBackend;

  readonly #ramp: Ramp;

  #muted = false;

  /**
   * Wraps a backend bus.
   *
   * @param backend - The backend that made it.
   * @param backendBus - The backend's bus object.
   * @param parent - The bus this one routes into, or `null`.
   * @param volume - Its own linear gain.
   * @param pausable - Whether `app.pause()` pauses it.
   */
  constructor(
    backend: AudioBackend,
    backendBus: BackendBus,
    parent: AudioBusImpl | null,
    volume: number,
    pausable: boolean,
  ) {
    this.#backend = backend;
    this.backendBus = backendBus;
    this.name = backendBus.name;
    this.parent = parent;
    this.pausable = pausable;
    this.#ramp = new Ramp(volume);
  }

  /**
   * This bus's own gain, where a fade in progress has reached.
   *
   * @returns The linear gain.
   */
  get volume(): number {
    return this.#ramp.value;
  }

  set volume(value: number) {
    this.#ramp.set(value);
    this.#apply();
  }

  /**
   * Whether the bus is silenced.
   *
   * @returns `true` when muted.
   */
  get muted(): boolean {
    return this.#muted;
  }

  set muted(value: boolean) {
    if (this.#muted === value) {
      return;
    }
    this.#muted = value;
    this.#apply();
  }

  /**
   * The gain the bus contributes after mute: `0`, or its own gain.
   *
   * @returns The gain written to the backend.
   */
  get appliedVolume(): number {
    return this.#muted ? 0 : this.#ramp.value;
  }

  /**
   * The gain that reaches the output.
   *
   * @returns This bus's applied gain multiplied by every ancestor's.
   */
  get effectiveVolume(): number {
    let volume = this.appliedVolume;
    let bus: AudioBusImpl | null = this.parent;
    while (bus !== null) {
      volume *= bus.appliedVolume;
      bus = bus.parent;
    }
    return volume;
  }

  /**
   * Lite's bus.
   *
   * @returns The Lite object, or `null` under the headless backend.
   */
  get lite(): LiteAudioBus | null {
    return this.backendBus.lite;
  }

  /**
   * Fades this bus's own gain.
   *
   * @param volume - The target linear gain.
   * @param rampSeconds - How long the fade takes, in frame time; `0` applies immediately.
   */
  setVolume(volume: number, rampSeconds: number = 0): void {
    this.#ramp.to(volume, rampSeconds);
    if (!this.#ramp.isActive) {
      this.#apply();
    }
  }

  /**
   * Advances a fade in progress.
   *
   * @param deltaSeconds - The frame delta in seconds.
   */
  advance(deltaSeconds: number): void {
    if (this.#ramp.advance(deltaSeconds)) {
      this.#apply();
    }
  }

  /** Writes the current applied gain to the backend. */
  #apply(): void {
    this.#backend.setBusVolume(this.backendBus, this.appliedVolume);
  }
}
