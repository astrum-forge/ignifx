import { createApp } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { AudioClip } from "../../src/assets/audio-clip.js";
import { AudioListener } from "../../src/components/audio-listener.js";
import { AudioSource } from "../../src/components/audio-source.js";
import { MusicPlayer } from "../../src/components/music-player.js";
import { audio } from "../../src/extension.js";
import { createWebAudioBackend, WebAudioBackend } from "../../src/lite/web/web-backend.js";
import { createWav } from "../support/wav.js";
import type { AudioBackendContext } from "../../src/backend/types.js";
import type { App, AssetHandle } from "@ignifx/core";

/**
 * The Web Audio backend against a real browser audio graph (`docs/plan/engineering-plan.md` Phase 5
 * exit criteria).
 *
 * ## Why an `OfflineAudioContext`
 *
 * Babylon Lite's `createAudioEngineAsync` takes an `audioContext` (`index.d.ts` 950), and an offline
 * context renders the whole graph into an `AudioBuffer` faster than real time, deterministically,
 * with no autoplay policy in the way — Lite reports such an engine as permanently `"running"`
 * (`lib/audio/audio-engine.js`). That turns "is the sound audible through the bus tree" and "is a
 * distant source quieter than a near one" into arithmetic over samples rather than into a
 * listening test.
 *
 * The one thing an offline context cannot show is the unlock, because it is never locked. That case
 * uses a real `AudioContext`, which headless Chromium starts suspended.
 */

/** The fixture tone: half a second of a 440 Hz sine at 8 kHz, mono. */
const TONE_SECONDS = 0.5;

/** The sample rate every offline render uses. */
const SAMPLE_RATE = 8000;

/** The address the fixture tone is served at. */
const TONE_ADDRESS = "sfx/tone.wav";

/** Where a loudness measurement starts, in seconds: past Lite's 10 ms parameter smoothing. */
const MEASURE_FROM = 0.1;

/** Where a loudness measurement ends, in seconds: before the tone runs out. */
const MEASURE_TO = 0.45;

/**
 * Yields to the task queue, so a promise the Web Audio backend is waiting on can settle.
 *
 * @remarks
 * `createSound` is asynchronous in a browser (`backend/types.ts`), so a `play()` is held on its
 * voice until the sound exists. Rendering before that turn has run would render silence — which is
 * a real property of the backend, not a flaw in it, and the one thing a headless test cannot show.
 */
async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Answers the fixture tone for any address, so a loader has something to fetch.
 *
 * @param bytes - The file to serve.
 * @returns A `fetch` the asset service can read through.
 */
function toneFetch(bytes: ArrayBuffer): typeof globalThis.fetch {
  return (): Promise<Response> => Promise.resolve(new Response(bytes, { status: 200 }));
}

/**
 * How loud a render was, as the root mean square of its samples over a window, taken over the
 * loudest channel.
 *
 * @remarks
 * The window starts at {@link MEASURE_FROM} rather than at zero on purpose. Babylon Lite smooths
 * every gain write over `parameterRampDuration` (10 ms, `index.d.ts` 950), so the first few
 * milliseconds of a render are a slide down from the previous value rather than the value under
 * test — a peak reading would report that slide and nothing else.
 *
 * @param buffer - The rendered audio.
 * @returns The RMS amplitude of the loudest channel, in `[0, 1]`.
 */
function loudnessOf(buffer: AudioBuffer): number {
  const from = Math.round(MEASURE_FROM * buffer.sampleRate);
  const to = Math.round(MEASURE_TO * buffer.sampleRate);
  let loudest = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      const value = samples[index] ?? 0;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / (to - from));
    if (rms > loudest) {
      loudest = rms;
    }
  }
  return loudest;
}

/** What {@link offlineApp} hands a test. */
interface OfflineFixture {
  /** The app, running headless against a real Web Audio graph. */
  readonly app: App;
  /** The context the whole graph renders into. */
  readonly context: OfflineAudioContext;
  /** The fixture tone, already loaded and decoded. */
  readonly clip: AssetHandle<AudioClip>;
}

