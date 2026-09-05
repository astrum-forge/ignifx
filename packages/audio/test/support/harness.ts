import { createApp, createAssetManifest, createManualClock, createMemorySink, DEFAULT_ASSET_ROOT } from "@ignifx/core";
import { AUDIO_ASSET_TYPE, AudioClip } from "../../src/assets/audio-clip.js";
import { audio } from "../../src/extension.js";
import { HeadlessBackend } from "../../src/headless/headless-backend.js";
import type { AudioOptions } from "../../src/extension.js";
import type { AudioService } from "../../src/service/audio-service.js";
import type {
  App,
  AssetHandle,
  AssetManifest,
  JsonObject,
  ManualClock,
  MemorySink,
  SettingsInput,
  World,
} from "@ignifx/core";

/**
 * The harness the audio suites share: a real headless `createApp` on a manual clock, with the
 * `@ignifx/audio` extension registered and a `fetch` that answers from an in-memory table.
 *
 * Every test drives the app with {@link AudioHarness.step}, never with a timer, so simulated
 * playback advances by exactly the delta the test asked for (coding standards §10).
 */

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000;

/** How many frames {@link AudioHarness.load} will run before it gives up on a load. */
const LOAD_FRAME_BUDGET = 64;

/**
 * Lets every queued microtask and promise continuation run, without waiting on the wall clock
 * (coding standards §10).
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** What {@link createAudioApp} accepts. */
export interface AudioHarnessOptions {
  /** Passed through to `audio(...)`. */
  readonly audio?: AudioOptions;
  /** Project settings, as `ignifx.config.ts` would supply them. */
  readonly settings?: SettingsInput;
  /** Address to body, for the injected `fetch`. Strings are sent as UTF-8. */
  readonly files?: Readonly<Record<string, ArrayBuffer | string>>;
  /** The manifest, when a test needs `.meta.json` sidecar data on an entry. */
  readonly manifest?: AssetManifest;
  /** Start the audio context suspended, so `app.audio.state` reads `"locked"`. */
  readonly startSuspended?: boolean;
}

/** Everything an audio test needs, wired together. */
export interface AudioHarness {
  /** The app under test. */
  readonly app: App;
  /** Its world. */
  readonly world: World;
  /** `app.audio`. */
  readonly audio: AudioService;
  /** The simulation behind it. */
  readonly backend: HeadlessBackend;
  /** The clock `realtimeSinceStartup` reads. */
  readonly clock: ManualClock;
  /** Where `app.log` writes. */
  readonly sink: MemorySink;
  /**
   * Runs one frame and advances the manual clock by the same amount.
   *
   * @param deltaSeconds - The frame delta.
   */
  step(deltaSeconds: number): void;
  /**
   * Runs many frames of one sixtieth of a second.
   *
   * @param seconds - How much time to advance in total.
   */
  advance(seconds: number): void;
  /**
   * Runs a number of frames, flushing microtasks around each one so promise continuations land
   * between them.
   *
   * @param frames - How many frames to run.
   */
  drive(frames: number): Promise<void>;
  /**
   * Runs frames until a promise settles — the shape every asynchronous engine operation needs in a
   * stepped app, because delivery happens inside a frame.
   *
   * @param work - The promise to drive to completion.
   */
  settle(work: Promise<unknown>): Promise<void>;
  /**
   * Requests an asset and runs frames until it has been delivered — asset delivery happens in
   * `PreUpdate`, so a bare `await` on the promise would deadlock a stepped app.
   *
   * @typeParam T - The loaded value type.
   * @param address - The address to load.
   * @returns The delivered handle.
   */
  load<T>(address: string): Promise<AssetHandle<T>>;
  /** Disposes the app. */
  dispose(): void;
}

/**
 * Answers asset reads from a table of addresses.
 *
 * @param files - Address to body.
 * @returns A `fetch` the asset service can read through.
 */
function tableFetch(files: Readonly<Record<string, ArrayBuffer | string>>): typeof globalThis.fetch {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const address = url.replace(/^assets\//u, "");
    const body = files[url] ?? files[address] ?? null;
    if (body === null) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return Promise.resolve(new Response(body, { status: 200 }));
  };
}

/**
 * Builds a headless app with `@ignifx/audio` registered.
 *
 * @param options - Extension options, settings, files, manifest, and the initial lock state.
 * @returns The harness.
 *
 * @example
 * ```ts
 * const h = await createAudioApp({ files: { "sfx/step.wav": createWav() } });
 * ```
 */
