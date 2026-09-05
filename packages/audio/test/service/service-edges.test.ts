import { describe, expect, it } from "vitest";
import { AudioClip } from "../../src/assets/audio-clip.js";
import { AudioSource } from "../../src/components/audio-source.js";
import { HeadlessBackend } from "../../src/headless/headless-backend.js";
import { AudioService } from "../../src/service/audio-service.js";
import { Ramp } from "../../src/service/ramp.js";
import { createAudioApp, makeClip } from "../support/harness.js";
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
} from "../../src/backend/types.js";
import type { LiteSpatialTarget } from "../../src/lite/types.js";
import type { ErrorReport, SignalLike } from "@ignifx/core";

/**
 * The paths a browser takes that Node otherwise never reaches: an asynchronous `createSound`, a
 * clip that only exists once a backend has decoded it, and the failures that have no caller left to
 * throw at by the time they happen.
 */

/**
 * A backend that behaves exactly like the headless one except that creating a sound is
 * asynchronous — which is what Web Audio decoding makes it.
 */
class AsyncBackend implements AudioBackend {
  /** Which implementation this is. */
  readonly kind: AudioBackendKind = "headless";

  /** The simulation everything is delegated to. */
  readonly inner = new HeadlessBackend();

  /** Rejects the next `createSound` instead of answering it. */
  failNext = false;

  /**
   * The audio context's state.
   *
   * @returns The inner backend's state.
   */
  get state(): AudioBackendState {
    return this.inner.state;
  }

  /**
   * Emitted whenever the state changes.
   *
   * @returns The inner backend's signal.
   */
  get onStateChanged(): SignalLike<AudioBackendState> {
    return this.inner.onStateChanged;
  }

  /**
   * The Lite objects this backend owns.
   *
   * @returns `null`; there are none.
   */
  get lite(): AudioLiteHandles | null {
    return null;
  }

  /**
   * Reads the master gain.
   *
   * @returns The gain.
   */
  getMasterVolume(): number {
    return this.inner.getMasterVolume();
  }

  /**
   * Sets the master gain.
   *
   * @param volume - The gain.
   */
  setMasterVolume(volume: number): void {
    this.inner.setMasterVolume(volume);
  }

  /**
   * Resumes the context.
   *
   * @returns A settled promise.
   */
  async unlock(): Promise<void> {
    await this.inner.unlock();
  }

  /**
   * Creates a bus.
   *
   * @param request - The name, gain, and parent.
   * @returns The bus.
   */
  async createBus(request: BackendBusRequest): Promise<BackendBus> {
    return this.inner.createBus(request);
  }

  /**
   * Sets a bus gain.
   *
   * @param bus - The bus.
   * @param volume - The gain.
   */
  setBusVolume(bus: BackendBus, volume: number): void {
    this.inner.setBusVolume(bus, volume);
  }

  /**
   * Releases a bus.
   *
   * @param bus - The bus.
   */
  disposeBus(bus: BackendBus): void {
    this.inner.disposeBus(bus);
  }

  /**
   * Decodes nothing.
   *
   * @returns A settled promise.
   */
  async decode(): Promise<void> {
    await this.inner.decode();
  }

  /**
   * Creates a sound, one microtask later than the simulation would.
   *
   * @param request - The clip, routing, and options.
   * @returns The sound.
   */
  async createSound(request: BackendSoundRequest): Promise<BackendSound> {
    await Promise.resolve();
    if (this.failNext) {
      this.failNext = false;
      throw new Error("decode failed");
    }
    return this.inner.createSound(request);
  }

  /**
   * Starts one instance.
   *
   * @param sound - The sound.
   * @param request - The per-play overrides.
   */
  play(sound: BackendSound, request: BackendPlayRequest): void {
    this.inner.play(sound, request);
  }

  /**
   * Stops every instance.
   *
   * @param sound - The sound.
   */
  stop(sound: BackendSound): void {
    this.inner.stop(sound);
  }