/**
 * Builds a headless app whose audio backend is the real Web Audio one, on an offline context.
 *
 * @param seconds - How long the render is.
 * @returns The fixture.
 */
async function offlineApp(seconds = 1): Promise<OfflineFixture> {
  // Two channels, because a spatial source is panned: at +X an `"equalpower"` panner puts the whole
  // signal in the right channel, and a mono render would have nothing to compare.
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const app = await createApp({
    headless: true,
    fetch: toneFetch(createWav({ seconds: TONE_SECONDS, sampleRate: SAMPLE_RATE })),
    extensions: [
      audio({
        audioContext: context,
        createBackend: (backendContext: AudioBackendContext) => createWebAudioBackend(backendContext),
      }),
    ],
  });
  const clip = app.assets.load<AudioClip>(TONE_ADDRESS);
  for (let index = 0; index < 32 && clip.state === "loading"; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- delivery happens in a frame, one frame at a time.
    await nextTurn();
    app.step(1 / 60);
  }
  await clip.promise;
  return { app, context, clip };
}

describe("the Web Audio backend on an OfflineAudioContext", () => {
  it("creates a Babylon Lite audio engine and reports it running", async () => {
    const { app, context } = await offlineApp();
    try {
      expect(app.audio.backend).toBeInstanceOf(WebAudioBackend);
      expect(app.audio.backend.kind).toBe("web");
      expect(app.audio.state).toBe("running");
      expect(app.audio.lite.engine).not.toBeNull();
      expect(app.audio.lite.engine?.audioContext).toBe(context);
    } finally {
      app.dispose();
    }
  });

  it("decodes a clip into a shared Lite SoundBuffer and reads its exact duration off it", async () => {
    const { app, clip } = await offlineApp();
    try {
      expect(clip.value.isDecoded).toBe(true);
      expect(clip.value.lite.buffer).not.toBeNull();
      expect(clip.value.duration).toBeCloseTo(TONE_SECONDS, 3);
      expect(clip.value.sampleRate).toBe(SAMPLE_RATE);
      expect(clip.value.channels).toBe(1);
      // The bytes are released once the buffer exists; every source shares the one buffer.
      expect(clip.value.bytes()).toBeNull();
    } finally {
      app.dispose();
    }
  });

  it("builds a real Lite bus per declared bus, routed into its parent", async () => {
    const { app } = await offlineApp();
    try {
      expect([...app.audio.buses.keys()]).toEqual(["Master", "Music", "SFX", "UI", "Voice"]);
      expect(app.audio.bus("SFX").lite).not.toBeNull();
      expect(app.audio.bus("SFX").parent).toBe(app.audio.bus("Master"));
    } finally {
      app.dispose();
    }
  });

  it("pumps updateSpatialAudio every frame without throwing", async () => {
    const { app, clip } = await offlineApp();
    try {
      app.world.createEntity("Ears").addComponent(AudioListener);
      const source = app.world
        .createEntity("Speaker")
        .addComponent(AudioSource, { clip: clip.retain(), spatial: true });
      app.step(1 / 60);
      source.play();

      for (let index = 0; index < 10; index += 1) {
        source.transform.localPosition.x = index;
        app.step(1 / 60);
      }

      expect(source.isPlaying).toBe(true);
    } finally {
      app.dispose();
    }
  });
});

