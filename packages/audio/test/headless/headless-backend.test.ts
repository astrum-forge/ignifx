import { describe, expect, it } from "vitest";
import { AudioClip } from "../../src/assets/audio-clip.js";
import { HeadlessBackend, HeadlessBus, HeadlessSound } from "../../src/headless/headless-backend.js";
import type { BackendBus, BackendPlayRequest, BackendSound, BackendSoundRequest } from "../../src/backend/types.js";

/**
 * The simulation itself (`docs/architecture/10-audio.md` §7), driven directly rather than through
 * the service, so its own guards and getters are pinned.
 */

/**
 * A clip with a known duration and no bytes behind it.
 *
 * @param seconds - The duration, or `null` for a container this build cannot measure.
 * @returns The clip.
 */
function clip(seconds: number | null = 1): AudioClip {
  return new AudioClip({
    address: "sfx/a.wav",
    url: "assets/sfx/a.wav",
    isStreaming: false,
    duration: seconds,
    channels: 1,
    sampleRate: 8000,
    bytes: null,
  });
}

/**
 * A sound request over its defaults.
 *
 * @param over - What to change.
 * @returns The request.
 */
function soundRequest(over?: Partial<BackendSoundRequest>): BackendSoundRequest {
  return {
    clip: clip(),
    bus: null,
    volume: 1,
    playbackRate: 1,
    loop: false,
    maxInstances: 8,
    pan: 0,
    spatial: null,
    ...over,
  };
}

/**
 * A play request over its defaults.
 *
 * @param over - What to change.
 * @returns The request.
 */
function playRequestOf(over?: Partial<BackendPlayRequest>): BackendPlayRequest {
  return { volume: 1, playbackRate: 1, loop: false, startOffset: 0, duration: 0, delay: 0, ...over };
}

/** A backend object from nowhere, to prove every entry point ignores what it did not make. */
const FOREIGN_SOUND: BackendSound = { instanceCount: 3, isPlaying: true, isPaused: false };

/** A bus from nowhere, for the same reason. */
const FOREIGN_BUS: BackendBus = { name: "Nowhere", lite: null };

describe("HeadlessBackend state", () => {
  it("starts running, and starts suspended when it is told to", async () => {
    const running = new HeadlessBackend();
    const suspended = new HeadlessBackend({ startSuspended: true, masterVolume: 0.5 });

    expect(running.kind).toBe("headless");
    expect(running.state).toBe("running");
    expect(running.lite).toBeNull();
    expect(suspended.state).toBe("suspended");
    expect(suspended.getMasterVolume()).toBe(0.5);

    await suspended.unlock();

    expect(suspended.state).toBe("running");
  });

  it("announces a state change once and stays quiet about a move to the state it is in", async () => {
    const backend = new HeadlessBackend({ startSuspended: true });
    const seen: string[] = [];
    backend.onStateChanged.connect((state) => {
      seen.push(state);
    });

    await backend.unlock();
    await backend.unlock();

    expect(seen).toEqual(["running"]);
  });

  it("closes on dispose", () => {
    const backend = new HeadlessBackend();
    backend.dispose();

    expect(backend.state).toBe("closed");
    expect(backend.sounds).toHaveLength(0);
    expect(backend.buses).toHaveLength(0);
    expect(backend.listener).toBeNull();
  });

  it("takes a master volume and hands it back", () => {
    const backend = new HeadlessBackend();
    backend.setMasterVolume(0.25);

    expect(backend.getMasterVolume()).toBe(0.25);
  });

  it("decodes nothing, because there is nothing to decode", async () => {
    await expect(new HeadlessBackend().decode()).resolves.toBeUndefined();
  });
});

describe("HeadlessBackend buses", () => {
  it("multiplies a bus's gain up its parent chain", async () => {
    const backend = new HeadlessBackend();
    const master = await backend.createBus({ name: "Master", volume: 0.5, parent: null });
    const music = await backend.createBus({ name: "Music", volume: 0.4, parent: master });

    expect(master).toBeInstanceOf(HeadlessBus);
    expect((music as HeadlessBus).effectiveVolume).toBeCloseTo(0.2, 6);
    expect(backend.buses).toHaveLength(2);
  });

  it("writes and reads a bus gain, and ignores a bus it did not make", async () => {
    const backend = new HeadlessBackend();
    const bus = await backend.createBus({ name: "SFX", volume: 1, parent: null });

    backend.setBusVolume(bus, 0.3);
    backend.setBusVolume(FOREIGN_BUS, 0.3);

    expect((bus as HeadlessBus).volume).toBe(0.3);
  });

  it("releases a bus it made and ignores one it did not", async () => {
    const backend = new HeadlessBackend();
    const bus = await backend.createBus({ name: "SFX", volume: 1, parent: null });

    backend.disposeBus(FOREIGN_BUS);

    expect(backend.buses).toHaveLength(1);

    backend.disposeBus(bus);

    expect(backend.buses).toHaveLength(0);
    expect((bus as HeadlessBus).isDisposed).toBe(true);
  });
});