export async function createAudioApp(options?: AudioHarnessOptions): Promise<AudioHarness> {
  const clock = createManualClock();
  const sink = createMemorySink();
  const backendOptions = options?.startSuspended === true ? { startSuspended: true } : {};
  const app = await createApp({
    headless: true,
    clock,
    logSink: sink,
    fetch: tableFetch(options?.files ?? {}),
    ...(options?.manifest === undefined ? {} : { assets: { manifest: options.manifest } }),
    ...(options?.settings === undefined ? {} : { settings: options.settings }),
    extensions: [
      audio({
        createBackend: (context): HeadlessBackend =>
          new HeadlessBackend({ masterVolume: context.masterVolume, ...backendOptions }),
        ...options?.audio,
      }),
    ],
  });
  const step = (deltaSeconds: number): void => {
    clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
    app.step(deltaSeconds);
  };
  // The backend is the one this harness just built; nothing else can have replaced it.
  const backend = app.audio.backend as HeadlessBackend;
  return {
    app,
    world: app.world,
    audio: app.audio,
    backend,
    clock,
    sink,
    step,
    advance: (seconds: number): void => {
      const frames = Math.round(seconds * 60);
      for (let index = 0; index < frames; index += 1) {
        step(1 / 60);
      }
    },
    drive: async (frames: number): Promise<void> => {
      for (let index = 0; index < frames; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- frames are sequential; that is the point.
        await flushMicrotasks();
        step(1 / 60);
        // oxlint-disable-next-line no-await-in-loop -- see above.
        await flushMicrotasks();
      }
    },
    settle: async (work: Promise<unknown>): Promise<void> => {
      const state = { done: false };
      const finish = (): void => {
        state.done = true;
      };
      void work.then(finish, finish);
      for (let index = 0; index < LOAD_FRAME_BUDGET && !state.done; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- frames are sequential; that is the point.
        await flushMicrotasks();
        step(1 / 60);
        // oxlint-disable-next-line no-await-in-loop -- see above.
        await flushMicrotasks();
      }
    },
    load: async <T>(address: string): Promise<AssetHandle<T>> => {
      const handle = app.assets.load<T>(address);
      for (let index = 0; index < LOAD_FRAME_BUDGET && handle.state === "loading"; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- frames are sequential; that is the point.
        await flushMicrotasks();
        step(1 / 60);
        // oxlint-disable-next-line no-await-in-loop -- see above.
        await flushMicrotasks();
      }
      await handle.promise;
      return handle;
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}

/** What {@link makeClip} accepts beyond the address and the duration. */
export interface MakeClipOptions {
  /** Whether the clip streams instead of decoding. Defaults to `false`. */
  readonly isStreaming?: boolean;
  /** The clip's duration in seconds, or `null` for a container this build cannot measure. */
  readonly duration?: number | null;
}

/**
 * Publishes a clip built in memory, so a test can play a sound without going through the loader.
 *
 * @param app - The app to register it with.
 * @param address - The address to publish it at.
 * @param options - The duration and whether it streams.
 * @returns The loaded handle, with one holder.
 *
 * @example
 * ```ts
 * const step = makeClip(app, "sfx/step.wav", { duration: 0.5 });
 * source.clip = step;
 * ```
 */
export function makeClip(app: App, address: string, options?: MakeClipOptions): AssetHandle<AudioClip> {
  const clip = new AudioClip({
    address,
    url: `assets/${address}`,
    isStreaming: options?.isStreaming ?? false,
    duration: options?.duration === undefined ? 0.5 : options.duration,
    channels: 1,
    sampleRate: 8000,
    bytes: null,
  });
  return app.assets.register<AudioClip>(clip, { type: AUDIO_ASSET_TYPE, address });
}

/**
 * Builds a manifest whose single entry carries a `.meta.json` sidecar, which is how a clip is
 * marked as streaming (`docs/architecture/05-assets-and-loading.md` §7).
 *
 * @param address - The address the entry covers.
 * @param meta - The sidecar contents.
 * @returns The manifest.
 */
export function manifestWithMeta(address: string, meta: JsonObject): AssetManifest {
  return createAssetManifest([{ address, url: `${DEFAULT_ASSET_ROOT}/${address}`, meta }]);
}