describe("bus routing, measured", () => {
  /**
   * Plays the tone on one bus and renders the whole graph.
   *
   * @param busName - The bus to route through.
   * @param masterVolume - The gain to leave the `Master` bus at.
   * @returns The peak amplitude of the render.
   */
  async function renderThrough(busName: string, masterVolume: number): Promise<number> {
    const { app, context, clip } = await offlineApp();
    try {
      app.audio.bus("Master").volume = masterVolume;
      const source = app.world.createEntity("Speaker").addComponent(AudioSource, { clip: clip.retain(), bus: busName });
      app.step(1 / 60);
      source.play();
      await nextTurn();
      return loudnessOf(await context.startRendering());
    } finally {
      app.dispose();
    }
  }

  it("is audible at the destination when the chain is open", async () => {
    expect(await renderThrough("SFX", 1)).toBeGreaterThan(0.1);
  });

  it("is silenced by the parent bus, which proves SFX really routes through Master", async () => {
    const open = await renderThrough("SFX", 1);
    const shut = await renderThrough("SFX", 0);

    expect(open).toBeGreaterThan(0.1);
    expect(shut).toBeLessThan(open / 100);
  });

  it("is attenuated by the bus's own gain", async () => {
    const { app, context, clip } = await offlineApp();
    try {
      app.audio.bus("SFX").volume = 0.25;
      const source = app.world.createEntity("Speaker").addComponent(AudioSource, { clip: clip.retain() });
      app.step(1 / 60);
      source.play();
      await nextTurn();
      const quiet = loudnessOf(await context.startRendering());

      // The tone peaks at 0.5, so a full-gain render measures about 0.35 RMS; a quarter of that is
      // well under 0.15 and well over nothing.
      expect(quiet).toBeGreaterThan(0.02);
      expect(quiet).toBeLessThan(0.15);
    } finally {
      app.dispose();
    }
  });
});

describe("spatial attenuation, measured", () => {
  /**
   * Renders the tone from a source a given distance from the listener.
   *
   * @param metres - How far away the source is, along +X.
   * @returns The peak amplitude of the render.
   */
  async function renderAtDistance(metres: number): Promise<number> {
    const { app, context, clip } = await offlineApp();
    try {
      app.world.createEntity("Ears").addComponent(AudioListener);
      const speaker = app.world.createEntity("Speaker");
      const source = speaker.addComponent(AudioSource, {
        clip: clip.retain(),
        spatial: true,
        minDistance: 1,
        maxDistance: 1000,
        rolloff: 1,
        distanceModel: "inverse",
      });
      speaker.transform.localPosition.x = metres;
      // One frame so the pump hands Lite the world matrices before anything is rendered.
      app.step(1 / 60);
      source.play();
      app.step(1 / 60);
      await nextTurn();
      return loudnessOf(await context.startRendering());
    } finally {
      app.dispose();
    }
  }

  it("makes a source a hundred metres away much quieter than one a metre away", async () => {
    const near = await renderAtDistance(1);
    const far = await renderAtDistance(100);

    expect(near).toBeGreaterThan(0.05);
    // The inverse model at `minDistance` 1 and `rolloff` 1 attenuates by `1 / (1 + (d - 1))`, so a
    // hundred metres is about a hundredth of a metre's loudness.
    expect(far).toBeLessThan(near / 10);
  });
});