  /**
   * Pauses every instance.
   *
   * @param sound - The sound.
   */
  pause(sound: BackendSound): void {
    this.inner.pause(sound);
  }

  /**
   * Resumes every instance.
   *
   * @param sound - The sound.
   */
  resume(sound: BackendSound): void {
    this.inner.resume(sound);
  }

  /**
   * Sets a sound's gain.
   *
   * @param sound - The sound.
   * @param volume - The gain.
   */
  setSoundVolume(sound: BackendSound, volume: number): void {
    this.inner.setSoundVolume(sound, volume);
  }

  /**
   * Sets a sound's pan.
   *
   * @param sound - The sound.
   * @param pan - The pan.
   */
  setSoundPan(sound: BackendSound, pan: number): void {
    this.inner.setSoundPan(sound, pan);
  }

  /**
   * Releases a sound.
   *
   * @param sound - The sound.
   */
  disposeSound(sound: BackendSound): void {
    this.inner.disposeSound(sound);
  }

  /**
   * Points the listener at a transform.
   *
   * @param target - The transform, or `null`.
   */
  setListener(target: LiteSpatialTarget | null): void {
    this.inner.setListener(target);
  }

  /**
   * Advances the simulation.
   *
   * @param deltaSeconds - The frame delta.
   */
  update(deltaSeconds: number): void {
    this.inner.update(deltaSeconds);
  }

  /** Releases everything. */
  dispose(): void {
    this.inner.dispose();
  }
}

