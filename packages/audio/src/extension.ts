import { defineExtension, Phase } from "@ignifx/core";
import { createAudioClipLoader } from "./assets/audio-clip-loader.js";
import { createAudioBusesLoader } from "./assets/bus-loader.js";
import { defineAudioAppProperty } from "./augmentation.js";
import { AudioListener } from "./components/audio-listener.js";
import { AudioSource } from "./components/audio-source.js";
import { MusicPlayer } from "./components/music-player.js";
import { AUDIO_ERROR_MESSAGES } from "./errors.js";
import { HeadlessBackend } from "./headless/headless-backend.js";
import { createWebAudioBackend } from "./lite/web/web-backend.js";
import { AUDIO_DIAGNOSTICS_COUNTERS, AUDIO_DIAGNOSTICS_GROUP, AudioService } from "./service/audio-service.js";
import { AUDIO_PUMP_ORDER, AudioSystem } from "./service/audio-system.js";
import { audioSettingsSchema, AUDIO_SETTINGS_SECTION, defaultAudioSettings } from "./settings.js";
import { VERSION } from "./version.js";
import type { AudioClip } from "./assets/audio-clip.js";
import type { AudioBusDefinition, AudioBusesAsset } from "./assets/bus-file.js";
import type { AudioBackend, AudioBackendContext } from "./backend/types.js";
import type { AudioSettings } from "./settings.js";
import type { App, Extension, ExtensionContext } from "@ignifx/core";

/**
 * The `@ignifx/audio` extension (`docs/architecture/04-extensions.md` §1, `10-audio.md`).
 * Registering it is the whole installation: `createApp({ canvas, extensions: [audio()] })` gives a
 * game `app.audio`, the `audio` and `audiobuses` asset types, `AudioSource`, `AudioListener`,
 * `MusicPlayer`, the `audio` settings section, the `audio` diagnostics group, and the `PreRender`
 * pump that advances fades, simulated playback, and Lite's spatial update.
 *
 * ## Why the engine is created in `register` and not in `onStart`
 *
 * `10-audio.md` §1 says "The engine is created in `onStart`". It is created in `register` instead,
 * which `04-extensions.md` §2.4 explicitly allows to be `async`. Two reasons:
 *
 * - The audio engine has no dependency on the Lite *render* engine, which is the thing `onStart`
 *   waits for. There is nothing to wait for.
 * - `app.audio` has to be usable the moment `await createApp(...)` returns — a game that reads
 *   `app.audio.masterVolume` from a settings screen before `app.start()` is ordinary — and a
 *   property whose getter throws until `start()` would be a trap.
 *
 * A `.audio.json` bus tree is the one thing that *cannot* be resolved here: asset delivery happens
 * in `PreUpdate` of a stepped frame, so awaiting a load before the loop runs would deadlock (the
 * same reason the core extension does not await its preload groups). The tree is built when the
 * document is delivered, and every sound created before then waits for it — the same queue that
 * holds plays made before the unlock.
 */

/**
 * What `audio()` accepts. Every field that names a settings value overrides the matching `audio`
 * section value, which is the shape `04-extensions.md` §1 shows for `physics()`.
 *
 * @public
 */
export interface AudioOptions {
  /** The address of the `.audio.json` bus tree; empty builds {@link AudioOptions.defaultBuses}. */
  readonly buses?: string;
  /**
   * The bus tree, given directly instead of through a file. It is the only way to have a custom
   * tree in place before the first frame, because a file has to be delivered first.
   */
  readonly busTree?: readonly AudioBusDefinition[];
  /** The tree built when neither a file nor `busTree` is given; the first name is the root. */
  readonly defaultBuses?: readonly string[];
  /** Which buses `app.pause()` pauses. */
  readonly pausableBuses?: readonly string[];
  /** The master output gain the app starts at. */
  readonly masterVolume?: number;
  /** Whether plays made before the first unlock are queued rather than dropped. */
  readonly queueWhileLocked?: boolean;
  /** Whether `app.pause()` pauses the sounds on pausable buses. */
  readonly pauseWithApp?: boolean;
  /**
   * An existing Web Audio context to build the engine on. Pass an `OfflineAudioContext` to render
   * deterministically in a browser test.
   */
  readonly audioContext?: BaseAudioContext | null;
  /**
   * Builds the backend. Defaults to the Web Audio backend in a browser and the headless one
   * everywhere else; a test passes a recording double, or a `HeadlessBackend` configured to start
   * suspended so the unlock flow can be exercised under Node.
   */
  readonly createBackend?: (context: AudioBackendContext) => AudioBackend | Promise<AudioBackend>;
}

/**
 * Merges the extension's options over the resolved settings section.
 *
 * @param settings - The resolved `audio` section.
 * @param options - What the game passed to `audio(...)`.
 * @returns The effective settings.
 */