describe("streaming clips", () => {
  it("refuses to stream on a context that cannot, with IGX-1009", async () => {
    const { app } = await offlineApp();
    try {
      // A streaming clip is one whose bytes are never fetched: the media element plays the URL.
      // Lite's `createStreamingSoundAsync` needs a real-time context (`index.d.ts` 3221), so on an
      // offline one it refuses, and `@ignifx/audio` turns that into IGX-1009.
      const streamingClip = new AudioClip({
        address: "music/theme.ogg",
        url: "data:audio/wav;base64,UklGRg==",
        isStreaming: true,
        duration: null,
        channels: null,
        sampleRate: null,
        bytes: null,
      });
      let thrown: unknown = null;
      try {
        await app.audio.backend.createSound({
          clip: streamingClip,
          bus: null,
          volume: 1,
          playbackRate: 1,
          loop: false,
          maxInstances: 1,
          pan: 0,
          spatial: null,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({ code: "IGX-1009" });
    } finally {
      app.dispose();
    }
  });
});

describe("the unlock flow on a real AudioContext", () => {
  /**
   * ## What a headless browser can and cannot show
   *
   * Chromium's autoplay policy hands out a **suspended** `AudioContext` to a page that has had no
   * user activation, and it refuses `resume()` until it gets one. A `click` event dispatched from
   * script is not user activation, so the resume it triggers never settles — which is the browser
   * behaving correctly, and the reason a "tap to start" overlay exists at all.
   *
   * So this file asserts the half that is ignifx's: that a suspended context leaves `app.audio`
   * `"locked"`, that a play made then is held rather than lost, and that a synthetic gesture really
   * does reach the hook Lite resumes from (`lib/audio/audio-engine.js` listens for `click` on
   * `document`). The other half — locked → running → every queued play flushed — is asserted in
   * `test/service/unlock.test.ts`, against the same service code driven by the same state change.
   */

  /**
   * Builds a headless app whose audio runs on a fresh real `AudioContext`.
   *
   * @returns The app and its context.
   */
  async function realContextApp(): Promise<{ readonly app: App; readonly context: AudioContext }> {
    const context = new AudioContext();
    const app = await createApp({
      headless: true,
      fetch: toneFetch(createWav({ seconds: TONE_SECONDS, sampleRate: SAMPLE_RATE })),
      extensions: [
        audio({
          audioContext: context,
          createBackend: (backendContext: AudioBackendContext) => createWebAudioBackend(backendContext),
        }),
      ],
    });
    return { app, context };
  }

  it("reads the audio context's own state, and calls it locked while it is suspended", async () => {
    const { app, context } = await realContextApp();
    try {
      expect(app.audio.backend.kind).toBe("web");
      expect(app.audio.state).toBe(context.state === "running" ? "running" : "locked");
      expect(app.audio.isUnlocked).toBe(context.state === "running");
    } finally {
      app.dispose();
    }
  });

  it("holds a play made while locked instead of handing it to a context that would drop it", async () => {
    const { app, context } = await realContextApp();
    try {
      const clip = app.assets.load<AudioClip>(TONE_ADDRESS);
      for (let index = 0; index < 32 && clip.state === "loading"; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- delivery happens one frame at a time.
        await nextTurn();
        app.step(1 / 60);
      }
      await clip.promise;

      const source = app.world.createEntity("Speaker").addComponent(AudioSource, { clip: clip.retain() });
      app.step(1 / 60);
      source.play();
      await nextTurn();
      app.step(1 / 60);

      // The source owes one instance either way; whether Lite has started it depends on whether the
      // browser let the context run.
      expect(source.instanceCount).toBe(1);
      expect(app.audio.isUnlocked).toBe(context.state === "running");
    } finally {
      app.dispose();
    }
  });

  it("reaches Lite's user-gesture hook from a synthetic click on the document", async () => {
    const { app } = await realContextApp();
    try {
      let gestures = 0;
      app.audio.lite.engine?.onUserGesture.add(() => {
        gestures += 1;
      });

      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      // This is the listener `createAudioEngineAsync({ resumeOnInteraction: true })` installs, and
      // the one a "tap to start" button relies on. Whether the resume it starts is honoured is the
      // autoplay policy's decision, not ignifx's.
      expect(gestures).toBe(1);
    } finally {
      app.dispose();
    }
  });
});

describe("MusicPlayer against a real graph", () => {
  it("crossfades two live Lite sounds, with the gains moving in opposite directions", async () => {
    const { app, clip } = await offlineApp();
    try {
      const music = app.world.createEntity("Jukebox").addComponent(MusicPlayer);
      app.step(1 / 60);
      const first = music.play(clip.value);
      const second = music.crossfadeTo(clip.value, 1);
      await nextTurn();

      expect(first).not.toBe(second);
      expect(music.previous).toBe(first);

      for (let index = 0; index < 30; index += 1) {
        app.step(1 / 60);
      }

      expect(second.volume).toBeCloseTo(0.5, 1);
      expect(first.volume).toBeCloseTo(0.5, 1);
    } finally {
      app.dispose();
    }
  });
});