describe("HeadlessBackend sounds", () => {
  it("creates a sound synchronously, which is what makes onEnded timing exact", async () => {
    const backend = new HeadlessBackend();
    const bus = await backend.createBus({ name: "SFX", volume: 0.5, parent: null });
    const sound = backend.createSound(soundRequest({ bus, volume: 0.4 }));

    expect(sound).toBeInstanceOf(HeadlessSound);
    expect(sound.instanceCount).toBe(0);
    expect(sound.isPlaying).toBe(false);
    expect(sound.isPaused).toBe(false);
    expect((sound as HeadlessSound).effectiveVolume).toBeCloseTo(0.2, 6);
  });

  it("reports the gain of a sound with no bus as its own", () => {
    const backend = new HeadlessBackend();
    const sound = backend.createSound(soundRequest({ volume: 0.75 }));

    expect((sound as HeadlessSound).effectiveVolume).toBe(0.75);
  });

  it("counts elapsed engine time, in seconds and in milliseconds", () => {
    const backend = new HeadlessBackend();
    backend.update(0.5);
    backend.update(0);
    backend.update(-1);

    expect(backend.elapsedSeconds).toBeCloseTo(0.5, 9);
    expect(backend.elapsedMs).toBeCloseTo(500, 6);
  });

  it("resumes a paused sound rather than starting another instance, as Lite's playSound does", () => {
    const backend = new HeadlessBackend();
    const sound = backend.createSound(soundRequest());

    backend.play(sound, playRequestOf());
    backend.pause(sound);

    expect(sound.isPaused).toBe(true);

    backend.play(sound, playRequestOf());

    expect(sound.instanceCount).toBe(1);
    expect(sound.isPlaying).toBe(true);
  });

  it("holds a paused instance at its remaining time", () => {
    const backend = new HeadlessBackend();
    const sound = backend.createSound(soundRequest());

    backend.play(sound, playRequestOf());
    backend.update(0.5);
    backend.pause(sound);
    backend.update(10);

    expect(sound.instanceCount).toBe(1);

    backend.resume(sound);
    backend.update(0.4);

    expect(sound.instanceCount).toBe(1);

    backend.update(0.2);

    expect(sound.instanceCount).toBe(0);
  });

  it("never ends an instance of a clip whose duration is unknown", () => {
    const backend = new HeadlessBackend();
    const sound = backend.createSound(soundRequest({ clip: clip(null) }));

    backend.play(sound, playRequestOf());
    backend.update(100);

    expect(sound.instanceCount).toBe(1);
  });

  it("keeps the sound's volume and pan where they were written", () => {
    const backend = new HeadlessBackend();
    const sound = backend.createSound(soundRequest());

    backend.setSoundVolume(sound, 0.2);
    backend.setSoundPan(sound, -1);

    expect((sound as HeadlessSound).volume).toBe(0.2);
    expect((sound as HeadlessSound).pan).toBe(-1);
  });

  it("releases a sound it made and ignores one it did not", () => {
    const backend = new HeadlessBackend();
    const sound = backend.createSound(soundRequest());

    backend.disposeSound(FOREIGN_SOUND);

    expect(backend.sounds).toHaveLength(1);

    backend.disposeSound(sound);

    expect(backend.sounds).toHaveLength(0);
    expect((sound as HeadlessSound).isDisposed).toBe(true);
  });

  it("ignores every command aimed at a sound it did not make", () => {
    const backend = new HeadlessBackend();

    backend.play(FOREIGN_SOUND, playRequestOf());
    backend.stop(FOREIGN_SOUND);
    backend.pause(FOREIGN_SOUND);
    backend.resume(FOREIGN_SOUND);
    backend.setSoundVolume(FOREIGN_SOUND, 0);
    backend.setSoundPan(FOREIGN_SOUND, 0);

    expect(backend.sounds).toHaveLength(0);
  });

  it("advances nothing for a sound that has no instances", () => {
    const backend = new HeadlessBackend();
    const sound = backend.createSound(soundRequest());

    backend.update(1);

    expect(sound.instanceCount).toBe(0);
  });

  it("records the listener it was pointed at", () => {
    const backend = new HeadlessBackend();
    const target = { worldMatrix: new Float64Array(16) as unknown as never };

    backend.setListener(target);

    expect(backend.listener).toBe(target);

    backend.setListener(null);

    expect(backend.listener).toBeNull();
  });
});