function mergeSettings(settings: AudioSettings, options: AudioOptions): AudioSettings {
  return {
    buses: options.buses ?? settings.buses,
    defaultBuses: options.defaultBuses ?? settings.defaultBuses,
    pausableBuses: options.pausableBuses ?? settings.pausableBuses,
    masterVolume: options.masterVolume ?? settings.masterVolume,
    queueWhileLocked: options.queueWhileLocked ?? settings.queueWhileLocked,
    pauseWithApp: options.pauseWithApp ?? settings.pauseWithApp,
  };
}

/**
 * Chooses a backend: Web Audio where there is Web Audio, the simulation everywhere else.
 *
 * @param context - Whether the app is headless, an audio context to build on, and the initial gain.
 * @returns The backend, or a promise for it.
 */
function defaultBackend(context: AudioBackendContext): AudioBackend | Promise<AudioBackend> {
  const hasWebAudio = context.audioContext !== null || typeof globalThis.AudioContext === "function";
  if (context.isHeadless || !hasWebAudio) {
    return new HeadlessBackend({ masterVolume: context.masterVolume });
  }
  return createWebAudioBackend(context);
}

/**
 * Registers everything the package contributes and builds the mixer tree.
 *
 * @param ctx - The registration surface.
 * @param options - What the game passed to `audio(...)`.
 * @returns The service, so `onStart` can reach it without a second lookup.
 */
async function registerAudio(ctx: ExtensionContext, options: AudioOptions): Promise<AudioService> {
  ctx.registerErrorCodes(AUDIO_ERROR_MESSAGES);
  ctx.registerSettings<AudioSettings>(AUDIO_SETTINGS_SECTION, audioSettingsSchema(), defaultAudioSettings());
  const settings = mergeSettings(ctx.settings<AudioSettings>(AUDIO_SETTINGS_SECTION), options);
  const backend = await (options.createBackend ?? defaultBackend)({
    isHeadless: ctx.app.isHeadless,
    audioContext: options.audioContext ?? null,
    masterVolume: settings.masterVolume,
  });
  const service = new AudioService({ app: ctx.app, log: ctx.log, backend, settings });
  ctx.registerService(AudioService, service);
  defineAudioAppProperty(ctx, service);
  ctx.registerSystem(new AudioSystem(service), { phase: Phase.PreRender, order: AUDIO_PUMP_ORDER });
  // The headless backend decodes nothing, so it publishes no decoder and the loader drops a clip's
  // bytes as soon as it has read the header.
  const decoder = backend.kind === "web" ? async (clip: AudioClip): Promise<void> => backend.decode(clip) : null;
  ctx.registerAssetLoader(createAudioClipLoader({ decoder: () => decoder }));
  ctx.registerAssetLoader(createAudioBusesLoader());
  ctx.registerComponents([AudioSource, AudioListener, MusicPlayer]);
  service.setDiagnostics(ctx.app.diagnostics.registerGroup(AUDIO_DIAGNOSTICS_GROUP, AUDIO_DIAGNOSTICS_COUNTERS));
  ctx.onDispose((): void => {
    service.dispose();
  });
  if (options.busTree !== undefined) {
    await service.buildBuses(options.busTree);
  } else if (settings.buses === "") {
    await service.buildBuses(AudioService.defaultBusTree(settings.defaultBuses));
  }
  return service;
}

/**
 * Starts the `.audio.json` the `audio.buses` setting names, if it names one.
 *
 * @remarks
 * The document is **not** awaited, for the reason on this module: delivery needs a frame and
 * `onStart` runs before the first one. Sounds created in the meantime hold their plays until the
 * tree exists.
 *
 * @param app - The app being started.
 * @param service - The app's audio service.
 * @param address - The document address, or `""` for none.
 */
function startAudio(app: App, service: AudioService, address: string): void {
  if (address === "" || service.isTreeReady) {
    return;
  }
  const handle = app.assets.load<AudioBusesAsset>(address);
  void handle.promise.then(
    async (value: AudioBusesAsset): Promise<void> => service.buildBuses(value.buses),
    (error: unknown): void => {
      app.onError.emit({ error, source: "asset", phase: null, entity: null, component: null });
    },
  );
}

/**
 * The `@ignifx/audio` extension factory.
 *
 * @param options - Overrides for the `audio` settings section, an audio context, and the backend
 * factory.
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({
 *   canvas,
 *   extensions: [audio({ buses: "audio/buses.audio.json", masterVolume: 0.8 })],
 * });
 * ```
 *
 * @public
 */
export const audio: (options?: AudioOptions) => Extension = defineExtension<AudioOptions | undefined>((raw) => {
  // `defineExtension` hands the factory whatever the caller passed, which is `undefined` when the
  // game wrote `audio()`; the typed signature cannot express that, so the default lands here.
  const options: AudioOptions = raw ?? {};
  let service: AudioService | null = null;
  return {
    name: "@ignifx/audio",
    version: VERSION,
    engine: ">=0.0.0 <1.0.0",
    requires: ["@ignifx/core"],
    async register(ctx: ExtensionContext): Promise<void> {
      service = await registerAudio(ctx, options);
    },
    onStart(app: App): void {
      if (service !== null) {
        startAudio(app, service, options.buses ?? app.settings.section<AudioSettings>(AUDIO_SETTINGS_SECTION).buses);
      }
    },
  };
});