describe("a backend whose sound creation is asynchronous", () => {
  it("holds the plays made before the sound exists and starts them when it does", async () => {
    const backend = new AsyncBackend();
    const h = await createAudioApp({ audio: { createBackend: () => backend } });
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 1 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      source.play();

      expect(source.instanceCount).toBe(1);
      expect(backend.inner.sounds).toHaveLength(0);

      await Promise.resolve();
      await Promise.resolve();

      expect(backend.inner.sounds[0]?.instanceCount).toBe(1);
      expect(source.isPlaying).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("reports a creation failure through app.onError rather than losing it", async () => {
    const backend = new AsyncBackend();
    const h = await createAudioApp({ audio: { createBackend: () => backend } });
    try {
      const reports: ErrorReport[] = [];
      h.app.onError.connect((report) => {
        reports.push(report);
      });
      backend.failNext = true;

      const clip = makeClip(h.app, "sfx/step.wav", { duration: 1 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      source.play();

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(reports).toHaveLength(1);
      expect(reports[0]?.source).toBe("extension");
    } finally {
      h.dispose();
    }
  });

  it("throws away a sound that arrives after its voice was released", async () => {
    const backend = new AsyncBackend();
    const h = await createAudioApp({ audio: { createBackend: () => backend } });
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 1 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      source.play();
      source.entity.destroy();
      h.step(1 / 60);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(backend.inner.sounds).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });
});

describe("a bus tree that arrives late", () => {
  it("routes voices created before it, once it is there", async () => {
    const document = JSON.stringify({
      format: "ignifx.audiobuses",
      formatVersion: 1,
      buses: [{ name: "Master" }, { name: "SFX", parent: "Master" }],
    });
    const h = await createAudioApp({
      audio: { buses: "audio/buses.audio.json" },
      files: { "audio/buses.audio.json": document },
    });
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 1 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      source.play();

      expect(source.instanceCount).toBe(1);
      expect(h.backend.sounds).toHaveLength(0);

      await h.app.start();
      await h.load("audio/buses.audio.json");
      h.step(1 / 60);

      expect(h.backend.sounds[0]?.instanceCount).toBe(1);
      expect(source.instance?.bus?.name).toBe("SFX");
    } finally {
      h.dispose();
    }
  });

  it("reports IGX-1001 through app.onError for a voice whose bus the tree does not hold", async () => {
    const document = JSON.stringify({
      format: "ignifx.audiobuses",
      formatVersion: 1,
      buses: [{ name: "Master" }],
    });
    const h = await createAudioApp({
      audio: { buses: "audio/buses.audio.json" },
      files: { "audio/buses.audio.json": document },
    });
    try {
      const reports: ErrorReport[] = [];
      h.app.onError.connect((report) => {
        reports.push(report);
      });
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 1 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      source.play();

      await h.app.start();
      await h.load("audio/buses.audio.json");
      h.step(1 / 60);

      expect(reports).toHaveLength(1);
      expect(reports[0]?.error).toMatchObject({ code: "IGX-1001" });
    } finally {
      h.dispose();
    }
  });

  it("reports a bus document that will not load through app.onError", async () => {
    const h = await createAudioApp({
      audio: { buses: "audio/missing.audio.json" },
      settings: { assets: { retries: 0 } },
    });
    try {
      const reports: ErrorReport[] = [];
      h.app.onError.connect((report) => {
        reports.push(report);
      });

      await h.app.start();
      await h.drive(8);

      expect(reports.some((report) => report.source === "asset")).toBe(true);
      expect(h.audio.isTreeReady).toBe(false);
    } finally {
      h.dispose();
    }
  });
});

describe("AudioService.defaultBusTree", () => {
  it("makes the first name the root and routes every other name into it", () => {
    expect(AudioService.defaultBusTree(["Main", "A", "B"])).toEqual([
      { name: "Main", parent: null, volume: 1, pausable: null },
      { name: "A", parent: "Main", volume: 1, pausable: null },
      { name: "B", parent: "Main", volume: 1, pausable: null },
    ]);
  });

  it("answers an empty tree for an empty list", () => {
    expect(AudioService.defaultBusTree([])).toEqual([]);
  });
});

describe("a disposed service", () => {
  it("stops pumping and releases every voice", async () => {
    const h = await createAudioApp();
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 10 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      const instance = source.play();

      h.dispose();

      expect(instance?.isPlaying).toBe(false);
      expect(h.audio.buses.size).toBe(0);

      // A second dispose, and a pump after one, are both no-ops rather than failures.
      h.audio.dispose();
      h.audio.pump(1 / 60);
    } finally {
      // Already disposed; the harness's own dispose is idempotent.
    }
  });
});

describe("AudioClip", () => {
  it("takes its duration, channels, and sample rate from a decoded buffer", () => {
    const clip = new AudioClip({
      address: "sfx/a.mp3",
      url: "assets/sfx/a.mp3",
      isStreaming: false,
      duration: null,
      channels: null,
      sampleRate: null,
      bytes: new ArrayBuffer(32),
    });

    expect(clip.byteLength).toBe(32);
    expect(clip.isDecoded).toBe(false);

    clip.attachBuffer({ duration: 2.5, sampleRate: 48_000, channelCount: 2, length: 120_000 }, 2.5, 2, 48_000);

    expect(clip.duration).toBe(2.5);
    expect(clip.channels).toBe(2);
    expect(clip.sampleRate).toBe(48_000);
    expect(clip.isDecoded).toBe(true);
    expect(clip.bytes()).toBeNull();
    // The size the file had is kept for diagnostics even after the bytes are gone.
    expect(clip.byteLength).toBe(32);

    clip.release();

    expect(clip.lite.buffer).toBeNull();
  });
});

describe("Ramp", () => {
  it("does nothing when it is not moving", () => {
    const ramp = new Ramp(1);

    expect(ramp.advance(1)).toBe(false);
    expect(ramp.value).toBe(1);
    expect(ramp.target).toBe(1);
    expect(ramp.isActive).toBe(false);
  });

  it("jumps when the fade is zero seconds or shorter", () => {
    const ramp = new Ramp(1);
    ramp.to(0, 0);

    expect(ramp.value).toBe(0);
    expect(ramp.isActive).toBe(false);
  });
});
